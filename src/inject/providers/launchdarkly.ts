import { log } from '../log.js'
import type { FlagsMap, Overrides, SSEEventResult } from '../../types.js'

export function create() {
  const putListeners: Array<(e: MessageEvent) => void> = []
  let pollBump = 0

  function isPayload(data: unknown): boolean {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return false
    const vals = Object.values(data as Record<string, unknown>)
    return vals.length > 0 && typeof vals[0] === 'object' && vals[0] !== null && 'version' in (vals[0] as object)
  }

  function applySSEOverrides(flags: FlagsMap, overrides: Overrides): FlagsMap {
    const result: FlagsMap = {}
    for (const key of Object.keys(flags)) {
      result[key] = key in overrides ? { ...flags[key], value: overrides[key] } : flags[key]
    }
    return result
  }

  return {
    id: 'launchdarkly' as const,

    isPayload,

    applyPollingOverrides(data: unknown, overrides: Overrides): Record<string, unknown> | null {
      if (!isPayload(data)) return null
      const d = data as Record<string, Record<string, unknown>>
      ++pollBump
      const result: Record<string, unknown> = {}
      for (const key of Object.keys(d)) {
        if (key in overrides) {
          const flag = d[key]
          result[key] = {
            ...flag,
            value: overrides[key],
            version: ((flag['version'] as number) || 0) + pollBump,
            ...(flag['flagVersion'] !== undefined ? { flagVersion: (flag['flagVersion'] as number) + pollBump } : {}),
          }
        } else {
          result[key] = d[key]
        }
      }
      return result
    },

    normalizeFlags(data: unknown): FlagsMap {
      const d = data as Record<string, Record<string, unknown>>
      const normalized: FlagsMap = {}
      for (const [key, flag] of Object.entries(d)) {
        if (flag && typeof flag === 'object' && 'value' in flag) {
          normalized[key] = { value: flag['value'] }
        }
      }
      return normalized
    },

    registerListener(type: string, listener: (e: MessageEvent) => void): void {
      if (type === 'put') {
        putListeners.push(listener)
        log('EventSource: put listener registered, total=%d', putListeners.length)
      }
    },

    dispatchFlagsUpdate(currentFlags: FlagsMap, overrides: Overrides, notifyFn: () => void): void {
      log('dispatchFlagsUpdate: listeners=%d, flags=%d', putListeners.length, Object.keys(currentFlags).length)
      if (putListeners.length === 0 || Object.keys(currentFlags).length === 0) return
      const modified = applySSEOverrides(currentFlags, overrides)
      const fakeEvent = new MessageEvent('put', { data: JSON.stringify(modified) })
      for (const listener of putListeners) {
        try { listener(fakeEvent) } catch (err) { log('dispatchFlagsUpdate listener error: %o', err) }
      }
      notifyFn()
    },

    sseEventTypes: new Set(['put', 'patch', 'message']),

    processSSEEvent(type: string, raw: unknown, currentFlags: FlagsMap, overrides: Overrides): SSEEventResult | null {
      if (type === 'put') {
        if (!isPayload(raw)) return null
        const modified = applySSEOverrides(raw as FlagsMap, overrides)
        return { flags: raw as FlagsMap, proxyData: JSON.stringify(modified), flagsChanged: true }
      }
      if (type === 'patch') {
        const r = raw as Record<string, unknown>
        let key: string | undefined
        let updated: unknown
        if (r['key'] != null && r['value'] !== undefined) {
          key = r['key'] as string
          updated = raw
        } else if (r['path'] != null && r['data'] != null) {
          key = (r['path'] as string).replace(/^\/flags\//, '')
          updated = r['data']
        }
        if (!key || updated === undefined) return null
        log('EventSource patch: %s', key)
        currentFlags[key] = { value: (updated as Record<string, unknown>)['value'] }
        if (key in overrides) {
          const patchedOverride = { ...r }
          if (r['key'] != null) patchedOverride['value'] = overrides[key]
          else if (r['path'] != null) patchedOverride['data'] = { ...(r['data'] as object), value: overrides[key] }
          return { flagsChanged: true, proxyData: JSON.stringify(patchedOverride) }
        }
        return { flagsChanged: true, proxyData: null }
      }
      return null
    },
  }
}
