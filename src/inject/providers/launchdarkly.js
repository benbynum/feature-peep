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

    // Returns the overridden flag map to send to the SDK, or null if not an LD payload.
    handleSSEPut(raw, overrides) {
      if (!isPayload(raw)) return null
      return applySSEOverrides(raw, overrides)
    },

    // Mutates currentFlags with the patched flag. Returns whether a patch was
    // recognized and, if an override is active, the modified event data to proxy.
    handleSSEPatch(raw, currentFlags, overrides) {
      let key, updated
      if (raw.key && raw.value !== undefined) {
        key = raw.key; updated = raw
      } else if (raw.path && raw.data) {
        key = raw.path.replace(/^\/flags\//, ''); updated = raw.data
      }
      if (!key || !updated) return { patched: false }

      log('EventSource patch: %s', key)
      currentFlags[key] = updated

      if (key in overrides) {
        const patchedOverride = { ...raw }
        if (raw.key) patchedOverride.value = overrides[key]
        else if (raw.path) patchedOverride.data = { ...updated, value: overrides[key] }
        return { patched: true, overrideData: patchedOverride }
      }
      return { patched: true, overrideData: null }
    },
  }
}
