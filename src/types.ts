export type FlagValue = unknown
export type FlagsMap = Record<string, { value: FlagValue }>
export type Overrides = Record<string, FlagValue>
export type Transport = 'sse' | 'polling'
export type ProviderId = 'launchdarkly' | 'openfeature' | 'posthog'

export interface DetectedProvider {
  id: ProviderId
  transport: Transport
}

export interface SSEEventResult {
  flags?: FlagsMap
  flagsChanged?: boolean
  proxyData?: string | null
}

export interface Provider {
  id: ProviderId
  isPayload(data: unknown): boolean
  applyPollingOverrides(data: unknown, overrides: Overrides): unknown | null
  normalizeFlags(data: unknown): FlagsMap
  registerListener(type: string, listener: (e: MessageEvent) => void): void
  fireFakePut(currentFlags: FlagsMap, overrides: Overrides, notifyFn: () => void): void
  sseEventTypes: Set<string>
  processSSEEvent(type: string, raw: unknown, currentFlags: FlagsMap, overrides: Overrides): SSEEventResult | null
  hookSDK?(sdk: unknown, getOverrides: () => Overrides, onFlagsUpdate: (flags: FlagsMap) => void): boolean
}

export interface ProviderMeta {
  id: string
  name: string
  imageSrc?: string
  svgPath?: string
  svgTransform?: string
  viewBox?: string
  lightBadge: boolean
  logoOnly: boolean
}
