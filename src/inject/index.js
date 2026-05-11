import { log } from './log.js'
import { detectProvider } from './detection.js'
import { create as createLaunchDarkly } from './providers/launchdarkly.js'
import { create as createOpenFeature } from './providers/openfeature.js'

let currentFlags = {}
let overrides = {}
let detectedProvider = null
let detectedTransport = null

const providers = [createLaunchDarkly(), createOpenFeature()]

function getProvider(id) {
  return providers.find(p => p.id === id) ?? null
}

function notify() {
  window.postMessage({
    source: 'fc-inject',
    type: 'FLAGS_UPDATE',
    flags: currentFlags,
    overrides,
    provider: detectedProvider,
    transport: detectedTransport,
  }, '*')
}

function setDetected(id, transport) {
  detectedProvider = id
  detectedTransport = transport
}

// ── Override application ──────────────────────────────────────────────────

function applyOverrideImmediate() {
  log('applyOverrideImmediate: transport=%s, provider=%s', detectedTransport, detectedProvider)
  if (detectedTransport === 'sse') {
    getProvider(detectedProvider)?.fireFakePut(currentFlags, overrides, notify)
  }
  // Polling overrides are injected via the XHR/fetch interceptors on the next request.
}

// ── Message bridge ────────────────────────────────────────────────────────

window.addEventListener('message', (e) => {
  if (!e.data || e.data.source !== 'fc-content') return
  switch (e.data.type) {
    case 'INIT_OVERRIDES':
      overrides = e.data.overrides || {}
      log('INIT_OVERRIDES: %o', overrides)
      break
    case 'SET_OVERRIDE':
      log('SET_OVERRIDE: %s =', e.data.key, e.data.value)
      overrides[e.data.key] = e.data.value
      applyOverrideImmediate()
      break
    case 'CLEAR_OVERRIDE':
      log('CLEAR_OVERRIDE: %s', e.data.key)
      delete overrides[e.data.key]
      applyOverrideImmediate()
      break
    case 'CLEAR_ALL_OVERRIDES':
      log('CLEAR_ALL_OVERRIDES')
      overrides = {}
      applyOverrideImmediate()
      break
  }
})

// ── Fetch interceptor (polling) ───────────────────────────────────────────

const OriginalFetch = window.fetch

