import { log } from '../log.js'

export function create() {
  const SCALAR = new Set(['boolean', 'string', 'number'])

  function isPayload(data) {
    return data != null && typeof data === 'object' && 'featureFlags' in data &&
      typeof data.featureFlags === 'object'
  }

  return {
    id: 'posthog',

    isPayload,

    applyPollingOverrides(data, overrides) {
      if (!isPayload(data)) return null
      const featureFlags = { ...data.featureFlags }
      for (const key of Object.keys(overrides)) {
        if (key in featureFlags && SCALAR.has(typeof featureFlags[key])) {
          featureFlags[key] = overrides[key]
        }
      }
      log('PostHog polling: %d flags', Object.keys(featureFlags).length)
      return { ...data, featureFlags }
    },

    normalizeFlags(data) {
      const normalized = {}
      for (const [key, value] of Object.entries(data.featureFlags)) {
        if (SCALAR.has(typeof value)) normalized[key] = { value }
      }
      return normalized
    },

    registerListener: () => {},
    fireFakePut(_flags, _overrides, notifyFn) { notifyFn() },
    sseEventTypes: new Set(),
    processSSEEvent: () => null,
  }
}
