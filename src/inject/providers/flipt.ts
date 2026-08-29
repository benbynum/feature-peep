import { log } from '../log.js'
import type { FlagsMap, Overrides } from '../../types.js'

interface FliptFlag {
  key: string
  enabled: boolean
  type: 'BOOLEAN_FLAG_TYPE' | 'VARIANT_FLAG_TYPE'
}

interface FliptSnapshot {
  namespace?: { key: string }
  flags: FliptFlag[]
  digest?: string
}

export function create() {
  function isPayload(data: unknown): boolean {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return false
    const d = data as Record<string, unknown>
    if (!Array.isArray(d['flags'])) return false
    const ns = d['namespace']
    return ns != null && typeof ns === 'object' && 'key' in (ns as object)
  }

  return {
    id: 'flipt' as const,

    isPayload,

    // Variant flags require replicating Flipt's segment-matching + rollout engine to know the
    // evaluated value — not attempted yet, so only boolean flags (a plain `enabled` field) are
    // observed/overridable. Variant flags are silently omitted rather than shown with a guess.
    applyPollingOverrides(data: unknown, overrides: Overrides): Record<string, unknown> | null {
      if (!isPayload(data)) return null
      const cloned = JSON.parse(JSON.stringify(data)) as FliptSnapshot
      for (const flag of cloned.flags) {
        if (flag.type !== 'BOOLEAN_FLAG_TYPE') continue
        if (!(flag.key in overrides)) continue
        const override = overrides[flag.key]
        if (typeof override !== 'boolean') continue
        flag.enabled = override
      }
      log('Flipt polling: %d flags', cloned.flags.length)
      return cloned as unknown as Record<string, unknown>
    },

    normalizeFlags(data: unknown): FlagsMap {
      if (!isPayload(data)) return {}
      const d = data as unknown as FliptSnapshot
      const normalized: FlagsMap = {}
      for (const flag of d.flags) {
        if (flag.type === 'BOOLEAN_FLAG_TYPE') normalized[flag.key] = { value: flag.enabled }
      }
      return normalized
    },

    registerListener(_type: string, _listener: (e: MessageEvent) => void): void {},
    dispatchFlagsUpdate(_flags: FlagsMap, _overrides: Overrides, notifyFn: () => void): void {
      notifyFn()
    },
    sseEventTypes: new Set<string>(),
    processSSEEvent: (): null => null,
  }
}
