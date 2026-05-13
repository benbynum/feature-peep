import { log } from '../log.js'
import type { FlagsMap, Overrides } from '../../types.js'

export function create() {
  const SCALAR = new Set(['boolean', 'string', 'number'])

  function isPayload(data: unknown): boolean {
    return data != null && typeof data === 'object' && 'featureFlags' in data &&
      typeof (data as Record<string, unknown>)['featureFlags'] === 'object'
  }

  return {
    id: 'posthog' as const,

    isPayload,

    applyPollingOverrides(data: unknown, overrides: Overrides): Record<string, unknown> | null {
      if (!isPayload(data)) return null
      const d = data as Record<string, unknown>
      const featureFlags = { ...(d['featureFlags'] as Record<string, unknown>) }
      for (const key of Object.keys(overrides)) {
        if (key in featureFlags && SCALAR.has(typeof featureFlags[key])) {
          featureFlags[key] = overrides[key]
        }
      }
      log('PostHog polling: %d flags', Object.keys(featureFlags).length)
      return { ...d, featureFlags }
    },

    normalizeFlags(data: unknown): FlagsMap {
      const featureFlags = (data as Record<string, unknown>)['featureFlags'] as Record<string, unknown>
      const normalized: FlagsMap = {}
      for (const [key, value] of Object.entries(featureFlags)) {
        if (SCALAR.has(typeof value)) normalized[key] = { value }
      }
      return normalized
    },

    registerListener(_type: string, _listener: (e: MessageEvent) => void): void {},
    fireFakePut(_flags: FlagsMap, _overrides: Overrides, notifyFn: () => void): void { notifyFn() },
    sseEventTypes: new Set<string>(),
    processSSEEvent: (): null => null,
  }
}
