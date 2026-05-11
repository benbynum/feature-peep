import { log } from '../log.js'

export function create() {
  let hooked = false

  return {
    id: 'openfeature',

    isPayload: () => false,
    applyPollingOverrides: () => null,

    // Patches OpenFeature client evaluation methods to capture flags and inject overrides.
    // Works for any underlying provider regardless of transport.
    hookSDK(openFeature, getOverrides, onFlagsUpdate) {
      if (hooked) return true
      const client = openFeature.getClient?.()
      if (!client) {
        log('OpenFeature: getClient() unavailable')
        return false
      }

      const capturedFlags = {}

      // We hook both Value and Details variants to capture flags regardless of which
      // the app calls. Value methods return the raw value; Details methods return
      // { value, flagKey, reason, variant, ... }
      const valueMethods = ['getBooleanValue', 'getStringValue', 'getNumberValue', 'getObjectValue']
      const detailsMethods = ['getBooleanDetails', 'getStringDetails', 'getNumberDetails', 'getObjectDetails']

      for (const method of valueMethods) {
        const original = client[method]?.bind(client)
        if (!original) continue
        client[method] = function (flagKey, defaultValue, ...args) {
          const ovr = getOverrides()
          if (flagKey in ovr) {
            if (capturedFlags[flagKey]?.value !== ovr[flagKey]) {
              capturedFlags[flagKey] = { value: ovr[flagKey] }
              onFlagsUpdate({ ...capturedFlags })
            }
            return ovr[flagKey]
          }
          const value = original(flagKey, defaultValue, ...args)
          if (capturedFlags[flagKey]?.value !== value || !(flagKey in capturedFlags)) {
            capturedFlags[flagKey] = { value }
            onFlagsUpdate({ ...capturedFlags })
          }
          return value
        }
      }

      for (const method of detailsMethods) {
        const original = client[method]?.bind(client)
        if (!original) continue
        client[method] = function (flagKey, defaultValue, ...args) {
          const ovr = getOverrides()
          if (flagKey in ovr) {
            if (capturedFlags[flagKey]?.value !== ovr[flagKey]) {
              capturedFlags[flagKey] = { value: ovr[flagKey] }
              onFlagsUpdate({ ...capturedFlags })
            }
            return { value: ovr[flagKey], flagKey, reason: 'OVERRIDE' }
          }
          const details = original(flagKey, defaultValue, ...args)
          if (capturedFlags[flagKey]?.value !== details.value || !(flagKey in capturedFlags)) {
            capturedFlags[flagKey] = { value: details.value }
            onFlagsUpdate({ ...capturedFlags })
          }
          return details
        }
      }

      hooked = true
      log('OpenFeature: client hooked (%d methods patched)', valueMethods.length + detailsMethods.length)
      return true
    },

    registerPutListener() {},

    // No SSE replay for OF — evaluation hooks return overrides on the next call.
    // Just fire notify() so the popup stays in sync with the current override state.
    fireFakePut(currentFlags, overrides, notifyFn) {
      notifyFn()
    },

    // OFREP SSE event types (OpenFeature Remote Evaluation Protocol).
    // provider_ready = full flag state (like LD's put)
    // configuration_change = partial update (like LD's patch)
    sseEventTypes: new Set(['provider_ready', 'configuration_change']),

    processSSEEvent(type, raw, currentFlags, overrides) {
      if (type === 'provider_ready') {
        if (!raw.flags || typeof raw.flags !== 'object') return null
        const normalized = {}
        for (const [key, flag] of Object.entries(raw.flags)) {
          normalized[key] = { value: flag.value, version: flag.flagVersion || 0 }
        }
        log('OFREP provider_ready: %d flags', Object.keys(normalized).length)
        // Pass through original event — the provider reads it directly; overrides
        // are handled by evaluation hooks, not by modifying the SSE stream.
        return { flags: normalized, proxyData: null, flagsChanged: true }
      }
      if (type === 'configuration_change') {
        if (!raw.flags || typeof raw.flags !== 'object') return null
        for (const [key, flag] of Object.entries(raw.flags)) {
          currentFlags[key] = { value: flag.value, version: flag.flagVersion || 0 }
        }
        log('OFREP configuration_change: %d flags updated', Object.keys(raw.flags).length)
        return { flagsChanged: true, proxyData: null }
      }
      return null
    },
  }
}
