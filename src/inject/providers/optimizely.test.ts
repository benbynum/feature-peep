import { describe, it, expect, beforeEach } from 'vitest'
import { create } from './optimizely.js'

// Minimal-but-realistic fixture mirroring the real Meridian datafile at
// cdn.optimizely.com/datafiles/WqsX4Mr47732CC9UiTP8s.json: one boolean-only
// flag, one flag with a single string variable.
const DATAFILE = {
  accountId: '5490647348543488',
  projectId: '5490647348543488',
  revision: '3',
  version: '4',
  environmentKey: 'development',
  sdkKey: 'WqsX4Mr47732CC9UiTP8s',
  attributes: [],
  audiences: [],
  events: [],
  experiments: [],
  groups: [],
  typedAudiences: [],
  featureFlags: [
    {
      id: '552726',
      key: 'show-ai-insights',
      rolloutId: 'rollout-552726',
      experimentIds: [],
      variables: [],
    },
    {
      id: '600000',
      key: 'cta-text',
      rolloutId: 'rollout-600000',
      experimentIds: [],
      variables: [
        {
          id: 'var-cta-1',
          key: 'label',
          type: 'string',
          defaultValue: 'Sign up',
        },
      ],
    },
  ],
  rollouts: [
    {
      id: 'rollout-552726',
      experiments: [
        {
          id: 'default-rollout-552726',
          key: 'default-rollout-552726',
          status: 'Running',
          layerId: 'rollout-552726',
          variations: [{ id: '1747448', key: 'off', featureEnabled: false, variables: [] }],
          trafficAllocation: [{ entityId: '1747448', endOfRange: 10000 }],
          forcedVariations: {},
          audienceIds: [],
          audienceConditions: [],
          type: 'td',
        },
      ],
    },
    {
      id: 'rollout-600000',
      experiments: [
        {
          id: 'default-rollout-600000',
          key: 'default-rollout-600000',
          status: 'Running',
          layerId: 'rollout-600000',
          variations: [
            {
              id: 'var-on',
              key: 'on',
              featureEnabled: true,
              variables: [{ id: 'var-cta-1', value: 'Buy now' }],
            },
          ],
          trafficAllocation: [{ entityId: 'var-on', endOfRange: 10000 }],
          forcedVariations: {},
          audienceIds: [],
          audienceConditions: [],
          type: 'td',
        },
      ],
    },
  ],
}

describe('Optimizely provider', () => {
  let provider: ReturnType<typeof create>
  beforeEach(() => {
    provider = create()
  })

  describe('isPayload', () => {
    it('returns true for a real datafile shape', () => {
      expect(provider.isPayload(DATAFILE)).toBe(true)
    })
    it('returns false for null', () => {
      expect(provider.isPayload(null)).toBe(false)
    })
    it('returns false for arrays', () => {
      expect(provider.isPayload([{ featureFlags: [], rollouts: [], revision: '1' }])).toBe(false)
    })
    it('returns false for LD-shaped payload', () => {
      expect(provider.isPayload({ 'my-flag': { value: true, version: 1 } })).toBe(false)
    })
    it('returns false for PostHog-shaped payload', () => {
      expect(provider.isPayload({ featureFlags: { foo: true } })).toBe(false)
    })
    it('returns false when revision is missing', () => {
      expect(provider.isPayload({ featureFlags: [], rollouts: [] })).toBe(false)
    })
  })

  describe('applyPollingOverrides', () => {
    it('returns null for a non-Optimizely payload', () => {
      expect(provider.applyPollingOverrides({ flags: [] }, {})).toBeNull()
    })

    it('flips featureEnabled to true for a boolean override', () => {
      const result = provider.applyPollingOverrides(DATAFILE, {
        'show-ai-insights': true,
      }) as typeof DATAFILE
      const rollout = result.rollouts.find(r => r.id === 'rollout-552726')!
      const variation = rollout.experiments[0].variations[0]
      expect(variation.featureEnabled).toBe(true)
      expect(rollout.experiments[0].trafficAllocation).toEqual([{ entityId: variation.id, endOfRange: 10000 }])
    })

    it('updates the variable value for a string override', () => {
      const result = provider.applyPollingOverrides(DATAFILE, {
        'cta-text': 'Subscribe',
      }) as typeof DATAFILE
      const rollout = result.rollouts.find(r => r.id === 'rollout-600000')!
      const variation = rollout.experiments[0].variations[0]
      expect(variation.featureEnabled).toBe(true)
      const v = variation.variables.find(v => v.id === 'var-cta-1')
      expect(v?.value).toBe('Subscribe')
    })

    it('bumps revision after applying any override', () => {
      const result = provider.applyPollingOverrides(DATAFILE, {
        'show-ai-insights': true,
      }) as typeof DATAFILE
      expect(parseInt(result.revision, 10)).toBeGreaterThan(parseInt(DATAFILE.revision, 10))
    })

    it('returns a structurally equal copy when overrides is empty', () => {
      const result = provider.applyPollingOverrides(DATAFILE, {})
      expect(result).toEqual(DATAFILE)
    })

    it('does not mutate the original payload', () => {
      const before = JSON.stringify(DATAFILE)
      provider.applyPollingOverrides(DATAFILE, {
        'show-ai-insights': true,
        'cta-text': 'X',
      })
      expect(JSON.stringify(DATAFILE)).toBe(before)
    })
  })

  describe('normalizeFlags', () => {
    it('extracts current values for both flag shapes', () => {
      const flags = provider.normalizeFlags(DATAFILE)
      expect(flags['show-ai-insights']).toEqual({ value: false })
      expect(flags['cta-text']).toEqual({ value: 'Buy now' })
    })

    it('returns empty for a non-Optimizely payload', () => {
      expect(provider.normalizeFlags({ foo: 'bar' })).toEqual({})
    })
  })
})
