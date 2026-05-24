import { describe, it, expect, beforeAll } from 'vitest'
import { detectProvider } from './detection.js'

beforeAll(() => {
  globalThis.location = { href: 'https://example.com/' } as Location
})

describe('detectProvider', () => {
  describe('LaunchDarkly cloud', () => {
    it('detects clientstream SSE', () => {
      expect(detectProvider('https://clientstream.launchdarkly.com/eval/abcdef1234567890abcdef12/context')).toEqual({ id: 'launchdarkly', transport: 'sse' })
    })
    it('detects stream SSE (older SDK)', () => {
      expect(detectProvider('https://stream.launchdarkly.com/eval/abcdef1234567890abcdef12/context')).toEqual({ id: 'launchdarkly', transport: 'sse' })
    })
    it('detects app.launchdarkly.com polling', () => {
      expect(detectProvider('https://app.launchdarkly.com/sdk/evalx/abcdef1234567890abcdef12/contexts/user')).toEqual({ id: 'launchdarkly', transport: 'polling' })
    })
    it('detects sdk.launchdarkly.com polling', () => {
      expect(detectProvider('https://sdk.launchdarkly.com/sdk/evalx/abcdef1234567890abcdef12/contexts/user')).toEqual({ id: 'launchdarkly', transport: 'polling' })
    })
  })

  describe('LaunchDarkly relay proxy', () => {
    it('detects SSE via /eval/ path', () => {
      expect(detectProvider('https://relay.mycompany.com/eval/abcdef1234567890abcdef12/context')).toEqual({ id: 'launchdarkly', transport: 'sse' })
    })
    it('detects polling via /sdk/evalx/ path', () => {
      expect(detectProvider('https://relay.mycompany.com/sdk/evalx/abcdef1234567890abcdef12/contexts/user')).toEqual({ id: 'launchdarkly', transport: 'polling' })
    })
    it('detects polling via /sdk/eval/ path (older SDK)', () => {
      expect(detectProvider('https://relay.mycompany.com/sdk/eval/abcdef1234567890abcdef12/users/user')).toEqual({ id: 'launchdarkly', transport: 'polling' })
    })
  })

  describe('PostHog', () => {
    it('detects app.posthog.com /decide/ (v1 SDK)', () => {
      expect(detectProvider('https://app.posthog.com/decide/?v=3')).toEqual({ id: 'posthog', transport: 'polling' })
    })
    it('detects eu.posthog.com /decide/', () => {
      expect(detectProvider('https://eu.posthog.com/decide/?v=3')).toEqual({ id: 'posthog', transport: 'polling' })
    })
    it('detects i.posthog.com /decide/', () => {
      expect(detectProvider('https://i.posthog.com/decide/?v=3')).toEqual({ id: 'posthog', transport: 'polling' })
    })
    it('detects app.posthog.com /flags/ (v2 SDK)', () => {
      expect(detectProvider('https://app.posthog.com/flags/?v=2')).toEqual({ id: 'posthog', transport: 'polling' })
    })
    it('detects i.posthog.com /flags/ (v2 SDK)', () => {
      expect(detectProvider('https://i.posthog.com/flags/?v=2')).toEqual({ id: 'posthog', transport: 'polling' })
    })
    it('does not match /decide/ on non-PostHog host', () => {
      expect(detectProvider('https://myapp.com/decide/?v=3')).toBeNull()
    })
    it('does not match /flags/ on non-PostHog host', () => {
      expect(detectProvider('https://myapp.com/flags/?v=2')).toBeNull()
    })
  })

  describe('OFREP', () => {
    it('detects OFREP SSE', () => {
      expect(detectProvider('https://flags.mycompany.com/ofrep/v1/sse')).toEqual({ id: 'openfeature', transport: 'sse' })
    })
    it('detects OFREP polling', () => {
      expect(detectProvider('https://flags.mycompany.com/ofrep/v1/evaluate/flags')).toEqual({ id: 'openfeature', transport: 'polling' })
    })
  })

  describe('Optimizely', () => {
    it('detects datafile fetch as polling', () => {
      expect(detectProvider('https://cdn.optimizely.com/datafiles/WqsX4Mr47732CC9UiTP8s.json')).toEqual({ id: 'optimizely', transport: 'polling' })
    })
    it('does not match logx event endpoint', () => {
      expect(detectProvider('https://logx.optimizely.com/v1/events')).toBeNull()
    })
    it('does not match api admin endpoint', () => {
      expect(detectProvider('https://api.optimizely.com/v2/projects')).toBeNull()
    })
    it('does not match cdn.optimizely.com non-datafile path', () => {
      expect(detectProvider('https://cdn.optimizely.com/some/other/path.json')).toBeNull()
    })
  })

  describe('non-matching', () => {
    it('returns null for unrelated URLs', () => {
      expect(detectProvider('https://example.com/api/data')).toBeNull()
    })
    it('returns null for invalid URL', () => {
      expect(detectProvider('not a url')).toBeNull()
    })
  })
})
