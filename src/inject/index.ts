import { log } from './log.js'
import { detectProvider } from './detection.js'
import { create as createLaunchDarkly } from './providers/launchdarkly.js'
import { create as createOpenFeature } from './providers/openfeature.js'
import { create as createOptimizely } from './providers/optimizely.js'
import { create as createPostHog } from './providers/posthog.js'
import { SOURCE_INJECT, SOURCE_CONTENT, MSG_FLAGS_UPDATE, MSG_REQUEST_OVERRIDES, MSG_INIT_OVERRIDES, MSG_SET_OVERRIDE, MSG_CLEAR_OVERRIDE, MSG_CLEAR_ALL_OVERRIDES } from '../constants.js'
import type { FlagsMap, Overrides, Provider, ProviderId, Transport } from '../types.js'

declare global {
  interface Window {
    OpenFeature?: unknown
    optimizelyClient?: unknown
  }
}

let currentFlags: FlagsMap = {}
let overrides: Overrides = {}
let detectedProvider: ProviderId | null = null
let detectedTransport: Transport | null = null
let overridesReady = false
const overridesReadyCallbacks: Array<() => void> = []

function waitForOverrides(): Promise<void> {
  if (overridesReady) return Promise.resolve()
  return new Promise(resolve => overridesReadyCallbacks.push(resolve))
}

const providers: Provider[] = [createLaunchDarkly(), createOpenFeature(), createOptimizely(), createPostHog()]

function getProvider(id: ProviderId | null): Provider | null {
  if (!id) return null
  return providers.find(p => p.id === id) ?? null
}

function notify(): void {
  window.postMessage(
    {
      source: SOURCE_INJECT,
      type: MSG_FLAGS_UPDATE,
      flags: currentFlags,
      overrides,
      provider: detectedProvider,
      transport: detectedTransport,
    },
    '*',
  )
}

function setDetected(id: ProviderId, transport: Transport): void {
  // Don't downgrade SSE to polling for the same provider — LD (and others) make
  // a polling evaluation request alongside streaming; whichever lands last would
  // otherwise clobber the transport and break dispatchFlagsUpdate.
  if (detectedProvider === id && detectedTransport === 'sse' && transport === 'polling') return
  detectedProvider = id
  detectedTransport = transport
}

// ── Override application ──────────────────────────────────────────────────

function applyOverrideImmediate(): void {
  log('applyOverrideImmediate: transport=%s, provider=%s', detectedTransport, detectedProvider)
  if (detectedTransport === 'sse') {
    getProvider(detectedProvider)?.dispatchFlagsUpdate(currentFlags, overrides, notify)
  }
}

// ── Message bridge ────────────────────────────────────────────────────────

window.addEventListener('message', (e: MessageEvent) => {
  if (!e.data || e.data.source !== SOURCE_CONTENT) return
  switch (e.data.type) {
    case MSG_INIT_OVERRIDES:
      overrides = e.data.overrides || {}
      overridesReady = true
      overridesReadyCallbacks.splice(0).forEach(r => r())
      log('INIT_OVERRIDES: %o', overrides)
      break
    case MSG_SET_OVERRIDE:
      log('SET_OVERRIDE: %s =', e.data.key, e.data.value)
      overrides[e.data.key] = e.data.value
      applyOverrideImmediate()
      break
    case MSG_CLEAR_OVERRIDE:
      log('CLEAR_OVERRIDE: %s', e.data.key)
      delete overrides[e.data.key]
      applyOverrideImmediate()
      break
    case MSG_CLEAR_ALL_OVERRIDES:
      log('CLEAR_ALL_OVERRIDES')
      overrides = {}
      applyOverrideImmediate()
      break
  }
})

// ── Fetch interceptor (polling) ───────────────────────────────────────────

const OriginalFetch = window.fetch

