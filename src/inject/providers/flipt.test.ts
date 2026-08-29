import { describe, it, expect, beforeEach } from 'vitest'
import { create } from './flipt.js'

const FLIPT_PAYLOAD = {
  namespace: { key: 'default' },
  flags: [
    { key: 'sale', enabled: false, type: 'BOOLEAN_FLAG_TYPE' },
    { key: 'real-time-availability', enabled: true, type: 'BOOLEAN_FLAG_TYPE' },
    {
      key: 'theme',
      enabled: true,
      type: 'VARIANT_FLAG_TYPE',
      rules: [{ id: 'r1', segments: [], rank: 1, segmentOperator: 'OR_SEGMENT_OPERATOR', distributions: [{ ruleId: 'r1', variantKey: 'snowboard', rollout: 100 }] }],
      rollouts: [],
    },
  ],
  digest: 'abc123',
}

describe('Flipt provider', () => {
  let provider: ReturnType<typeof create>
  beforeEach(() => {
    provider = create()
  })

  describe('isPayload', () => {
    it('returns true for a valid snapshot payload', () => {
      expect(provider.isPayload(FLIPT_PAYLOAD)).toBe(true)
    })
    it('returns true when flags is empty', () => {
      expect(provider.isPayload({ namespace: { key: 'default' }, flags: [] })).toBe(true)
    })
    it('returns false without a namespace object', () => {
      expect(provider.isPayload({ flags: [] })).toBe(false)
    })
    it('returns false for OFREP shape', () => {
      expect(provider.isPayload({ flags: [{ key: 'x', value: true }] })).toBe(false)
    })
    it('returns false for LD shape', () => {
      expect(provider.isPayload({ 'my-flag': { value: true, version: 1 } })).toBe(false)
    })
    it('returns false for null', () => {
      expect(provider.isPayload(null)).toBe(false)
    })
    it('returns false for array', () => {
      expect(provider.isPayload([FLIPT_PAYLOAD])).toBe(false)
    })
  })

  describe('normalizeFlags', () => {
    it('maps boolean flags to { key: { value: enabled } }', () => {
      expect(provider.normalizeFlags(FLIPT_PAYLOAD)).toEqual({
        sale: { value: false },
        'real-time-availability': { value: true },
      })
    })
    it('omits variant flags (segment evaluation not supported)', () => {
      const result = provider.normalizeFlags(FLIPT_PAYLOAD)
      expect(result).not.toHaveProperty('theme')
    })
    it('returns empty object for empty flags', () => {
      expect(provider.normalizeFlags({ namespace: { key: 'default' }, flags: [] })).toEqual({})
    })
  })

  describe('applyPollingOverrides', () => {
    it('returns null for non-Flipt payload', () => {
      expect(provider.applyPollingOverrides({ flags: [] }, {})).toBeNull()
    })
    it('applies a boolean override via the enabled field', () => {
      const result = provider.applyPollingOverrides(FLIPT_PAYLOAD, { sale: true }) as typeof FLIPT_PAYLOAD
      expect(result.flags.find(f => f.key === 'sale')?.enabled).toBe(true)
    })
    it('leaves non-overridden flags unchanged', () => {
      const result = provider.applyPollingOverrides(FLIPT_PAYLOAD, { sale: true }) as typeof FLIPT_PAYLOAD
      expect(result.flags.find(f => f.key === 'real-time-availability')?.enabled).toBe(true)
    })
    it('ignores an override targeting a variant flag', () => {
      const result = provider.applyPollingOverrides(FLIPT_PAYLOAD, { theme: 'city' }) as typeof FLIPT_PAYLOAD
      expect(result.flags.find(f => f.key === 'theme')?.enabled).toBe(true)
    })
    it('ignores a non-boolean override on a boolean flag', () => {
      const result = provider.applyPollingOverrides(FLIPT_PAYLOAD, { sale: 'on' }) as typeof FLIPT_PAYLOAD
      expect(result.flags.find(f => f.key === 'sale')?.enabled).toBe(false)
    })
    it('does not mutate the original payload', () => {
      provider.applyPollingOverrides(FLIPT_PAYLOAD, { sale: true })
      expect(FLIPT_PAYLOAD.flags.find(f => f.key === 'sale')?.enabled).toBe(false)
    })
  })
})