window.fetch = async function (input, init) {
  const url = input instanceof Request ? input.url : String(input)
  const response = await OriginalFetch.call(this, input, init)
  const detected = detectProvider(url)
  if (!detected || detected.transport !== 'polling' || !response.ok) return response

  log('fetch: polling URL matched (%s) %s %d', detected.id, url.split('?')[0], response.status)

  try {
    const data = await response.clone().json()
    const provider = getProvider(detected.id)
    const modified = provider?.applyPollingOverrides(data, overrides)
    if (modified) {
      log('fetch: flag payload ✓, %d flags', Object.keys(data).length)
      setDetected(detected.id, 'polling')
      currentFlags = data
      notify()
      return new Response(JSON.stringify(modified), {
        status: response.status,
        statusText: response.statusText,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    log('fetch: not a flag payload — response shape unexpected')
  } catch (err) {
    log('fetch: parse error %o', err)
  }

  return response
}

// ── XHR interceptor (polling) ─────────────────────────────────────────────

const OriginalXHR = window.XMLHttpRequest

window.XMLHttpRequest = function () {
  const xhr = new OriginalXHR()
  let requestUrl = ''

  const originalOpen = xhr.open.bind(xhr)
  xhr.open = function (method, url, ...args) {
    requestUrl = typeof url === 'string' ? url : String(url)
    return originalOpen(method, url, ...args)
  }

  xhr.addEventListener.call(xhr, 'readystatechange', function () {
    if (xhr.readyState !== 4 || xhr.status !== 200) return
    const detected = detectProvider(requestUrl)
    if (!detected || detected.transport !== 'polling') return
    try {
      const data = JSON.parse(xhr.responseText)
      const provider = getProvider(detected.id)
      const modified = provider?.applyPollingOverrides(data, overrides)
      if (!modified) return
      log('XHR: flag payload ✓, %d flags', Object.keys(data).length)
      setDetected(detected.id, 'polling')
      currentFlags = data
      const modifiedJson = JSON.stringify(modified)
      Object.defineProperty(xhr, 'responseText', { get: () => modifiedJson, configurable: true })
      Object.defineProperty(xhr, 'response', {
        get: function () { return xhr.responseType === 'json' ? modified : modifiedJson },
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

window.XMLHttpRequest.prototype = OriginalXHR.prototype

// ── EventSource interceptor (SSE) ─────────────────────────────────────────

const OriginalEventSource = window.EventSource

window.EventSource = function (url, init) {
  const urlStr = typeof url === 'string' ? url : String(url)
  const detected = detectProvider(urlStr)
  log('EventSource created: %s → %s', urlStr.split('?')[0], detected ? detected.transport : 'not detected')
  const es = new OriginalEventSource(url, init)
  const originalAEL = es.addEventListener.bind(es)

  const provider = detected ? getProvider(detected.id) : null

  // Unrecognized URL on a page with the OpenFeature SDK — tag as OF SSE.
  // We can't parse the event format, but we know the transport and the SDK
  // evaluation hooks already handle flag capture and overrides.
  if (!provider && typeof window.OpenFeature !== 'undefined') {
    log('EventSource: unknown URL with OpenFeature SDK — transport tagged as openfeature/sse')
    if (!detectedProvider) setDetected('openfeature', 'sse')
    return es
  }

  if (!provider) return es

  es.addEventListener = function (type, listener, options) {
    if (!provider.sseEventTypes.has(type)) {
      originalAEL(type, listener, options)
      return
    }

    provider.registerListener?.(type, listener)

    originalAEL(type, (e) => {
      try {
        const raw = JSON.parse(e.data)
        const result = provider.processSSEEvent(type, raw, currentFlags, overrides)
        if (result) {
          if (result.flags) currentFlags = result.flags
          if (result.flagsChanged) {
            setDetected(detected.id, 'sse')
            log('EventSource %s: %d flags, provider=%s', type, Object.keys(currentFlags).length, detected.id)
            notify()
          }
          if (result.proxyData != null) {
            const proxied = Object.create(e, { data: { value: result.proxyData } })
            listener(proxied)
            return
          }
        }
      } catch (_) {}
      listener(e)
    }, options)
  }

  return es
}

window.EventSource.prototype = OriginalEventSource.prototype
window.EventSource.CONNECTING = OriginalEventSource.CONNECTING
window.EventSource.OPEN = OriginalEventSource.OPEN
window.EventSource.CLOSED = OriginalEventSource.CLOSED

window.postMessage({ source: 'fc-inject', type: 'REQUEST_OVERRIDES' }, '*')

// ── OpenFeature SDK detection ─────────────────────────────────────────────
// Intercepts window.OpenFeature assignment so we catch it the instant it's set,
// regardless of when the app initializes the SDK relative to our script.

function tryHookOpenFeature(sdk) {
  const ofProvider = getProvider('openfeature')
  if (!ofProvider) return
  const success = ofProvider.hookSDK(sdk, () => overrides, (flags) => {
    currentFlags = flags
    // Only claim openfeature if a specific provider hasn't already been detected
    // (e.g. LD native via the LD OpenFeature adapter).
    if (!detectedProvider) setDetected('openfeature', 'sse')
    notify()
  })
  if (success && !detectedProvider) setDetected('openfeature', 'sse')
}

;(function setupOpenFeatureDetection() {
  if (typeof window.OpenFeature !== 'undefined') {
    tryHookOpenFeature(window.OpenFeature)
    return
  }
  // Trap the assignment — removed immediately after the first set.
  Object.defineProperty(window, 'OpenFeature', {
    configurable: true,
    set(sdk) {
      Object.defineProperty(window, 'OpenFeature', { value: sdk, writable: true, configurable: true })
      tryHookOpenFeature(sdk)
    },
  })
})()

log('loaded')
