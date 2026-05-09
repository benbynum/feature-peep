(function () {
  // Format-specifier-aware logger — console substitutes %s/%d/%o correctly
  const log = (fmt, ...args) => console.log(`[Flagtap] ${fmt}`, ...args)

  let currentFlags = {}
  let overrides = {}
  let detectedProvider = null
  let detectedTransport = null

  // SSE only — stores SDK put listeners for fake event replay on override
  const sdkPutListeners = []

  // Polling: track which setTimeout is the flag poll timer.
  // After a successful flag-PUT XHR response, the SDK schedules its next poll
  // via setTimeout. We mark the next captured ≥15s timeout as the flag poll
  // timer so triggerImmediatePoll only triggers THAT one, not unrelated timers
  // (e.g. LD's 15-min diagnostic event flusher).
  let expectingFlagPollTimer = false
  let flagPollTimerKey = null

  log('loaded')

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

  function applyOverrides(flags, bumpVersion = false) {
    const result = {}
    for (const key of Object.keys(flags)) {
      if (overrides[key] !== undefined) {
        const flag = flags[key]
        result[key] = {
          ...flag,
          value: overrides[key],
          // Bump version so the SDK's change-detection (version comparison) treats
          // this as a newer value and emits a change event to re-render the app.
          // Only needed for polling — SSE fake-put doesn't go through version checks.
          ...(bumpVersion ? { version: (flag.version || 0) + 1 } : {}),
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

  // ─── SSE: fake put replay for immediate override feedback ─────────────────

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

  // ─── Timer interceptors (force-poll on override) ──────────────────────────
  //
  // Captures setInterval and recursive setTimeout so we can trigger the SDK's
  // polling callback immediately on override changes.
  //
  // IMPORTANT: triggerImmediatePoll snapshots capturedPollers before iterating.
  // Without a snapshot, V8's Map iterator picks up entries added during the
  // loop (the fn() schedules its next timeout), causing an infinite loop.

  const OriginalSetInterval = window.setInterval
  const OriginalClearInterval = window.clearInterval
  const OriginalSetTimeout = window.setTimeout
  const OriginalClearTimeout = window.clearTimeout

  const capturedPollers = new Map()  // key → { call, type, nativeId? }
  let timeoutSeq = 0

  window.setInterval = function (fn, delay, ...args) {
    const id = OriginalSetInterval.call(this, fn, delay, ...args)
    if (typeof fn === 'function' && typeof delay === 'number' && delay >= 15000) {
      capturedPollers.set('i:' + id, { call: () => fn(...args), type: 'interval' })
      log('setInterval captured: delay=%dms, total pollers=%d', delay, capturedPollers.size)
    }
    return id
  }

  window.clearInterval = function (id) {
    if (capturedPollers.delete('i:' + id)) {
      log('setInterval cleared: id=%d', id)
    }
    return OriginalClearInterval.call(this, id)
  }

  window.setTimeout = function (fn, delay, ...args) {
    if (typeof fn === 'function' && typeof delay === 'number' && delay >= 15000) {
      const key = 't:' + (++timeoutSeq)
      let nativeId
      // Wrap to auto-clean from capturedPollers when the timeout fires naturally
      const wrapped = (...a) => {
        capturedPollers.delete(key)
        fn(...a)
      }
      nativeId = OriginalSetTimeout.call(this, wrapped, delay, ...args)
      const isFlagPoll = expectingFlagPollTimer
      if (isFlagPoll) { flagPollTimerKey = key; expectingFlagPollTimer = false }
      capturedPollers.set(key, { call: () => fn(...args), type: 'timeout', nativeId, key, isFlagPoll, delay })
      log('setTimeout captured: delay=%dms, key=%s, isFlagPoll=%s, total pollers=%d', delay, key, isFlagPoll, capturedPollers.size)
      return nativeId
    }
    return OriginalSetTimeout.call(this, fn, delay, ...args)
  }

  window.clearTimeout = function (id) {
    for (const [key, entry] of capturedPollers.entries()) {
      if (entry.type === 'timeout' && entry.nativeId === id) {
        capturedPollers.delete(key)
        if (key === flagPollTimerKey) flagPollTimerKey = null
        log('clearTimeout removed poller: key=%s', key)
        break
      }
    }
    return OriginalClearTimeout.call(this, id)
  }

  function triggerImmediatePoll() {
    log('triggerImmediatePoll: flagPollTimerKey=%s, capturedPollers=%d', flagPollTimerKey, capturedPollers.size)
    const entry = flagPollTimerKey ? capturedPollers.get(flagPollTimerKey) : null
    if (!entry) {
      log('triggerImmediatePoll: no flag poll timer identified — override applies on next natural poll')
      return
    }
    const key = flagPollTimerKey
    // Reschedule at 1s instead of calling directly. The SDK's poll fn fires via
    // its own code path, making the XHR naturally (overrides applied by our
    // interceptor). Avoids side effects of calling it synchronously (e.g.
    // diagnostic event flushes that run as part of the same callback).
    log('triggerImmediatePoll: rescheduling %s to fire in 1s (was %dms)', key, entry.delay)
    OriginalClearTimeout.call(window, entry.nativeId)
    capturedPollers.delete(key)
    flagPollTimerKey = null
    OriginalSetTimeout.call(window, entry.call, 1000)
    // 1s delay is below our capture threshold so no re-capture / infinite loop
  }

  function applyOverrideImmediate() {
    log('applyOverrideImmediate: transport=%s, pollers=%d, sseListeners=%d',
      detectedTransport, capturedPollers.size, sdkPutListeners.length)
    if (detectedTransport === 'sse') fireFakePut()
    else if (detectedTransport === 'polling') triggerImmediatePoll()
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
        const modified = applyOverrides(data)
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
  // Our readystatechange listener is registered in the constructor, before the
  // SDK adds its own listener. When state 4 arrives and it's a flag PUT, we
  // shadow responseText/response on the XHR instance via Object.defineProperty
  // so the SDK's listener reads the override-applied values.

  const OriginalXHR = window.XMLHttpRequest

  window.XMLHttpRequest = function () {
    const xhr = new OriginalXHR()
    let requestUrl = ''

    const originalOpen = xhr.open.bind(xhr)
    xhr.open = function (method, url, ...args) {
      requestUrl = typeof url === 'string' ? url : String(url)
      return originalOpen(method, url, ...args)
    }

    // Registered first — fires before SDK's listener
    xhr.addEventListener('readystatechange', function () {
      if (xhr.readyState !== 4 || xhr.status !== 200) return
      const p = detectProvider(requestUrl)
      if (!p || p.transport !== 'polling') return
      log('XHR: polling URL matched (%s) → %s', p.id, requestUrl.split('?')[0])
      try {
        const data = JSON.parse(xhr.responseText)
        if (!isLDPut(data)) {
          log('XHR: isLDPut ✗')
          return
        }
        log('XHR: isLDPut ✓, %d flags — patching responseText', Object.keys(data).length)
        setDetected(p.id, 'polling')
        currentFlags = data
        const modified = applyOverrides(data, true)
        const modifiedJson = JSON.stringify(modified)
        // Shadow native responseText/response so SDK's listener reads patched values.
        // response getter checks responseType: if 'json', SDK expects a parsed object.
        Object.defineProperty(xhr, 'responseText', { get: () => modifiedJson, configurable: true })
        Object.defineProperty(xhr, 'response', { get: function() { return xhr.responseType === 'json' ? modified : modifiedJson }, configurable: true })
        notifyExtension(data, overrides)
        // Flag the next ≥15s setTimeout as the poll timer (SDK schedules after XHR in some versions)
        expectingFlagPollTimer = true
        // Retroactive: SDK schedules the poll timer BEFORE the XHR in some versions.
        // If we haven't identified the flag poll timer yet, pick the shortest-delay
        // captured timer — it's most likely the flag poll, not a diagnostics flush.
        if (!flagPollTimerKey && capturedPollers.size > 0) {
          let minDelay = Infinity, minKey = null
          for (const [k, entry] of capturedPollers.entries()) {
            if (entry.delay < minDelay) { minDelay = entry.delay; minKey = k }
          }
          if (minKey) {
            flagPollTimerKey = minKey
            log('XHR: retroactively identified flag poll timer: %s (delay=%dms)', minKey, minDelay)
          }
        }
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
