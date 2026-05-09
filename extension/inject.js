(function () {
  let currentFlags = {}
  let overrides = {}
  let detectedProvider = null
  let detectedTransport = null

  // SSE only — stores SDK put listeners for fake event replay on override
  const sdkPutListeners = []

  // ─── Provider + URL detection ─────────────────────────────────────────────
  //
  // Tier 1: exact LD hostnames
  // Tier 2: relay proxy — match path patterns regardless of host

  function detectProvider(url) {
    try {
      const u = new URL(url, location.href)
      const host = u.hostname
      const path = u.pathname

      if (/(?:^|\.)(?:clientstream|stream)\.launchdarkly\.com$/.test(host)) {
        return { id: 'launchdarkly', transport: 'sse' }
      }
      if (/(?:^|\.)(?:app|sdk)\.launchdarkly\.com$/.test(host)) {
        return { id: 'launchdarkly', transport: 'polling' }
      }
      // Relay proxy path patterns
      if (/\/sdk\/evalx\/[a-f0-9-]{20,}\/contexts\//i.test(path) ||
          /\/sdk\/eval\/[a-f0-9-]{20,}\/users\//i.test(path)) {
        return { id: 'launchdarkly', transport: 'polling' }
      }
      if (/\/eval\/[a-f0-9-]{20,}\//.test(path)) {
        return { id: 'launchdarkly', transport: 'sse' }
      }
    } catch (_) {}
    return null
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  function isLDPut(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false
    const vals = Object.values(raw)
    return vals.length > 0 && typeof vals[0] === 'object' && vals[0] !== null && 'version' in vals[0]
  }

  function applyOverrides(flags) {
    const result = {}
    for (const key of Object.keys(flags)) {
      result[key] = overrides[key] !== undefined
        ? { ...flags[key], value: overrides[key] }
        : flags[key]
    }
    return result
  }

  function notifyExtension(flags, ovr) {
    window.postMessage({
      source: 'ffd-inject',
      type: 'FLAGS_UPDATE',
      flags,
      overrides: ovr,
      provider: detectedProvider,
      transport: detectedTransport,
    }, '*')
  }

  function setDetected(providerId, transport) {
    detectedProvider = providerId
    detectedTransport = transport
  }

  // ─── SSE: fake put replay for immediate override feedback ─────────────────

  function fireFakePut() {
    if (detectedTransport !== 'sse') return
    if (sdkPutListeners.length === 0 || Object.keys(currentFlags).length === 0) return
    const modified = applyOverrides(currentFlags)
    const fakeEvent = new MessageEvent('put', { data: JSON.stringify(modified) })
    for (const listener of sdkPutListeners) {
      try { listener(fakeEvent) } catch (_) {}
    }
    notifyExtension(currentFlags, overrides)
  }

  // ─── Message bridge ───────────────────────────────────────────────────────

  window.addEventListener('message', (e) => {
    if (!e.data || e.data.source !== 'ffd-content') return
    switch (e.data.type) {
      case 'INIT_OVERRIDES':
        overrides = e.data.overrides || {}
        break
      case 'SET_OVERRIDE':
        overrides[e.data.key] = e.data.value
        fireFakePut()
        break
      case 'CLEAR_OVERRIDE':
        delete overrides[e.data.key]
        fireFakePut()
        break
      case 'CLEAR_ALL_OVERRIDES':
        overrides = {}
        fireFakePut()
        break
    }
  })

  // ─── Fetch interceptor (polling) ──────────────────────────────────────────
  //
  // Intercepts polling responses, applies overrides, returns modified response
  // to the SDK. The SDK never sees unoverridden values during an active override.
  //
  // Note: overrides take effect on the NEXT poll cycle after being set, since
  // the SDK has already requested the current response before the override was
  // applied. fireFakePut() handles SSE; polling relies on the next fetch.

  const OriginalFetch = window.fetch

  window.fetch = async function (input, init) {
    const url = input instanceof Request ? input.url : String(input)
    const response = await OriginalFetch.call(this, input, init)

    const p = detectProvider(url)
    if (!p || p.transport !== 'polling' || !response.ok) return response

    try {
      const data = await response.clone().json()
      if (isLDPut(data)) {
        setDetected(p.id, 'polling')
        currentFlags = data
        notifyExtension(data, overrides)
        const modified = applyOverrides(data)
        return new Response(JSON.stringify(modified), {
          status: response.status,
          statusText: response.statusText,
          headers: { 'Content-Type': 'application/json' },
        })
      }
    } catch (_) {}

    return response
  }

  // ─── XHR interceptor (polling fallback) ───────────────────────────────────
  //
  // For older SDK versions or bundlers that use XMLHttpRequest instead of fetch.
  // Display only — XHR responses cannot be modified retroactively, so overrides
  // are reflected in the popup but the SDK sees the original values until the
  // next poll cycle.

  const OriginalXHR = window.XMLHttpRequest

  window.XMLHttpRequest = function () {
    const xhr = new OriginalXHR()
    let requestUrl = ''

    const originalOpen = xhr.open.bind(xhr)
    xhr.open = function (method, url, ...args) {
      requestUrl = typeof url === 'string' ? url : String(url)
      return originalOpen(method, url, ...args)
    }

    xhr.addEventListener('readystatechange', function () {
      if (xhr.readyState !== 4 || xhr.status !== 200) return
      const p = detectProvider(requestUrl)
      if (!p || p.transport !== 'polling') return
      try {
        const data = JSON.parse(xhr.responseText)
        if (isLDPut(data)) {
          setDetected(p.id, 'polling')
          currentFlags = data
          notifyExtension(data, overrides)
        }
      } catch (_) {}
    })

    return xhr
  }

  window.XMLHttpRequest.prototype = OriginalXHR.prototype

  // ─── EventSource interceptor (SSE) ────────────────────────────────────────

  const OriginalEventSource = window.EventSource

  window.EventSource = function (url, init) {
    const urlStr = typeof url === 'string' ? url : String(url)
    const p = detectProvider(urlStr)
    const es = new OriginalEventSource(url, init)
    const originalAddEventListener = es.addEventListener.bind(es)

    es.addEventListener = function (type, listener, options) {
      if (type === 'put' || type === 'patch' || type === 'message') {

        if (type === 'put') sdkPutListeners.push(listener)

        originalAddEventListener(type, (e) => {
          try {
            const raw = JSON.parse(e.data)

            if (type === 'put' && isLDPut(raw)) {
              if (p) setDetected(p.id, 'sse')
              currentFlags = raw
              const modified = applyOverrides(raw)
              notifyExtension(raw, overrides)
              const proxied = Object.create(e, { data: { value: JSON.stringify(modified) } })
              listener(proxied)
              return
            }

            if (type === 'patch') {
              let key, updated
              if (raw.key && raw.value !== undefined) {
                key = raw.key
                updated = raw
              } else if (raw.path && raw.data) {
                key = raw.path.replace(/^\/flags\//, '')
                updated = raw.data
              }
              if (key && updated) {
                currentFlags[key] = updated
                if (overrides[key] !== undefined) {
                  const patchedOverride = { ...raw }
                  if (raw.key) patchedOverride.value = overrides[key]
                  else if (raw.path) patchedOverride.data = { ...updated, value: overrides[key] }
                  notifyExtension(currentFlags, overrides)
                  const proxied = Object.create(e, { data: { value: JSON.stringify(patchedOverride) } })
                  listener(proxied)
                  return
                }
                notifyExtension(currentFlags, overrides)
              }
            }
          } catch (_) {}

          listener(e)
        }, options)

      } else {
        originalAddEventListener(type, listener, options)
      }
    }

    return es
  }

  window.EventSource.prototype = OriginalEventSource.prototype
  window.EventSource.CONNECTING = OriginalEventSource.CONNECTING
  window.EventSource.OPEN = OriginalEventSource.OPEN
  window.EventSource.CLOSED = OriginalEventSource.CLOSED

  window.postMessage({ source: 'ffd-inject', type: 'REQUEST_OVERRIDES' }, '*')
})()
