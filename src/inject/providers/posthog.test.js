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

describe('PostHog provider', () => {
  let provider
  beforeEach(() => { provider = create() })

  // ── isPayload ────────────────────────────────────────────────────────────

  describe('isPayload', () => {
    it('returns true for valid PostHog decide response', () => {
      expect(provider.isPayload(PH_PAYLOAD)).toBe(true)
    })
    it('returns true when featureFlags is empty', () => {
      expect(provider.isPayload({ featureFlags: {} })).toBe(true)
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
  })

  // ── applyPollingOverrides ────────────────────────────────────────────────

  describe('applyPollingOverrides', () => {
    it('returns null for non-PostHog payload', () => {
      expect(provider.applyPollingOverrides({ flags: [] }, {})).toBeNull()
    })
    it('applies boolean override', () => {
      const result = provider.applyPollingOverrides(PH_PAYLOAD, { 'bool-flag': false })
      expect(result.featureFlags['bool-flag']).toBe(false)
    })
    it('applies string override', () => {
      const result = provider.applyPollingOverrides(PH_PAYLOAD, { 'string-flag': 'variant-b' })
      expect(result.featureFlags['string-flag']).toBe('variant-b')
    })
    it('applies number override', () => {
      const result = provider.applyPollingOverrides(PH_PAYLOAD, { 'number-flag': 99 })
      expect(result.featureFlags['number-flag']).toBe(99)
    })
    it('leaves non-overridden flags unchanged', () => {
      const result = provider.applyPollingOverrides(PH_PAYLOAD, { 'bool-flag': false })
      expect(result.featureFlags['string-flag']).toBe('variant-a')
      expect(result.featureFlags['number-flag']).toBe(42)
    })
    it('ignores override for key not present in featureFlags', () => {
      const result = provider.applyPollingOverrides(PH_PAYLOAD, { 'nonexistent': true })
      expect(result.featureFlags).not.toHaveProperty('nonexistent')
    })
    it('skips override when original value is non-scalar (object)', () => {
      const payload = { featureFlags: { 'obj-flag': { nested: true } } }
      const result = provider.applyPollingOverrides(payload, { 'obj-flag': 'override' })
      expect(result.featureFlags['obj-flag']).toEqual({ nested: true })
    })
    it('passes featureFlagPayloads through unmodified', () => {
      const result = provider.applyPollingOverrides(PH_PAYLOAD, { 'string-flag': 'variant-b' })
      expect(result.featureFlagPayloads).toEqual(PH_PAYLOAD.featureFlagPayloads)
    })
    it('does not mutate the original payload', () => {
      provider.applyPollingOverrides(PH_PAYLOAD, { 'bool-flag': false })
      expect(PH_PAYLOAD.featureFlags['bool-flag']).toBe(true)
    })
  })

  // ── normalizeFlags ───────────────────────────────────────────────────────

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
