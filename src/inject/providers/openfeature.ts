import { log } from '../log.js'
import type { FlagsMap, Overrides, SSEEventResult } from '../../types.js'

export function create() {
  let hooked = false
  const snapshotListeners: Array<(e: MessageEvent) => void> = []

  return {
    id: 'openfeature' as const,

    isPayload(data: unknown): boolean {
      return Array.isArray((data as Record<string, unknown>)?.['flags']) &&
        ((data as Record<string, unknown[]>)['flags'].length === 0 ||
          (data as Record<string, Array<Record<string, unknown>>>)['flags'][0]?.['key'] !== undefined)
    },

    applyPollingOverrides(data: unknown, overrides: Overrides): Record<string, unknown> | null {
      if (!this.isPayload(data)) return null
      const d = data as { flags: Array<Record<string, unknown>> }
      const flags = d.flags.map(flag =>
        flag['key'] != null && String(flag['key']) in overrides
          ? { ...flag, value: overrides[String(flag['key'])], variant: String(overrides[String(flag['key'])]) }
          : flag
      )
      return { ...d, flags }
    },

    normalizeFlags(data: unknown): FlagsMap {
      const flags = (data as { flags: Array<Record<string, unknown>> }).flags
      const normalized: FlagsMap = {}
      for (const flag of flags) {
        if (flag['key'] != null && flag['value'] !== undefined) {
          normalized[String(flag['key'])] = { value: flag['value'] }
        }
      }
      return normalized
    },

    hookSDK(openFeature: unknown, getOverrides: () => Overrides, onFlagsUpdate: (flags: FlagsMap) => void): boolean {
      if (hooked) return true
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client = (openFeature as any)?.getClient?.()
      if (!client) {
        log('OpenFeature: getClient() unavailable')
        return false
      }

      const capturedFlags: FlagsMap = {}

      const valueMethods = ['getBooleanValue', 'getStringValue', 'getNumberValue', 'getObjectValue']
      const detailsMethods = ['getBooleanDetails', 'getStringDetails', 'getNumberDetails', 'getObjectDetails']

      for (const method of valueMethods) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const original = client[method]?.bind(client) as ((...args: any[]) => unknown) | undefined
        if (!original) continue
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        client[method] = function(flagKey: string, defaultValue: unknown, ...args: any[]) {
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const original = client[method]?.bind(client) as ((...args: any[]) => { value: unknown; flagKey: string }) | undefined
        if (!original) continue
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        client[method] = function(flagKey: string, defaultValue: unknown, ...args: any[]) {
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

    registerListener(type: string, listener: (e: MessageEvent) => void): void {
      if (type === 'flags-snapshot') {
        snapshotListeners.push(listener)
        log('OpenFeature: flags-snapshot listener registered, total=%d', snapshotListeners.length)
      }
    },

    fireFakePut(currentFlags: FlagsMap, overrides: Overrides, notifyFn: () => void): void {
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

    sseEventTypes: new Set([
      'flags-snapshot', 'flag-changed', 'flag-deleted',
      'provider_ready', 'configuration_change',
      'put', 'patch', 'message',
    ]),

    processSSEEvent(type: string, raw: unknown, currentFlags: FlagsMap, overrides: Overrides): SSEEventResult | null {
      if (type === 'flags-snapshot' || type === 'provider_ready' || type === 'put' || type === 'message') {
        if (Array.isArray(raw)) {
          const normalized: FlagsMap = {}
          for (const flag of raw as Array<Record<string, unknown>>) {
            if (flag['key'] != null && flag['value'] !== undefined) {
              normalized[String(flag['key'])] = { value: flag['value'] }
            }
          }
          if (Object.keys(normalized).length === 0) return null
          log('OFREP %s: %d flags', type, Object.keys(normalized).length)
          return { flags: normalized, proxyData: null, flagsChanged: true }
        }
        const r = raw as Record<string, unknown>
        if (r['flags'] && typeof r['flags'] === 'object') {
          const normalized: FlagsMap = {}
          for (const [key, flag] of Object.entries(r['flags'] as Record<string, Record<string, unknown>>)) {
            normalized[key] = { value: flag['value'] }
          }
          if (Object.keys(normalized).length === 0) return null
          log('OFREP %s: %d flags', type, Object.keys(normalized).length)
          return { flags: normalized, proxyData: null, flagsChanged: true }
        }
        return null
      }

      if (type === 'flag-changed' || type === 'configuration_change' || type === 'patch') {
        const r = raw as Record<string, unknown>
        if (r['key'] != null && r['value'] !== undefined) {
          log('OFREP %s: %s', type, r['key'])
          currentFlags[String(r['key'])] = { value: r['value'] }
          return { flagsChanged: true, proxyData: null }
        }
        if (r['flags'] && typeof r['flags'] === 'object') {
          for (const [key, flag] of Object.entries(r['flags'] as Record<string, Record<string, unknown>>)) {
            currentFlags[key] = { value: flag['value'] }
          }
          log('OFREP %s: %d flags updated', type, Object.keys(r['flags'] as object).length)
          return { flagsChanged: true, proxyData: null }
        }
        return null
      }

      if (type === 'flag-deleted') {
        const r = raw as Record<string, unknown>
        if (r['key'] != null) {
          log('OFREP flag-deleted: %s', r['key'])
          delete currentFlags[String(r['key'])]
          return { flagsChanged: true, proxyData: null }
        }
      }

      return null
    },
  }
}
