import { log } from './log.js'
import { detectProvider } from './detection.js'
import { create as createLaunchDarkly } from './providers/launchdarkly.js'
import { create as createOpenFeature } from './providers/openfeature.js'
import { create as createPostHog } from './providers/posthog.js'
import {
  SOURCE_INJECT, SOURCE_CONTENT,
  MSG_FLAGS_UPDATE, MSG_REQUEST_OVERRIDES,
  MSG_INIT_OVERRIDES, MSG_SET_OVERRIDE, MSG_CLEAR_OVERRIDE, MSG_CLEAR_ALL_OVERRIDES,
} from '../constants.js'
import type { FlagsMap, Overrides, Provider, ProviderId, Transport } from '../types.js'

declare global {
  interface Window { OpenFeature?: unknown }
}

let currentFlags: FlagsMap = {}
let overrides: Overrides = {}
let detectedProvider: ProviderId | null = null
let detectedTransport: Transport | null = null

const providers: Provider[] = [createLaunchDarkly(), createOpenFeature(), createPostHog()]

function getProvider(id: ProviderId | null): Provider | null {
  if (!id) return null
  return providers.find(p => p.id === id) ?? null
}

function notify(): void {
  window.postMessage({
    source: SOURCE_INJECT,
    type: MSG_FLAGS_UPDATE,
    flags: currentFlags,
    overrides,
    provider: detectedProvider,
    transport: detectedTransport,
  }, '*')
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

window.fetch = async function(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = input instanceof Request ? input.url : String(input)
  const response = await OriginalFetch(input, init)
  const detected = detectProvider(url)
  if (!detected || detected.transport !== 'polling' || !response.ok) return response

  log('fetch: polling URL matched (%s) %s %d', detected.id, url.split('?')[0], response.status)

  try {
    const data: unknown = await response.clone().json()
    const provider = getProvider(detected.id)
    if (provider) {
      const modified = provider.applyPollingOverrides(data, overrides)
      if (modified) {
        currentFlags = provider.normalizeFlags(data)
        log('fetch: flag payload ✓, %d flags', Object.keys(currentFlags).length)
        setDetected(detected.id, 'polling')
        notify()
        return new Response(JSON.stringify(modified), {
          status: response.status,
          statusText: response.statusText,
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }
    log('fetch: not a flag payload — response shape unexpected')
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
  ;(xhr as any).open = function(method: unknown, url: unknown, ...args: unknown[]): void {
    requestUrl = typeof url === 'string' ? url : String(url)
    originalOpen(method, url, ...args)
  }

  xhr.addEventListener('readystatechange', function() {
    if (xhr.readyState !== 4 || xhr.status !== 200) return
    const detected = detectProvider(requestUrl)
    if (!detected || detected.transport !== 'polling') return
    try {
      const data: unknown = JSON.parse(xhr.responseText)
      const provider = getProvider(detected.id)
      if (!provider) return
      const modified = provider.applyPollingOverrides(data, overrides)
      if (!modified) return
      currentFlags = provider.normalizeFlags(data)
      log('XHR: flag payload ✓, %d flags', Object.keys(currentFlags).length)
      setDetected(detected.id, 'polling')
      const modifiedJson = JSON.stringify(modified)
      Object.defineProperty(xhr, 'responseText', { get: () => modifiedJson, configurable: true })
      Object.defineProperty(xhr, 'response', {
        get: function() { return xhr.responseType === 'json' ? modified : modifiedJson },
        configurable: true,
      })
      log('XHR: patched responseText')
      notify()
    } catch (err) {
      log('XHR: error %o', err)
    }
  })

  return xhr
}

window.XMLHttpRequest = CustomXHR as unknown as typeof XMLHttpRequest
window.XMLHttpRequest.prototype = OriginalXHR.prototype

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

  if (!provider) return es

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(es as any).addEventListener = function(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void {
    if (!provider.sseEventTypes.has(type)) {
      originalAEL(type, listener, options)
      return
    }

    const fn = typeof listener === 'function' ? listener : listener.handleEvent.bind(listener)
    provider.registerListener(type, fn as (e: MessageEvent) => void)

    originalAEL(type, (e: Event) => {
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
    }, options)
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
  const success = ofProvider.instrumentSDK!(sdk, () => overrides, (flags: FlagsMap) => {
    currentFlags = flags
    setDetected('openfeature', 'sse')
    notify()
  })
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

log('loaded')
