import { log } from '../log.js'

export function create() {
  const putListeners = []
  let pollBump = 0

  function isPayload(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return false
    const vals = Object.values(data)
    return vals.length > 0 && typeof vals[0] === 'object' && vals[0] !== null && 'version' in vals[0]
  }

  // Plain value substitution — no version bump needed for SSE.
  function applySSEOverrides(flags, overrides) {
    const result = {}
    for (const key of Object.keys(flags)) {
      result[key] = key in overrides ? { ...flags[key], value: overrides[key] } : flags[key]
    }
    return result
  }

  return {
    id: 'launchdarkly',

    isPayload,

    // Modifies a polling flag payload to inject overrides. Bumps version fields
    // so the SDK's change-detection (newVersion > storedVersion) fires correctly.
    // Returns the modified payload, or null if data is not a flag payload.
    applyPollingOverrides(data, overrides) {
      if (!isPayload(data)) return null
      ++pollBump
      const result = {}
      for (const key of Object.keys(data)) {
        if (key in overrides) {
          const flag = data[key]
          result[key] = {
            ...flag,
            value: overrides[key],
            version: (flag.version || 0) + pollBump,
            ...(flag.flagVersion !== undefined ? { flagVersion: flag.flagVersion + pollBump } : {}),
          }
        } else {
          result[key] = data[key]
        }
      }
      return result
    },

    registerPutListener(listener) {
      putListeners.push(listener)
      log('EventSource: put listener registered, total=%d', putListeners.length)
    },

    fireFakePut(currentFlags, overrides, notifyFn) {
      log('fireFakePut: listeners=%d, flags=%d', putListeners.length, Object.keys(currentFlags).length)
      if (putListeners.length === 0 || Object.keys(currentFlags).length === 0) return
      const modified = applySSEOverrides(currentFlags, overrides)
      const fakeEvent = new MessageEvent('put', { data: JSON.stringify(modified) })
      for (const listener of putListeners) {
        try { listener(fakeEvent) } catch (err) { log('fireFakePut listener error: %o', err) }
      }
      notifyFn()
    },

    sseEventTypes: new Set(['put', 'patch', 'message']),

    // Unified SSE event handler. Returns null for unrecognized events (passthrough).
    // { flags }     → replace currentFlags with this value
    // { proxyData } → proxy this JSON string to the SDK instead of the original event
    // { flagsChanged } → call notify() and setDetected
    processSSEEvent(type, raw, currentFlags, overrides) {
      if (type === 'put') {
        if (!isPayload(raw)) return null
        const modified = applySSEOverrides(raw, overrides)
        return { flags: raw, proxyData: JSON.stringify(modified), flagsChanged: true }
      }
      if (type === 'patch') {
        let key, updated
        if (raw.key && raw.value !== undefined) {
          key = raw.key; updated = raw
        } else if (raw.path && raw.data) {
          key = raw.path.replace(/^\/flags\//, ''); updated = raw.data
        }
        if (!key || !updated) return null
        log('EventSource patch: %s', key)
        currentFlags[key] = updated
        if (key in overrides) {
          const patchedOverride = { ...raw }
          if (raw.key) patchedOverride.value = overrides[key]
          else if (raw.path) patchedOverride.data = { ...updated, value: overrides[key] }
          return { flagsChanged: true, proxyData: JSON.stringify(patchedOverride) }
        }
        return { flagsChanged: true, proxyData: null }
      }
      return null
    },
  }
}