window.fetch = async function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = input instanceof Request ? input.url : String(input)
  const detected = detectProvider(url)
  // Race the network request against the overrides round-trip so overrides are
  // ready to apply when the response arrives, with no added latency.
  const [response] = await Promise.all([OriginalFetch(input, init), detected?.transport === 'polling' ? waitForOverrides() : Promise.resolve()])
  if (!detected || detected.transport !== 'polling' || !response.ok) return response

  log('fetch: polling URL matched (%s) %s %d', detected.id, url.split('?')[0], response.status)

  try {
    const data: unknown = await response.clone().json()
    const provider = getProvider(detected.id)
    if (!provider || !provider.isPayload(data)) {
      log('fetch: not a flag payload — response shape unexpected')
      return response
    }

    // Always observe — popup needs to see flags even with no overrides.
    currentFlags = provider.normalizeFlags(data)
    log('fetch: flag payload ✓, %d flags', Object.keys(currentFlags).length)
    setDetected(detected.id, 'polling')
    notify()

    // Only rewrite when there are overrides to apply. Untouched response avoids
    // breaking SDKs that validate headers/body bytes (e.g. Optimizely v6).
    if (Object.keys(overrides).length === 0) return response

    const modified = provider.applyPollingOverrides(data, overrides)
    if (!modified) return response

    const headers = new Headers(response.headers)
    headers.set('Content-Type', 'application/json')
    headers.delete('Content-Length')
    headers.delete('ETag')
    headers.delete('Last-Modified')
    return new Response(JSON.stringify(modified), { status: response.status, statusText: response.statusText, headers })
  } catch (err) {
    log('fetch: parse error %o', err)
  }

  return response
}

// ── XHR interceptor (polling) ─────────────────────────────────────────────

const OriginalXHR = window.XMLHttpRequest

function CustomXHR(): XMLHttpRequest {
  const xhr = new OriginalXHR()
  let requestUrl = ''

  const originalOpen = xhr.open.bind(xhr) as (...args: unknown[]) => void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(xhr as any).open = function (method: unknown, url: unknown, ...args: unknown[]): void {
    requestUrl = typeof url === 'string' ? url : String(url)
    originalOpen(method, url, ...args)
  }

  xhr.addEventListener('readystatechange', function () {
    if (xhr.readyState !== 4 || xhr.status !== 200) return
    const detected = detectProvider(requestUrl)
    if (!detected || detected.transport !== 'polling') return
    try {
      const data: unknown = JSON.parse(xhr.responseText)
      const provider = getProvider(detected.id)
      if (!provider || !provider.isPayload(data)) return

      // Always observe so the popup shows the current flag values.
      currentFlags = provider.normalizeFlags(data)
      log('XHR: flag payload ✓, %d flags', Object.keys(currentFlags).length)
      setDetected(detected.id, 'polling')
      notify()

      // No overrides → leave the response untouched. Patching responseText for
      // a SDK that strictly validates response body bytes/headers (Optimizely
      // v6) was causing onReady to never resolve.
      if (Object.keys(overrides).length === 0) return

      const modified = provider.applyPollingOverrides(data, overrides)
      if (!modified) return
      const modifiedJson = JSON.stringify(modified)
      Object.defineProperty(xhr, 'responseText', { get: () => modifiedJson, configurable: true })
      Object.defineProperty(xhr, 'response', {
        get: function () {
          return xhr.responseType === 'json' ? modified : modifiedJson
        },
        configurable: true,
      })
      log('XHR: patched responseText')
    } catch (err) {
      log('XHR: error %o', err)
    }
  })

  return xhr
}

window.XMLHttpRequest = CustomXHR as unknown as typeof XMLHttpRequest
window.XMLHttpRequest.prototype = OriginalXHR.prototype
// Static readystate constants. Omitting these makes `XMLHttpRequest.DONE` undefined,
// which breaks SDKs that compare `request.readyState === XMLHttpRequest.DONE` (e.g.
// Optimizely v6) — the comparison is always false so the response is never processed.
Object.assign(window.XMLHttpRequest, {
  UNSENT: OriginalXHR.UNSENT,
  OPENED: OriginalXHR.OPENED,
  HEADERS_RECEIVED: OriginalXHR.HEADERS_RECEIVED,
  LOADING: OriginalXHR.LOADING,
  DONE: OriginalXHR.DONE,
})

// ── EventSource interceptor (SSE) ─────────────────────────────────────────

const OriginalEventSource = window.EventSource

