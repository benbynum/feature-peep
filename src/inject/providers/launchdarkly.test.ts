import { describe, it, expect, vi, beforeEach } from 'vitest'
import { create } from './launchdarkly.js'

const LD_PAYLOAD = {
  'bool-flag':   { value: true,      version: 1, flagVersion: 1 },
  'string-flag': { value: 'control', version: 2 },
  'number-flag': { value: 42,        version: 3 },
}

describe('LaunchDarkly provider', () => {
  let provider: ReturnType<typeof create>
  beforeEach(() => { provider = create() })

  describe('isPayload', () => {
    it('returns true for valid LD flag payload', () => {
      expect(provider.isPayload(LD_PAYLOAD)).toBe(true)
    })
    it('returns false for empty object (no flags to inspect)', () => {
      expect(provider.isPayload({})).toBe(false)
    })
    it('returns false for OFREP shape', () => {
      expect(provider.isPayload({ flags: [{ key: 'x', value: true }] })).toBe(false)
    })
    it('returns false for PostHog shape', () => {
      expect(provider.isPayload({ featureFlags: { 'x': true } })).toBe(false)
    })
    it('returns false for null', () => {
      expect(provider.isPayload(null)).toBe(false)
    })
    it('returns false for array', () => {
      expect(provider.isPayload([{ key: 'x', value: true }])).toBe(false)
    })
  })

  describe('applyPollingOverrides', () => {
    it('returns null for non-LD payload', () => {
      expect(provider.applyPollingOverrides({ featureFlags: {} }, {})).toBeNull()
    })
    it('returns a copy of the payload when no overrides', () => {
      const result = provider.applyPollingOverrides(LD_PAYLOAD, {}) as typeof LD_PAYLOAD
      expect(result['bool-flag'].value).toBe(true)
      expect(result['string-flag'].value).toBe('control')
    })
    it('substitutes the overridden value', () => {
      const result = provider.applyPollingOverrides(LD_PAYLOAD, { 'bool-flag': false }) as typeof LD_PAYLOAD
      expect(result['bool-flag'].value).toBe(false)
    })
    it('bumps version on overridden flag so the SDK detects the change', () => {
      const result = provider.applyPollingOverrides(LD_PAYLOAD, { 'bool-flag': false }) as typeof LD_PAYLOAD
      expect(result['bool-flag'].version).toBeGreaterThan(LD_PAYLOAD['bool-flag'].version)
    })
    it('bumps flagVersion when present', () => {
      const result = provider.applyPollingOverrides(LD_PAYLOAD, { 'bool-flag': false }) as typeof LD_PAYLOAD
      expect(result['bool-flag'].flagVersion).toBeGreaterThan(LD_PAYLOAD['bool-flag'].flagVersion!)
    })
    it('does not bump version on non-overridden flags', () => {
      const result = provider.applyPollingOverrides(LD_PAYLOAD, { 'bool-flag': false }) as typeof LD_PAYLOAD
      expect(result['string-flag'].version).toBe(LD_PAYLOAD['string-flag'].version)
    })
    it('version bumps increment across successive calls', () => {
      const first  = provider.applyPollingOverrides(LD_PAYLOAD, { 'bool-flag': false }) as typeof LD_PAYLOAD
      const second = provider.applyPollingOverrides(LD_PAYLOAD, { 'bool-flag': false }) as typeof LD_PAYLOAD
      expect(second['bool-flag'].version).toBeGreaterThan(first['bool-flag'].version)
    })
  })

  describe('processSSEEvent — put', () => {
    it('returns null for non-LD payload shape', () => {
      expect(provider.processSSEEvent('put', { flags: [] }, {}, {})).toBeNull()
    })
    it('stores raw flags and returns flagsChanged', () => {
      const result = provider.processSSEEvent('put', LD_PAYLOAD, {}, {})!
      expect(result.flags).toBe(LD_PAYLOAD)
      expect(result.flagsChanged).toBe(true)
    })
    it('proxies overridden values to the SDK', () => {
      const result = provider.processSSEEvent('put', LD_PAYLOAD, {}, { 'bool-flag': false })!
      const proxied = JSON.parse(result.proxyData!)
      expect(proxied['bool-flag'].value).toBe(false)
      expect(proxied['string-flag'].value).toBe('control')
    })
    it('proxies unmodified data when no overrides', () => {
      const result = provider.processSSEEvent('put', LD_PAYLOAD, {}, {})!
      const proxied = JSON.parse(result.proxyData!)
      expect(proxied['bool-flag'].value).toBe(true)
    })
  })

  describe('processSSEEvent — patch', () => {
    it('handles key/value format and updates currentFlags', () => {
      const current = { ...LD_PAYLOAD }
      const patch = { key: 'bool-flag', value: false, version: 10 }
      const result = provider.processSSEEvent('patch', patch, current, {})!
      expect(result.flagsChanged).toBe(true)
      expect(current['bool-flag'].value).toBe(false)
    })
    it('handles path/data format (older SDK)', () => {
      const current = { ...LD_PAYLOAD }
      const data = { key: 'bool-flag', value: false, version: 10 }
      const result = provider.processSSEEvent('patch', { path: '/flags/bool-flag', data }, current, {})!
      expect(result.flagsChanged).toBe(true)
      expect(current['bool-flag'].value).toBe(false)
    })
    it('injects override into proxy data for key/value format', () => {
      const current = { ...LD_PAYLOAD }
      const result = provider.processSSEEvent('patch', { key: 'bool-flag', value: false, version: 10 }, current, { 'bool-flag': true })!
      expect(JSON.parse(result.proxyData!)['value']).toBe(true)
    })
    it('injects override into proxy data for path/data format', () => {
      const current = { ...LD_PAYLOAD }
      const data = { key: 'bool-flag', value: false, version: 10 }
      const result = provider.processSSEEvent('patch', { path: '/flags/bool-flag', data }, current, { 'bool-flag': true })!
      expect(JSON.parse(result.proxyData!).data.value).toBe(true)
    })
    it('returns null proxyData when flag has no active override', () => {
      const current = { ...LD_PAYLOAD }
      const result = provider.processSSEEvent('patch', { key: 'string-flag', value: 'new', version: 5 }, current, {})!
      expect(result.proxyData).toBeNull()
    })
    it('returns null for unrecognized patch shape', () => {
      expect(provider.processSSEEvent('patch', { unrecognized: true }, {}, {})).toBeNull()
    })
  })

  describe('fireFakePut', () => {
    it('does not call notifyFn when there are no listeners', () => {
      const notify = vi.fn()
      provider.fireFakePut(LD_PAYLOAD, {}, notify)
      expect(notify).not.toHaveBeenCalled()
    })
    it('fires a synthetic put event to each registered listener', () => {
      const received: unknown[] = []
      provider.registerListener('put', (e) => received.push(JSON.parse(e.data)))
      provider.fireFakePut(LD_PAYLOAD, {}, vi.fn())
      expect(received).toHaveLength(1)
    })
    it('applies overrides in the synthetic event', () => {
      const received: Array<Record<string, { value: unknown }>> = []
      provider.registerListener('put', (e) => received.push(JSON.parse(e.data)))
      provider.fireFakePut(LD_PAYLOAD, { 'bool-flag': false }, vi.fn())
      expect(received[0]['bool-flag'].value).toBe(false)
      expect(received[0]['string-flag'].value).toBe('control')
    })
    it('calls notifyFn after firing', () => {
      const notify = vi.fn()
      provider.registerListener('put', () => {})
      provider.fireFakePut(LD_PAYLOAD, {}, notify)
      expect(notify).toHaveBeenCalledOnce()
    })
  })
})
