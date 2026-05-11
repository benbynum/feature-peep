import { log } from '../log.js'

export function create() {
  let hooked = false
  const snapshotListeners = []

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

    registerListener(type, listener) {
      if (type === 'flags-snapshot') {
        snapshotListeners.push(listener)
        log('OpenFeature: flags-snapshot listener registered, total=%d', snapshotListeners.length)
      }
    },

    // Replay a fake flags-snapshot with overrides applied so the OFREP provider
    // picks up the changes immediately without waiting for the next SSE message.
    fireFakePut(currentFlags, overrides, notifyFn) {
      log('fireFakePut (OF): listeners=%d, flags=%d', snapshotListeners.length, Object.keys(currentFlags).length)
      if (snapshotListeners.length === 0 || Object.keys(currentFlags).length === 0) {
        notifyFn()
        return
      }
      const payload = Object.entries(currentFlags).map(([key, flag]) => {
        const value = key in overrides ? overrides[key] : flag.value
        return { key, value, reason: 'STATIC', variant: String(value) }
      })
      const fakeEvent = new MessageEvent('flags-snapshot', { data: JSON.stringify(payload) })
      for (const listener of snapshotListeners) {
        try { listener(fakeEvent) } catch (err) { log('fireFakePut listener error: %o', err) }
      }
      notifyFn()
    },

    // Matnaw event names + standard OFREP spec names + LD-style fallbacks
    sseEventTypes: new Set([
      'flags-snapshot', 'flag-changed', 'flag-deleted', // Matnaw
      'provider_ready', 'configuration_change',         // OFREP spec
      'put', 'patch', 'message',                        // generic fallbacks
    ]),

    processSSEEvent(type, raw, currentFlags, overrides) {
      // flags-snapshot (Matnaw) / provider_ready / put:
      // array [{key, value, reason, variant}] or object {flags:{key:{value,flagVersion}}}
      if (type === 'flags-snapshot' || type === 'provider_ready' || type === 'put' || type === 'message') {
        if (Array.isArray(raw)) {
          const normalized = {}
          for (const flag of raw) {
            if (flag.key != null && flag.value !== undefined) {
              normalized[flag.key] = { value: flag.value, version: 0 }
            }
          }
          if (Object.keys(normalized).length === 0) return null
          log('OFREP %s: %d flags', type, Object.keys(normalized).length)
          return { flags: normalized, proxyData: null, flagsChanged: true }
        }
        if (raw.flags && typeof raw.flags === 'object') {
          const normalized = {}
          for (const [key, flag] of Object.entries(raw.flags)) {
            normalized[key] = { value: flag.value, version: flag.flagVersion || 0 }
          }
          if (Object.keys(normalized).length === 0) return null
          log('OFREP %s: %d flags', type, Object.keys(normalized).length)
          return { flags: normalized, proxyData: null, flagsChanged: true }
        }
        return null
      }

      // flag-changed (Matnaw) / configuration_change / patch: single or bulk update
      if (type === 'flag-changed' || type === 'configuration_change' || type === 'patch') {
        if (raw.key != null && raw.value !== undefined) {
          log('OFREP %s: %s', type, raw.key)
          currentFlags[raw.key] = { value: raw.value, version: 0 }
          return { flagsChanged: true, proxyData: null }
        }
        if (raw.flags && typeof raw.flags === 'object') {
          for (const [key, flag] of Object.entries(raw.flags)) {
            currentFlags[key] = { value: flag.value, version: flag.flagVersion || 0 }
          }
          log('OFREP %s: %d flags updated', type, Object.keys(raw.flags).length)
          return { flagsChanged: true, proxyData: null }
        }
        return null
      }

      // flag-deleted (Matnaw): remove flag from current state
      if (type === 'flag-deleted' && raw.key != null) {
        log('OFREP flag-deleted: %s', raw.key)
        delete currentFlags[raw.key]
        return { flagsChanged: true, proxyData: null }
      }

      return null
    },
  }
}
