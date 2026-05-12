import { describe, it, expect, vi, beforeEach } from 'vitest'
import { create } from './openfeature.js'

const OFREP_PAYLOAD = {
  flags: [
    { key: 'bool-flag',   value: true,      reason: 'STATIC', variant: 'true' },
    { key: 'string-flag', value: 'control',  reason: 'STATIC', variant: 'control' },
  ],
}

describe('OpenFeature provider', () => {
  let provider
  beforeEach(() => { provider = create() })

  // ── isPayload ────────────────────────────────────────────────────────────

  describe('isPayload', () => {
    it('returns true for valid OFREP payload', () => {
      expect(provider.isPayload(OFREP_PAYLOAD)).toBe(true)
    })
    it('returns true for empty flags array (no flags configured for this user)', () => {
      expect(provider.isPayload({ flags: [] })).toBe(true)
    })
    it('returns false when flags is not an array', () => {
      expect(provider.isPayload({ flags: {} })).toBe(false)
    })
    it('returns false when flags key is absent', () => {
      expect(provider.isPayload({ featureFlags: {} })).toBe(false)
    })
    it('returns false when first element has no key property', () => {
      expect(provider.isPayload({ flags: [{ value: true }] })).toBe(false)
    })
    it('returns false for null', () => {
      expect(provider.isPayload(null)).toBe(false)
    })
  })

  // ── applyPollingOverrides ────────────────────────────────────────────────

  describe('applyPollingOverrides', () => {
    it('returns null for non-OFREP payload', () => {
      expect(provider.applyPollingOverrides({ featureFlags: {} }, {})).toBeNull()
    })
    it('substitutes overridden flag value', () => {
      const result = provider.applyPollingOverrides(OFREP_PAYLOAD, { 'bool-flag': false })
      expect(result.flags.find(f => f.key === 'bool-flag').value).toBe(false)
    })
    it('preserves non-overridden flags', () => {
      const result = provider.applyPollingOverrides(OFREP_PAYLOAD, { 'bool-flag': false })
      expect(result.flags.find(f => f.key === 'string-flag').value).toBe('control')
    })
    it('preserves other fields on overridden flag', () => {
      const result = provider.applyPollingOverrides(OFREP_PAYLOAD, { 'bool-flag': false })
      expect(result.flags.find(f => f.key === 'bool-flag').reason).toBe('STATIC')
    })
    it('updates variant alongside value so string flags resolve correctly', () => {
      const result = provider.applyPollingOverrides(OFREP_PAYLOAD, { 'string-flag': 'treatment' })
      const flag = result.flags.find(f => f.key === 'string-flag')
      expect(flag.value).toBe('treatment')
      expect(flag.variant).toBe('treatment')
    })
    it('sets variant as string representation for non-string overrides', () => {
      const result = provider.applyPollingOverrides(OFREP_PAYLOAD, { 'bool-flag': false })
      expect(result.flags.find(f => f.key === 'bool-flag').variant).toBe('false')
    })
    it('returns same outer shape ({ flags: [...] })', () => {
      const result = provider.applyPollingOverrides(OFREP_PAYLOAD, {})
      expect(Array.isArray(result.flags)).toBe(true)
    })
    it('handles empty flags array without throwing', () => {
      const result = provider.applyPollingOverrides({ flags: [] }, { 'x': true })
      expect(result.flags).toEqual([])
    })
  })

  // ── normalizeFlags ───────────────────────────────────────────────────────

  describe('normalizeFlags', () => {
    it('maps array to { key: { value } } object', () => {
      expect(provider.normalizeFlags(OFREP_PAYLOAD)).toEqual({
        'bool-flag':   { value: true },
        'string-flag': { value: 'control' },
      })
    })
    it('returns empty object for empty flags array', () => {
      expect(provider.normalizeFlags({ flags: [] })).toEqual({})
    })
  })

  // ── processSSEEvent — flags-snapshot ────────────────────────────────────

  describe('processSSEEvent — flags-snapshot (Matnaw array format)', () => {
    const raw = [{ key: 'bool-flag', value: true, reason: 'STATIC', variant: 'true' }]

    it('normalizes flags and sets flagsChanged', () => {
      const result = provider.processSSEEvent('flags-snapshot', raw, {}, {})
      expect(result.flagsChanged).toBe(true)
      expect(result.flags['bool-flag'].value).toBe(true)
    })
    it('returns null for empty array (no flags yet)', () => {
      expect(provider.processSSEEvent('flags-snapshot', [], {}, {})).toBeNull()
    })
  })

  describe('processSSEEvent — flags-snapshot (object format)', () => {
    const raw = { flags: { 'bool-flag': { value: true, flagVersion: 1 } } }

    it('normalizes flags and sets flagsChanged', () => {
      const result = provider.processSSEEvent('flags-snapshot', raw, {}, {})
      expect(result.flagsChanged).toBe(true)
      expect(result.flags['bool-flag'].value).toBe(true)
    })
    it('returns null for empty flags object', () => {
      expect(provider.processSSEEvent('flags-snapshot', { flags: {} }, {}, {})).toBeNull()
    })
  })

  // ── processSSEEvent — flag-changed ───────────────────────────────────────

  describe('processSSEEvent — flag-changed', () => {
    it('updates the flag in currentFlags', () => {
      const current = { 'bool-flag': { value: true } }
      provider.processSSEEvent('flag-changed', { key: 'bool-flag', value: false }, current, {})
      expect(current['bool-flag'].value).toBe(false)
    })
    it('sets flagsChanged', () => {
      const result = provider.processSSEEvent('flag-changed', { key: 'bool-flag', value: false }, {}, {})
      expect(result.flagsChanged).toBe(true)
    })
    it('handles bulk update format ({ flags: {...} })', () => {
      const current = {}
      const result = provider.processSSEEvent('flag-changed', { flags: { 'x': { value: 1, flagVersion: 1 } } }, current, {})
      expect(result.flagsChanged).toBe(true)
      expect(current['x'].value).toBe(1)
    })
  })

  // ── processSSEEvent — flag-deleted ───────────────────────────────────────

  describe('processSSEEvent — flag-deleted', () => {
    it('removes the flag from currentFlags', () => {
      const current = { 'bool-flag': { value: true } }
      provider.processSSEEvent('flag-deleted', { key: 'bool-flag' }, current, {})
      expect('bool-flag' in current).toBe(false)
    })
    it('sets flagsChanged', () => {
      const result = provider.processSSEEvent('flag-deleted', { key: 'bool-flag' }, { 'bool-flag': {} }, {})
      expect(result.flagsChanged).toBe(true)
    })
  })

  // ── fireFakePut ──────────────────────────────────────────────────────────

  describe('fireFakePut', () => {
    const currentFlags = {
      'bool-flag':   { value: true },
      'string-flag': { value: 'control' },
    }

    it('calls notifyFn even when no listeners are registered', () => {
      const notify = vi.fn()
      provider.fireFakePut(currentFlags, {}, notify)
      expect(notify).toHaveBeenCalledOnce()
    })
    it('fires a flags-snapshot event to each registered listener', () => {
      const received = []
      provider.registerListener('flags-snapshot', (e) => received.push(JSON.parse(e.data)))
      provider.fireFakePut(currentFlags, {}, vi.fn())
      expect(received).toHaveLength(1)
    })
    it('applies overrides in the synthetic event', () => {
      const received = []
      provider.registerListener('flags-snapshot', (e) => received.push(JSON.parse(e.data)))
      provider.fireFakePut(currentFlags, { 'bool-flag': false }, vi.fn())
      expect(received[0].find(f => f.key === 'bool-flag').value).toBe(false)
      expect(received[0].find(f => f.key === 'string-flag').value).toBe('control')
    })
    it('calls notifyFn after firing', () => {
      const notify = vi.fn()
      provider.registerListener('flags-snapshot', () => {})
      provider.fireFakePut(currentFlags, {}, notify)
      expect(notify).toHaveBeenCalledOnce()
    })
  })

  // ── hookSDK ──────────────────────────────────────────────────────────────

  describe('hookSDK', () => {
    function makeClient(flags) {
      return {
        getBooleanValue:  (key, def) => flags[key] ?? def,
        getStringValue:   (key, def) => flags[key] ?? def,
        getNumberValue:   (key, def) => flags[key] ?? def,
        getObjectValue:   (key, def) => flags[key] ?? def,
        getBooleanDetails: (key, def) => ({ value: flags[key] ?? def, flagKey: key }),
        getStringDetails:  (key, def) => ({ value: flags[key] ?? def, flagKey: key }),
        getNumberDetails:  (key, def) => ({ value: flags[key] ?? def, flagKey: key }),
        getObjectDetails:  (key, def) => ({ value: flags[key] ?? def, flagKey: key }),
      }
    }

    it('returns false when getClient is unavailable', () => {
      expect(provider.hookSDK({ getClient: () => null }, () => ({}), vi.fn())).toBe(false)
    })
    it('returns true on successful hook', () => {
      const sdk = { getClient: () => makeClient({}) }
      expect(provider.hookSDK(sdk, () => ({}), vi.fn())).toBe(true)
    })
    it('returns override value for overridden key', () => {
      const client = makeClient({ 'my-flag': true })
      const sdk = { getClient: () => client }
      provider.hookSDK(sdk, () => ({ 'my-flag': false }), vi.fn())
      expect(client.getBooleanValue('my-flag', true)).toBe(false)
    })
    it('returns real value for non-overridden key', () => {
      const client = makeClient({ 'my-flag': true })
      const sdk = { getClient: () => client }
      provider.hookSDK(sdk, () => ({}), vi.fn())
      expect(client.getBooleanValue('my-flag', false)).toBe(true)
    })
    it('fires onFlagsUpdate when a flag is evaluated', () => {
      const client = makeClient({ 'my-flag': true })
      const sdk = { getClient: () => client }
      const onUpdate = vi.fn()
      provider.hookSDK(sdk, () => ({}), onUpdate)
      client.getBooleanValue('my-flag', false)
      expect(onUpdate).toHaveBeenCalled()
    })
  })
})