function CustomEventSource(url: string | URL, init?: EventSourceInit): EventSource {
  const urlStr = typeof url === 'string' ? url : String(url)
  const detected = detectProvider(urlStr)
  log('EventSource created: %s → %s', urlStr.split('?')[0], detected ? detected.transport : 'not detected')
  const es = new OriginalEventSource(url, init)
  const originalAEL = es.addEventListener.bind(es)

  const provider = detected ? getProvider(detected.id) : null

  if (!provider && typeof window.OpenFeature !== 'undefined') {
    log('EventSource: unknown URL with OpenFeature SDK — transport tagged as openfeature/sse')
    if (!detectedProvider) setDetected('openfeature', 'sse')
    return es
  }

  if (!provider)
    return es

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(es as any).addEventListener = function (type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void {
    if (!provider.sseEventTypes.has(type)) {
      originalAEL(type, listener, options)
      return
    }

    const fn = typeof listener === 'function' ? listener : listener.handleEvent.bind(listener)
    provider.registerListener(type, fn as (e: MessageEvent) => void)

    originalAEL(
      type,
      (e: Event) => {
        try {
          const raw: unknown = JSON.parse((e as MessageEvent).data)
          const result = provider.processSSEEvent(type, raw, currentFlags, overrides)
          if (result) {
            if (result.flags) currentFlags = result.flags
            if (result.flagsChanged) {
              setDetected(detected!.id, 'sse')
              log('EventSource %s: %d flags, provider=%s', type, Object.keys(currentFlags).length, detected!.id)
              notify()
            }
            if (result.proxyData != null) {
              const proxied = Object.create(e, { data: { value: result.proxyData } }) as Event
              fn(proxied as MessageEvent)
              return
            }
          }
        } catch (_) {}
        fn(e as MessageEvent)
      },
      options,
    )
  }

  return es
}

Object.assign(CustomEventSource, {
  prototype: OriginalEventSource.prototype,
  CONNECTING: OriginalEventSource.CONNECTING,
  OPEN: OriginalEventSource.OPEN,
  CLOSED: OriginalEventSource.CLOSED,
})
window.EventSource = CustomEventSource as unknown as typeof EventSource

window.postMessage({ source: SOURCE_INJECT, type: MSG_REQUEST_OVERRIDES, origin: location.origin }, '*')

// ── OpenFeature SDK detection ─────────────────────────────────────────────

function tryHookOpenFeature(sdk: unknown): void {
  const ofProvider = getProvider('openfeature')
  if (!ofProvider) return
  const success = ofProvider.instrumentSDK!(
    sdk,
    () => overrides,
    (flags: FlagsMap) => {
      currentFlags = flags
      setDetected('openfeature', 'sse')
      notify()
    },
  )
  // OpenFeature wraps an underlying provider — always take precedence over URL-based detection
  if (success) setDetected('openfeature', 'sse')
}

;(function setupOpenFeatureDetection() {
  if (typeof window.OpenFeature !== 'undefined') {
    tryHookOpenFeature(window.OpenFeature)
    return
  }
  Object.defineProperty(window, 'OpenFeature', {
    configurable: true,
    set(sdk: unknown) {
      Object.defineProperty(window, 'OpenFeature', { value: sdk, writable: true, configurable: true })
      tryHookOpenFeature(sdk)
    },
  })
})()

// ── Optimizely SDK detection ──────────────────────────────────────────────

function tryHookOptimizely(sdk: unknown): void {
  const optProvider = getProvider('optimizely')
  if (!optProvider) return
  const success = optProvider.instrumentSDK!(
    sdk,
    () => overrides,
    (flags: FlagsMap) => {
      // Merge into currentFlags rather than replace — the polling/XHR path already
      // populated all 14 flags from the datafile; SDK-patch fills in only flags the
      // page actually evaluated, so a replace would clobber the rest.
      currentFlags = { ...currentFlags, ...flags }
      setDetected('optimizely', 'polling')
      notify()
    },
  )
  // Pages expose the client explicitly for the extension; URL-based detection still works in parallel.
  if (success) setDetected('optimizely', 'polling')
}

;(function setupOptimizelyDetection() {
  if (typeof window.optimizelyClient !== 'undefined') {
    tryHookOptimizely(window.optimizelyClient)
    return
  }
  Object.defineProperty(window, 'optimizelyClient', {
    configurable: true,
    set(sdk: unknown) {
      Object.defineProperty(window, 'optimizelyClient', { value: sdk, writable: true, configurable: true })
      tryHookOptimizely(sdk)
    },
  })
})()

log('loaded')
