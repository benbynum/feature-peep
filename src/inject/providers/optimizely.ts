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
        const variation = getRoutedVariation(experiment)
        if (!experiment || !variation) continue

        // Force 100% traffic to this variation.
        experiment.trafficAllocation = [{ entityId: variation.id, endOfRange: 10000 }]

        // Boolean-only flag (no variables): toggle featureEnabled.
        if (!flag.variables || flag.variables.length === 0) {
          variation.featureEnabled = Boolean(overrideValue)
          mutated = true
          continue
        }

        // Flag with variables: featureEnabled stays true so variables are returned;
        // override the first variable's value. If the override is itself a boolean,
        // also flip featureEnabled so callers using isFeatureEnabled see the change.
        variation.featureEnabled = typeof overrideValue === 'boolean' ? overrideValue : true

        if (!Array.isArray(variation.variables)) variation.variables = []
        const flagVar = flag.variables[0]
        if (flagVar && typeof overrideValue !== 'boolean') {
          const existing = variation.variables.find(v => v.id === flagVar.id)
          const serialized = serializeVariableValue(overrideValue)
          if (existing) {
            existing.value = serialized
          } else {
            variation.variables.push({
              id: flagVar.id,
              value: serialized,
              key: flagVar.key,
              type: flagVar.type,
            })
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

      const captured: FlagsMap = {}

      function record(key: string, value: unknown): void {
        if (captured[key]?.value !== value || !(key in captured)) {
          captured[key] = { value }
          onFlagsUpdate({ ...captured })
        }
      }

      // decide(flagKey, options?) → { enabled, variables, variationKey, ... }
      if (typeof client.decide === 'function') {
        const orig = client.decide.bind(client)
        client.decide = function (flagKey: string, ...args: unknown[]) {
          const ovr = getOverrides()
          if (typeof flagKey === 'string' && flagKey in ovr) {
            const v = ovr[flagKey]
            record(flagKey, v)
            const enabled = typeof v === 'boolean' ? v : true
            const variables = typeof v === 'boolean' ? {} : { value: v }
            return {
              enabled,
              variables,
              variationKey: enabled ? 'on' : 'off',
              ruleKey: null,
              flagKey,
              userContext: null,
              reasons: ['OVERRIDE'],
            }
          }
          const result = orig(flagKey, ...args)
          if (result && typeof result === 'object') {
            const decision = result as {
              enabled?: unknown
              variables?: Record<string, unknown>
            }
            const vars = decision.variables || {}
            const firstVar = Object.values(vars)[0]
            record(flagKey, firstVar !== undefined ? firstVar : Boolean(decision.enabled))
          }
          return result
        }
      }

      if (typeof client.isFeatureEnabled === 'function') {
        const orig = client.isFeatureEnabled.bind(client)
        client.isFeatureEnabled = function (flagKey: string, ...args: unknown[]) {
          const ovr = getOverrides()
          if (typeof flagKey === 'string' && flagKey in ovr) {
            const v = Boolean(ovr[flagKey])
            record(flagKey, v)
            return v
          }
          const value = orig(flagKey, ...args)
          record(flagKey, value)
          return value
        }
      }

      const variableMethods = ['getFeatureVariableBoolean', 'getFeatureVariableString', 'getFeatureVariableDouble', 'getFeatureVariableInteger', 'getFeatureVariableJSON']
      for (const method of variableMethods) {
        if (typeof client[method] !== 'function') continue
        const orig = client[method].bind(client)
        client[method] = function (flagKey: string, ...args: unknown[]) {
          const ovr = getOverrides()
          if (typeof flagKey === 'string' && flagKey in ovr) {
            const v = ovr[flagKey]
            record(flagKey, v)
            return v
          }
          const value = orig(flagKey, ...args)
          record(flagKey, value)
          return value
        }
      }

      if (typeof client.getAllFeatureVariables === 'function') {
        const orig = client.getAllFeatureVariables.bind(client)
        client.getAllFeatureVariables = function (flagKey: string, ...args: unknown[]) {
          const ovr = getOverrides()
          if (typeof flagKey === 'string' && flagKey in ovr) {
            const v = ovr[flagKey]
            record(flagKey, v)
            return typeof v === 'object' && v !== null ? v : { value: v }
          }
          const value = orig(flagKey, ...args)
          if (value && typeof value === 'object') {
            const firstVar = Object.values(value as Record<string, unknown>)[0]
            if (firstVar !== undefined) record(flagKey, firstVar)
          }
          return value
        }
      }

      log('Optimizely: client hooked')
      return true
    },
  }
}
