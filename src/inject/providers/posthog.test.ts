import { describe, it, expect, beforeEach } from 'vitest'
import { create } from './posthog.js'

const PH_PAYLOAD = {
  featureFlags: {
    'bool-flag':   true,
    'string-flag': 'variant-a',
    'number-flag': 42,
  },
  featureFlagPayloads: {
    'string-flag': '{"detail":"extra"}',
  },
}

const PH_V2_PAYLOAD = {
  flags: {
    'bool-flag':   { key: 'bool-flag',   enabled: true,  variant: null },
    'string-flag': { key: 'string-flag', enabled: true,  variant: 'variant-a' },
    'off-flag':    { key: 'off-flag',    enabled: false, variant: null },
  },
}

describe('PostHog provider', () => {
  let provider: ReturnType<typeof create>
  beforeEach(() => { provider = create() })

  describe('isPayload', () => {
    it('returns true for valid PostHog v1 decide response', () => {
      expect(provider.isPayload(PH_PAYLOAD)).toBe(true)
    })
    it('returns true when featureFlags is empty (v1)', () => {
      expect(provider.isPayload({ featureFlags: {} })).toBe(true)
    })
    it('returns true for valid PostHog v2 flags response', () => {
      expect(provider.isPayload(PH_V2_PAYLOAD)).toBe(true)
    })
    it('returns true when v2 flags object is empty', () => {
      expect(provider.isPayload({ flags: {} })).toBe(true)
    })
    it('returns false for OFREP shape (flags is array, not object)', () => {
      expect(provider.isPayload({ flags: [{ key: 'x', value: true }] })).toBe(false)
    })
    it('returns false for LD shape', () => {
      expect(provider.isPayload({ 'my-flag': { value: true, version: 1 } })).toBe(false)
    })
    it('returns false for null', () => {
      expect(provider.isPayload(null)).toBe(false)
    })
  })

  describe('applyPollingOverrides', () => {
    it('returns null for non-PostHog payload', () => {
      expect(provider.applyPollingOverrides({ flags: [] }, {})).toBeNull()
    })
    it('applies boolean override', () => {
      const result = provider.applyPollingOverrides(PH_PAYLOAD, { 'bool-flag': false }) as typeof PH_PAYLOAD
      expect(result.featureFlags['bool-flag']).toBe(false)
    })
    it('applies string override', () => {
      const result = provider.applyPollingOverrides(PH_PAYLOAD, { 'string-flag': 'variant-b' }) as typeof PH_PAYLOAD
      expect(result.featureFlags['string-flag']).toBe('variant-b')
    })
    it('applies number override', () => {
      const result = provider.applyPollingOverrides(PH_PAYLOAD, { 'number-flag': 99 }) as typeof PH_PAYLOAD
      expect(result.featureFlags['number-flag']).toBe(99)
    })
    it('leaves non-overridden flags unchanged', () => {
      const result = provider.applyPollingOverrides(PH_PAYLOAD, { 'bool-flag': false }) as typeof PH_PAYLOAD
      expect(result.featureFlags['string-flag']).toBe('variant-a')
      expect(result.featureFlags['number-flag']).toBe(42)
    })
    it('ignores override for key not present in featureFlags', () => {
      const result = provider.applyPollingOverrides(PH_PAYLOAD, { 'nonexistent': true }) as typeof PH_PAYLOAD
      expect(result.featureFlags).not.toHaveProperty('nonexistent')
    })
    it('skips override when original value is non-scalar (object)', () => {
      const payload = { featureFlags: { 'obj-flag': { nested: true } } }
      const result = provider.applyPollingOverrides(payload, { 'obj-flag': 'override' }) as typeof payload
      expect(result.featureFlags['obj-flag']).toEqual({ nested: true })
    })
    it('passes featureFlagPayloads through unmodified', () => {
      const result = provider.applyPollingOverrides(PH_PAYLOAD, { 'string-flag': 'variant-b' }) as typeof PH_PAYLOAD
      expect(result.featureFlagPayloads).toEqual(PH_PAYLOAD.featureFlagPayloads)
    })
    it('does not mutate the original payload', () => {
      provider.applyPollingOverrides(PH_PAYLOAD, { 'bool-flag': false })
      expect(PH_PAYLOAD.featureFlags['bool-flag']).toBe(true)
    })
  })

  // ── v2 (/flags/?v=2) ────────────────────────────────────────────────────

  describe('applyPollingOverrides (v2)', () => {
    it('returns null for non-PostHog payload', () => {
      expect(provider.applyPollingOverrides({ other: true }, {})).toBeNull()
    })
    it('overrides a boolean flag via enabled field', () => {
      const result = provider.applyPollingOverrides(PH_V2_PAYLOAD, { 'bool-flag': false }) as typeof PH_V2_PAYLOAD
      expect(result.flags['bool-flag'].enabled).toBe(false)
      expect(result.flags['bool-flag'].variant).toBeUndefined()
    })
    it('overrides a string flag via variant field', () => {
      const result = provider.applyPollingOverrides(PH_V2_PAYLOAD, { 'string-flag': 'variant-b' }) as typeof PH_V2_PAYLOAD
      expect(result.flags['string-flag'].variant).toBe('variant-b')
      expect(result.flags['string-flag'].enabled).toBe(true)
    })
    it('turns an off flag on via boolean override', () => {
      const result = provider.applyPollingOverrides(PH_V2_PAYLOAD, { 'off-flag': true }) as typeof PH_V2_PAYLOAD
      expect(result.flags['off-flag'].enabled).toBe(true)
    })
    it('ignores override for key not in flags', () => {
      const result = provider.applyPollingOverrides(PH_V2_PAYLOAD, { 'nonexistent': true }) as typeof PH_V2_PAYLOAD
      expect(result.flags).not.toHaveProperty('nonexistent')
    })
    it('does not mutate the original payload', () => {
      provider.applyPollingOverrides(PH_V2_PAYLOAD, { 'bool-flag': false })
      expect(PH_V2_PAYLOAD.flags['bool-flag'].enabled).toBe(true)
    })
  })

  describe('normalizeFlags (v2)', () => {
    it('uses variant as value when present', () => {
      expect(provider.normalizeFlags(PH_V2_PAYLOAD)).toMatchObject({
        'string-flag': { value: 'variant-a' },
      })
    })
    it('uses enabled as value when variant is absent', () => {
      expect(provider.normalizeFlags(PH_V2_PAYLOAD)).toMatchObject({
        'bool-flag': { value: true },
        'off-flag':  { value: false },
      })
    })
    it('returns empty object when flags is empty', () => {
      expect(provider.normalizeFlags({ flags: {} })).toEqual({})
    })
  })

  // ── normalizeFlags v1 ────────────────────────────────────────────────────

  describe('normalizeFlags', () => {
    it('maps featureFlags to { key: { value } } shape', () => {
      expect(provider.normalizeFlags(PH_PAYLOAD)).toEqual({
        'bool-flag':   { value: true },
        'string-flag': { value: 'variant-a' },
        'number-flag': { value: 42 },
      })
    })
    it('excludes non-scalar flag values', () => {
      const payload = { featureFlags: { 'obj-flag': { nested: true }, 'bool-flag': true } }
      const result = provider.normalizeFlags(payload)
      expect(result).not.toHaveProperty('obj-flag')
      expect(result).toHaveProperty('bool-flag')
    })
    it('returns empty object when featureFlags is empty', () => {
      expect(provider.normalizeFlags({ featureFlags: {} })).toEqual({})
    })
  })
})
