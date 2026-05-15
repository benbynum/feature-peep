import { log } from '../log.js'
import type { FlagsMap, Overrides } from '../../types.js'

export function create() {
  const SCALAR = new Set(['boolean', 'string', 'number'])

  function isV1Payload(data: unknown): boolean {
    return data != null && typeof data === 'object' && 'featureFlags' in (data as object) &&
      typeof (data as Record<string, unknown>)['featureFlags'] === 'object'
  }

  // v2: { flags: { key: { enabled, variant?, ... } } } — object, not array (OFREP uses array)
  function isV2Payload(data: unknown): boolean {
    if (!data || typeof data !== 'object') return false
    const d = data as Record<string, unknown>
    if (!('flags' in d) || typeof d['flags'] !== 'object' || Array.isArray(d['flags'])) return false
    const vals = Object.values(d['flags'] as object)
    return vals.length === 0 || (typeof vals[0] === 'object' && vals[0] !== null && 'enabled' in (vals[0] as object))
  }

  function isPayload(data: unknown): boolean {
    return isV1Payload(data) || isV2Payload(data)
  }

  return {
    id: 'posthog' as const,

    isPayload,

    applyPollingOverrides(data: unknown, overrides: Overrides): Record<string, unknown> | null {
      if (isV1Payload(data)) {
        const d = data as Record<string, unknown>
        const featureFlags = { ...(d['featureFlags'] as Record<string, unknown>) }
        for (const key of Object.keys(overrides)) {
          if (key in featureFlags && SCALAR.has(typeof featureFlags[key])) {
            featureFlags[key] = overrides[key]
          }
        }
        log('PostHog v1 polling: %d flags', Object.keys(featureFlags).length)
        return { ...d, featureFlags }
      }
      if (isV2Payload(data)) {
        const d = data as Record<string, unknown>
        const flags = { ...(d['flags'] as Record<string, Record<string, unknown>>) }
        for (const key of Object.keys(overrides)) {
          if (!(key in flags)) continue
          const override = overrides[key]
          const flag = { ...flags[key] }
          if (typeof override === 'boolean') {
            flag['enabled'] = override
            delete flag['variant']
          } else {
            flag['enabled'] = true
            flag['variant'] = String(override)
          }
          flags[key] = flag
        }
        log('PostHog v2 polling: %d flags', Object.keys(flags).length)
        return { ...d, flags }
      }
      return null
    },

    normalizeFlags(data: unknown): FlagsMap {
      if (isV1Payload(data)) {
        const featureFlags = (data as Record<string, unknown>)['featureFlags'] as Record<string, unknown>
        const normalized: FlagsMap = {}
        for (const [key, value] of Object.entries(featureFlags)) {
          if (SCALAR.has(typeof value)) normalized[key] = { value }
        }
        return normalized
      }
      // v2: value is variant if present, otherwise enabled (boolean)
      const flags = (data as Record<string, unknown>)['flags'] as Record<string, Record<string, unknown>>
      const normalized: FlagsMap = {}
      for (const [key, flag] of Object.entries(flags)) {
        normalized[key] = { value: flag['variant'] != null ? flag['variant'] : flag['enabled'] }
      }
      return normalized
    },

    registerListener(_type: string, _listener: (e: MessageEvent) => void): void {},
    dispatchFlagsUpdate(_flags: FlagsMap, _overrides: Overrides, notifyFn: () => void): void { notifyFn() },
    sseEventTypes: new Set<string>(),
    processSSEEvent: (): null => null,
  }
}
