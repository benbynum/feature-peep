(function () {
  // Format-specifier-aware logger — console substitutes %s/%d/%o correctly
  const log = (fmt, ...args) => console.log(`[Flagtap] ${fmt}`, ...args)

  let currentFlags = {}
  let overrides = {}
  let detectedProvider = null
  let detectedTransport = null

  // Monotonically increasing version bump applied to every XHR patch or fake put.
  // Ensures each push to the SDK has a strictly higher version than the last,
  // so the SDK's change-detection (newVersion > storedVersion) always fires.
  let pollBump = 0

  // SSE — stores SDK put listeners for fake event replay on override
  const sdkPutListeners = []

  // Polling — stores the SDK's readystatechange handlers from the evalx XHR
  // so we can replay them directly (analogous to SSE fake-put) instead of
  // waiting for the next natural poll.
  const sdkPollingHandlers = []  // { xhr, fns: [fn, ...] }

  log('loaded')

  // ─── Provider + URL detection ─────────────────────────────────────────────

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

  // Applies current overrides to a flag map. bumpVersion increments pollBump
  // so the SDK's version comparison sees this as newer than what it last stored.
  function applyOverrides(flags, bumpVersion = false) {
    if (bumpVersion) ++pollBump
    const result = {}
    for (const key of Object.keys(flags)) {
      if (overrides[key] !== undefined) {
        const flag = flags[key]
        result[key] = {
          ...flag,
          value: overrides[key],
          ...(bumpVersion ? {
            version: (flag.version || 0) + pollBump,
            ...(flag.flagVersion !== undefined ? { flagVersion: flag.flagVersion + pollBump } : {}),
          } : {}),
        }
      } else {
        result[key] = flags[key]
      }
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

  // ─── SSE: fake put replay ─────────────────────────────────────────────────

  function fireFakePut() {
    log('fireFakePut: listeners=%d, flags=%d', sdkPutListeners.length, Object.keys(currentFlags).length)
    if (sdkPutListeners.length === 0 || Object.keys(currentFlags).length === 0) return
    const modified = applyOverrides(currentFlags)
    const fakeEvent = new MessageEvent('put', { data: JSON.stringify(modified) })
    for (const listener of sdkPutListeners) {
      try { listener(fakeEvent) } catch (err) { log('fireFakePut listener error: %o', err) }
    }
    notifyExtension(currentFlags, overrides)
  }

  // ─── Polling: fake XHR response replay ───────────────────────────────────
  //
  // The LD SDK makes one evalx XHR at startup. Subsequent polls use a mechanism
  // we can't intercept via timers (the 15-min timer is the diagnostic flush, not
  // the flag poll). Instead we store the SDK's readystatechange handlers from
  // the initial evalx XHR and re-invoke them directly with patched data —
  // exactly like SSE fake-put but for XHR.

  function firePollingFakePut() {
    log('firePollingFakePut: handlers=%d, flags=%d', sdkPollingHandlers.length, Object.keys(currentFlags).length)
    if (sdkPollingHandlers.length === 0 || Object.keys(currentFlags).length === 0) return

    ++pollBump
    // Bump ALL flags so the SDK sees every flag as "newer", even ones being
    // restored to their original value (e.g. after CLEAR_OVERRIDE).
    const modified = {}
    for (const key of Object.keys(currentFlags)) {
      const flag = currentFlags[key]
      modified[key] = {
        ...flag,
        value: overrides[key] !== undefined ? overrides[key] : flag.value,
        version: (flag.version || 0) + pollBump,
        ...(flag.flagVersion !== undefined ? { flagVersion: flag.flagVersion + pollBump } : {}),
      }
    }
    const modifiedJson = JSON.stringify(modified)
    log('firePollingFakePut: bump=%d  overrides=%d', pollBump, Object.keys(overrides).length)

    const { xhr, fns } = sdkPollingHandlers[sdkPollingHandlers.length - 1]
    Object.defineProperty(xhr, 'responseText', { get: () => modifiedJson, configurable: true })
    Object.defineProperty(xhr, 'response', {
      get: function () { return xhr.responseType === 'json' ? modified : modifiedJson },
      configurable: true,
    })

    for (const fn of fns) {
      try { fn.call(xhr) } catch (e) { log('firePollingFakePut: handler error %o', e) }
    }
    notifyExtension(currentFlags, overrides)
  }

  // ─── applyOverrideImmediate ───────────────────────────────────────────────

  function applyOverrideImmediate() {
    log('applyOverrideImmediate: transport=%s, pollingHandlers=%d, sseListeners=%d',
      detectedTransport, sdkPollingHandlers.length, sdkPutListeners.length)
    if (detectedTransport === 'sse') fireFakePut()
    else if (detectedTransport === 'polling') firePollingFakePut()
  }

  // ─── Message bridge ───────────────────────────────────────────────────────

  window.addEventListener('message', (e) => {
    if (!e.data || e.data.source !== 'ffd-content') return
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

  // ─── Fetch interceptor (polling) ──────────────────────────────────────────

  const OriginalFetch = window.fetch

  window.fetch = async function (input, init) {
    const url = input instanceof Request ? input.url : String(input)
    const response = await OriginalFetch.call(this, input, init)

    const p = detectProvider(url)
    if (!p || p.transport !== 'polling' || !response.ok) return response

    log('fetch: polling URL matched (%s) %s %d', p.id, url.split('?')[0], response.status)

    try {
      const data = await response.clone().json()
      if (isLDPut(data)) {
        log('fetch: isLDPut ✓, %d flags', Object.keys(data).length)
        setDetected(p.id, 'polling')
        currentFlags = data
        notifyExtension(data, overrides)
        const modified = applyOverrides(data, true)
        return new Response(JSON.stringify(modified), {
          status: response.status,
          statusText: response.statusText,
          headers: { 'Content-Type': 'application/json' },
        })
      } else {
        log('fetch: isLDPut ✗ — response shape unexpected')
      }
    } catch (err) {
      log('fetch: parse error %o', err)
    }

    return response
  }

  // ─── XHR interceptor (polling) ────────────────────────────────────────────
  //
  // Two responsibilities:
  // 1. Patch the initial evalx XHR response so overrides already in storage
  //    apply immediately on page load (works because we register our
  //    readystatechange listener before the SDK registers its own).
  // 2. Capture the SDK's readystatechange handler(s) so firePollingFakePut
  //    can replay them later without a new network round-trip.

  const OriginalXHR = window.XMLHttpRequest

  window.XMLHttpRequest = function () {
    const xhr = new OriginalXHR()
    let requestUrl = ''
    const capturedSdkHandlers = []  // handlers registered via addEventListener after ours
    let onRscHandler = null         // handler assigned via xhr.onreadystatechange = fn
    let onRscWired = false          // wrapper listener registered at most once

    const originalOpen = xhr.open.bind(xhr)
    xhr.open = function (method, url, ...args) {
      requestUrl = typeof url === 'string' ? url : String(url)
      return originalOpen(method, url, ...args)
    }

    // Capture handlers registered via addEventListener (after ours).
    const originalAddEventListener = xhr.addEventListener.bind(xhr)
    xhr.addEventListener = function (type, listener, options) {
      if (type === 'readystatechange') capturedSdkHandlers.push(listener)
      return originalAddEventListener(type, listener, options)
    }

    // Intercept onreadystatechange property assignment.
    // When the SDK does `xhr.onreadystatechange = fn` we store fn and wire it
    // as a regular event listener (via originalAddEventListener) so it fires
    // after our own listener in registration order.
    Object.defineProperty(xhr, 'onreadystatechange', {
      get: () => onRscHandler,
      set: (fn) => {
        onRscHandler = fn
        if (fn && !onRscWired) {
          onRscWired = true
          originalAddEventListener('readystatechange', function () {
            if (onRscHandler) onRscHandler.call(xhr)
          })
        }
      },
      configurable: true,
    })

    // Our listener — registered first via originalAddEventListener so it fires
    // before any SDK handler (both addEventListener and onreadystatechange).
    originalAddEventListener('readystatechange', function () {
      if (xhr.readyState !== 4 || xhr.status !== 200) return
      const p = detectProvider(requestUrl)
      if (!p || p.transport !== 'polling') return
      try {
        const data = JSON.parse(xhr.responseText)
        if (!isLDPut(data)) return
        log('XHR: isLDPut ✓, %d flags', Object.keys(data).length)
        setDetected(p.id, 'polling')
        currentFlags = data

        // Collect all SDK handlers for fake-put replay
        const sdkFns = [...capturedSdkHandlers]
        if (onRscHandler) sdkFns.push(onRscHandler)
        if (sdkFns.length > 0) {
          sdkPollingHandlers.push({ xhr, fns: sdkFns })
          log('XHR: stored %d SDK handler(s) for polling fake-put', sdkFns.length)
        } else {
          log('XHR: no SDK handlers captured — fake-put unavailable')
        }

        const modified = applyOverrides(data, true)
        const modifiedJson = JSON.stringify(modified)
        Object.defineProperty(xhr, 'responseText', { get: () => modifiedJson, configurable: true })
        Object.defineProperty(xhr, 'response', {
          get: function () { return xhr.responseType === 'json' ? modified : modifiedJson },
          configurable: true,
        })
        log('XHR: patched responseText (bump=%d)', pollBump)
        notifyExtension(data, overrides)
      } catch (err) {
        log('XHR: error %o', err)
      }
    })

    return xhr
  }

  window.XMLHttpRequest.prototype = OriginalXHR.prototype

  // ─── EventSource interceptor (SSE) ────────────────────────────────────────

  const OriginalEventSource = window.EventSource

  window.EventSource = function (url, init) {
    const urlStr = typeof url === 'string' ? url : String(url)
    const p = detectProvider(urlStr)
    log('EventSource created: %s → %s', urlStr.split('?')[0], p ? p.transport : 'not detected')
    const es = new OriginalEventSource(url, init)
    const originalAddEventListener = es.addEventListener.bind(es)

    es.addEventListener = function (type, listener, options) {
      if (type === 'put' || type === 'patch' || type === 'message') {

        if (type === 'put') {
          sdkPutListeners.push(listener)
          log('EventSource: put listener registered, total=%d', sdkPutListeners.length)
        }

        originalAddEventListener(type, (e) => {
          try {
            const raw = JSON.parse(e.data)

            if (type === 'put' && isLDPut(raw)) {
              if (p) setDetected(p.id, 'sse')
              log('EventSource put: %d flags, provider=%s', Object.keys(raw).length, p?.id)
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
                log('EventSource patch: %s', key)
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
