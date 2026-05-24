import { log } from '../log.js'
import type { FlagsMap, Overrides } from '../../types.js'

interface OptimizelyVariation {
  id: string
  key: string
  featureEnabled?: boolean
  variables?: Array<{ id: string; value: string; key?: string; type?: string }>
}

interface OptimizelyExperiment {
  id: string
  key: string
  variations: OptimizelyVariation[]
  trafficAllocation: Array<{ entityId: string; endOfRange: number }>
}

interface OptimizelyRollout {
  id: string
  experiments: OptimizelyExperiment[]
}

interface OptimizelyFlagVariable {
  id: string
  key: string
  type: string
  defaultValue?: string
}

interface OptimizelyFlag {
  id: string
  key: string
  rolloutId: string
  experimentIds: string[]
  variables: OptimizelyFlagVariable[]
}

interface OptimizelyDatafile {
  accountId?: string
  projectId?: string
  revision?: string
  version?: string
  featureFlags: OptimizelyFlag[]
  rollouts: OptimizelyRollout[]
  experiments?: unknown[]
}

export function create() {
  function isPayload(data: unknown): boolean {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return false
    const d = data as Record<string, unknown>
    return Array.isArray(d['featureFlags']) && Array.isArray(d['rollouts']) && 'revision' in d
  }

  function getDefaultExperiment(rollout: OptimizelyRollout | undefined): OptimizelyExperiment | undefined {
    if (!rollout || !Array.isArray(rollout.experiments) || rollout.experiments.length === 0) return undefined
    return rollout.experiments[rollout.experiments.length - 1]
  }

  function getRoutedVariation(experiment: OptimizelyExperiment | undefined): OptimizelyVariation | undefined {
    if (!experiment) return undefined
    const alloc = experiment.trafficAllocation?.[0]
    if (!alloc) return experiment.variations?.[0]
    return experiment.variations.find(v => v.id === alloc.entityId) ?? experiment.variations?.[0]
  }

  function parseVariableValue(type: string | undefined, raw: string | undefined): unknown {
    if (raw == null) return null
    switch (type) {
      case 'boolean':
        return raw === 'true'
      case 'integer': {
        const n = parseInt(raw, 10)
        return Number.isNaN(n) ? raw : n
      }
      case 'double': {
        const n = parseFloat(raw)
        return Number.isNaN(n) ? raw : n
      }
      case 'json':
        try {
          return JSON.parse(raw)
        } catch {
          return raw
        }
      default:
        return raw
    }
  }

  function serializeVariableValue(value: unknown): string {
    if (typeof value === 'string') return value
    if (typeof value === 'boolean') return value ? 'true' : 'false'
    if (typeof value === 'number') return String(value)
    return JSON.stringify(value)
  }

  return {
    id: 'optimizely' as const,

    isPayload,

    applyPollingOverrides(data: unknown, overrides: Overrides): Record<string, unknown> | null {
      if (!isPayload(data)) return null
      const original = data as unknown as OptimizelyDatafile
      const overrideKeys = Object.keys(overrides)

      // Deep-clone via JSON round-trip — the datafile is plain JSON so this is safe.
      const cloned = JSON.parse(JSON.stringify(original)) as OptimizelyDatafile

      const rolloutsById = new Map<string, OptimizelyRollout>()
      for (const r of cloned.rollouts) rolloutsById.set(r.id, r)

      let mutated = false

      for (const flag of cloned.featureFlags) {
        if (!(flag.key in overrides)) continue
        const overrideValue = overrides[flag.key]
        const rollout = rolloutsById.get(flag.rolloutId)
        const experiment = getDefaultExperiment(rollout)
        if (!experiment || !Array.isArray(experiment.variations) || experiment.variations.length === 0) continue

        // Pick the variation whose featureEnabled matches the override's intent. Optimizely
        // auto-creates both `on` and `off` variations, so this normally finds the matching one
        // without us having to mutate a variation's featureEnabled flag (which can produce a
        // semantically inconsistent datafile — e.g. a variation keyed `off` with
        // featureEnabled=true — that the SDK may reject on validation).
        const desiredEnabled = typeof overrideValue === 'boolean' ? overrideValue : true
        let target = experiment.variations.find(v => v.featureEnabled === desiredEnabled)
        if (!target) {
          // Fallback: mutate the currently-routed variation. Only hit when both auto-variations
          // are missing (custom datafile shape).
          target = getRoutedVariation(experiment) ?? experiment.variations[0]
          target.featureEnabled = desiredEnabled
        }
        experiment.trafficAllocation = [{ entityId: target.id, endOfRange: 10000 }]

        // Variable overrides: mutate the chosen variation's variable value.
        if (flag.variables && flag.variables.length > 0 && typeof overrideValue !== 'boolean') {
          if (!Array.isArray(target.variables)) target.variables = []
          const flagVar = flag.variables[0]
          if (flagVar) {
            const existing = target.variables.find(v => v.id === flagVar.id)
            const serialized = serializeVariableValue(overrideValue)
            if (existing) {
              existing.value = serialized
            } else {
              target.variables.push({ id: flagVar.id, value: serialized, key: flagVar.key, type: flagVar.type })
            }
          }
        }
        mutated = true
      }

      if (mutated) {
        const currentRev = parseInt(cloned.revision || '0', 10)
        cloned.revision = String((Number.isNaN(currentRev) ? 0 : currentRev) + 1)
      }

      log('Optimizely polling: %d flags, %d overrides applied', cloned.featureFlags.length, overrideKeys.length)
      return cloned as unknown as Record<string, unknown>
    },

    normalizeFlags(data: unknown): FlagsMap {
      if (!isPayload(data)) return {}
      const d = data as unknown as OptimizelyDatafile
      const rolloutsById = new Map<string, OptimizelyRollout>()
      for (const r of d.rollouts) rolloutsById.set(r.id, r)

      const normalized: FlagsMap = {}
      for (const flag of d.featureFlags) {
        const rollout = rolloutsById.get(flag.rolloutId)
        const experiment = getDefaultExperiment(rollout)
        const variation = getRoutedVariation(experiment)
        if (!variation) continue

        const enabled = variation.featureEnabled === true
        if (!flag.variables || flag.variables.length === 0) {
          normalized[flag.key] = { value: enabled }
          continue
        }

        const flagVar = flag.variables[0]
        const variationVar = (variation.variables || []).find(v => v.id === flagVar.id)
        const rawValue = variationVar?.value ?? flagVar.defaultValue
        // When the variation is disabled the SDK returns the default; mirror that here.
        normalized[flag.key] = {
          value: enabled ? parseVariableValue(flagVar.type, rawValue) : parseVariableValue(flagVar.type, flagVar.defaultValue),
        }
      }
      return normalized
    },

    registerListener(_type: string, _listener: (e: MessageEvent) => void): void {},
    dispatchFlagsUpdate(_flags: FlagsMap, _overrides: Overrides, notifyFn: () => void): void {
      notifyFn()
    },
    sseEventTypes: new Set<string>(),
    processSSEEvent: (): null => null,

    instrumentSDK(sdk: unknown, getOverrides: () => Overrides, onFlagsUpdate: (flags: FlagsMap) => void): boolean {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client = sdk as any
      if (!client || typeof client !== 'object') return false

      // Per-flag natural values observed from the SDK. Only the SDK's real values
      // go in here — override values are deliberately NOT recorded, so the popup
      // continues to see the underlying SDK truth even while overrides are active.
      const captured: FlagsMap = {}

      function recordNatural(key: string, value: unknown): void {
        if (captured[key]?.value !== value || !(key in captured)) {
          captured[key] = { value }
          onFlagsUpdate({ ...captured })
        }
      }

      function buildOverrideDecision(flagKey: string, v: unknown): Record<string, unknown> {
        const enabled = typeof v === 'boolean' ? v : true
        const variables = typeof v === 'boolean' ? {} : { value: v }
        return { enabled, variables, variationKey: enabled ? 'on' : 'off', ruleKey: null, flagKey, userContext: null, reasons: ['OVERRIDE'] }
      }

      function wrapDecide(target: any, methodName: string): void {
        if (typeof target[methodName] !== 'function') return
        const orig = target[methodName].bind(target)
        target[methodName] = function (flagKey: string, ...args: unknown[]) {
          const ovr = getOverrides()
          if (typeof flagKey === 'string' && flagKey in ovr) {
            return buildOverrideDecision(flagKey, ovr[flagKey])
          }
          const result = orig(flagKey, ...args)
          if (result && typeof result === 'object') {
            const decision = result as { enabled?: unknown; variables?: Record<string, unknown> }
            const vars = decision.variables || {}
            const firstVar = Object.values(vars)[0]
            recordNatural(flagKey, firstVar !== undefined ? firstVar : Boolean(decision.enabled))
          }
          return result
        }
      }

      // v6 user-context API — what most modern code (including Meridian) uses.
      if (typeof client.createUserContext === 'function') {
        const origCreate = client.createUserContext.bind(client)
        client.createUserContext = function (...args: unknown[]) {
          const ctx = origCreate(...args)
          if (ctx && typeof ctx === 'object') {
            wrapDecide(ctx, 'decide')
            // decideForKeys/decideAll return objects keyed by flagKey
            for (const m of ['decideForKeys', 'decideAll'] as const) {
              if (typeof ctx[m] !== 'function') continue
              const orig = ctx[m].bind(ctx)
              ctx[m] = function (...innerArgs: unknown[]) {
                const result = orig(...innerArgs) as Record<string, { enabled?: unknown; variables?: Record<string, unknown> }>
                const ovr = getOverrides()
                if (!result || typeof result !== 'object') return result
                const out: Record<string, unknown> = {}
                for (const [flagKey, decision] of Object.entries(result)) {
                  if (flagKey in ovr) {
                    out[flagKey] = buildOverrideDecision(flagKey, ovr[flagKey])
                  } else {
                    const vars = decision.variables || {}
                    const firstVar = Object.values(vars)[0]
                    recordNatural(flagKey, firstVar !== undefined ? firstVar : Boolean(decision.enabled))
                    out[flagKey] = decision
                  }
                }
                return out
              }
            }
          }
          return ctx
        }
      }

      // Legacy client-level decide (some setups still use it).
      wrapDecide(client, 'decide')

      if (typeof client.isFeatureEnabled === 'function') {
        const orig = client.isFeatureEnabled.bind(client)
        client.isFeatureEnabled = function (flagKey: string, ...args: unknown[]) {
          const ovr = getOverrides()
          if (typeof flagKey === 'string' && flagKey in ovr) return Boolean(ovr[flagKey])
          const value = orig(flagKey, ...args)
          recordNatural(flagKey, value)
          return value
        }
      }

      const variableMethods = ['getFeatureVariableBoolean', 'getFeatureVariableString', 'getFeatureVariableDouble', 'getFeatureVariableInteger', 'getFeatureVariableJSON']
      for (const method of variableMethods) {
        if (typeof client[method] !== 'function') continue
        const orig = client[method].bind(client)
        client[method] = function (flagKey: string, ...args: unknown[]) {
          const ovr = getOverrides()
          if (typeof flagKey === 'string' && flagKey in ovr) return ovr[flagKey]
          const value = orig(flagKey, ...args)
          recordNatural(flagKey, value)
          return value
        }
      }

      if (typeof client.getAllFeatureVariables === 'function') {
        const orig = client.getAllFeatureVariables.bind(client)
        client.getAllFeatureVariables = function (flagKey: string, ...args: unknown[]) {
          const ovr = getOverrides()
          if (typeof flagKey === 'string' && flagKey in ovr) {
            const v = ovr[flagKey]
            return typeof v === 'object' && v !== null ? v : { value: v }
          }
          const value = orig(flagKey, ...args)
          if (value && typeof value === 'object') {
            const firstVar = Object.values(value as Record<string, unknown>)[0]
            if (firstVar !== undefined) recordNatural(flagKey, firstVar)
          }
          return value
        }
      }

      log('Optimizely: client hooked')
      return true
    },
  }
}
