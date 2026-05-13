import { describe, it, expect, beforeAll } from 'vitest'
import { detectProvider } from './detection.js'

beforeAll(() => {
  globalThis.location = { href: 'https://example.com/' } as Location
})

describe('detectProvider', () => {
  describe('LaunchDarkly cloud', () => {
    it('detects clientstream SSE', () => {
      expect(detectProvider('https://clientstream.launchdarkly.com/eval/abcdef1234567890abcdef12/context'))
        .toEqual({ id: 'launchdarkly', transport: 'sse' })
    })
    it('detects stream SSE (older SDK)', () => {
      expect(detectProvider('https://stream.launchdarkly.com/eval/abcdef1234567890abcdef12/context'))
        .toEqual({ id: 'launchdarkly', transport: 'sse' })
    })
    it('detects app.launchdarkly.com polling', () => {
      expect(detectProvider('https://app.launchdarkly.com/sdk/evalx/abcdef1234567890abcdef12/contexts/user'))
        .toEqual({ id: 'launchdarkly', transport: 'polling' })
    })
    it('detects sdk.launchdarkly.com polling', () => {
      expect(detectProvider('https://sdk.launchdarkly.com/sdk/evalx/abcdef1234567890abcdef12/contexts/user'))
        .toEqual({ id: 'launchdarkly', transport: 'polling' })
    })
  })

  describe('LaunchDarkly relay proxy', () => {
    it('detects SSE via /eval/ path', () => {
      expect(detectProvider('https://relay.mycompany.com/eval/abcdef1234567890abcdef12/context'))
        .toEqual({ id: 'launchdarkly', transport: 'sse' })
    })
    it('detects polling via /sdk/evalx/ path', () => {
      expect(detectProvider('https://relay.mycompany.com/sdk/evalx/abcdef1234567890abcdef12/contexts/user'))
        .toEqual({ id: 'launchdarkly', transport: 'polling' })
    })
    it('detects polling via /sdk/eval/ path (older SDK)', () => {
      expect(detectProvider('https://relay.mycompany.com/sdk/eval/abcdef1234567890abcdef12/users/user'))
        .toEqual({ id: 'launchdarkly', transport: 'polling' })
    })
  })

  describe('PostHog', () => {
    it('detects app.posthog.com', () => {
      expect(detectProvider('https://app.posthog.com/decide/?v=3'))
        .toEqual({ id: 'posthog', transport: 'polling' })
    })
    it('detects eu.posthog.com', () => {
      expect(detectProvider('https://eu.posthog.com/decide/?v=3'))
        .toEqual({ id: 'posthog', transport: 'polling' })
    })
    it('detects i.posthog.com', () => {
      expect(detectProvider('https://i.posthog.com/decide/?v=3'))
        .toEqual({ id: 'posthog', transport: 'polling' })
    })
    it('does not match /decide/ on non-PostHog host', () => {
      expect(detectProvider('https://myapp.com/decide/?v=3')).toBeNull()
    })
  })

  describe('OFREP', () => {
    it('detects OFREP SSE', () => {
      expect(detectProvider('https://flags.mycompany.com/ofrep/v1/sse'))
        .toEqual({ id: 'openfeature', transport: 'sse' })
    })
    it('detects OFREP polling', () => {
      expect(detectProvider('https://flags.mycompany.com/ofrep/v1/evaluate/flags'))
        .toEqual({ id: 'openfeature', transport: 'polling' })
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
