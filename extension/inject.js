(function () {
  // In-memory state — survives within the page session
  let currentFlags = {}  // { flagKey: { version, flagVersion, value, variation, ... } }
  let overrides = {}     // { flagKey: overrideValue }

  // SDK's put listeners stored so we can call them directly for fake puts
  // (avoids re-entering our own interceptor)
  const sdkPutListeners = []

  // ─── Helpers ─────────────────────────────────────────────────────────────

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
    }, '*')
  }

  // Re-deliver a full put event to the SDK using stored overrides.
  // Calls SDK listeners directly — bypasses our interceptor, no recursion.
  function fireFakePut() {
    if (sdkPutListeners.length === 0 || Object.keys(currentFlags).length === 0) return
    const modified = applyOverrides(currentFlags)
    const fakeEvent = new MessageEvent('put', { data: JSON.stringify(modified) })
    for (const listener of sdkPutListeners) {
      try { listener(fakeEvent) } catch (_) {}
    }
    notifyExtension(currentFlags, overrides)
  }

  // ─── Message bridge (from content.js) ────────────────────────────────────

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

  // ─── EventSource patch ────────────────────────────────────────────────────

  const OriginalEventSource = window.EventSource

  window.EventSource = function (url, init) {
    const es = new OriginalEventSource(url, init)
    const originalAddEventListener = es.addEventListener.bind(es)

    es.addEventListener = function (type, listener, options) {
      if (type === 'put' || type === 'patch' || type === 'message') {

        if (type === 'put') {
          sdkPutListeners.push(listener)
        }

        originalAddEventListener(type, (e) => {
          try {
            const raw = JSON.parse(e.data)

            // ── put: full flag snapshot ───────────────────────────────────
            if (type === 'put' && isLDPut(raw)) {
              currentFlags = raw
              const modified = applyOverrides(raw)
              notifyExtension(raw, overrides)
              const proxied = Object.create(e, { data: { value: JSON.stringify(modified) } })
              listener(proxied)
              return
            }

            // ── patch: single flag update ─────────────────────────────────
            // LD client SDK patch format (best-effort — confirm from live obs):
            //   { key, version, flagVersion, value, variation, trackEvents }
            // OR server-side format: { path: "/flags/key", data: {...} }
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
                  if (raw.key) {
                    patchedOverride.value = overrides[key]
                  } else if (raw.path) {
                    patchedOverride.data = { ...updated, value: overrides[key] }
                  }
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

  // Request stored overrides from content.js on startup
  window.postMessage({ source: 'ffd-inject', type: 'REQUEST_OVERRIDES' }, '*')
})()
