"use strict";
(() => {
  // src/inject/log.ts
  var log = (fmt, ...args) => console.log(`[FeaturePeep] ${fmt}`, ...args);

  // src/inject/detection.ts
  function detectProvider(url) {
    try {
      const u = new URL(url, location.href);
      const host = u.hostname;
      const path = u.pathname;
      if (/(?:^|\.)(?:clientstream|stream)\.launchdarkly\.com$/.test(host)) {
        return { id: "launchdarkly", transport: "sse" };
      }
      if (/(?:^|\.)(?:app|sdk)\.launchdarkly\.com$/.test(host)) {
        return { id: "launchdarkly", transport: "polling" };
      }
      if (/\/sdk\/evalx\/[a-f0-9-]{20,}\/contexts\//i.test(path) || /\/sdk\/eval\/[a-f0-9-]{20,}\/users\//i.test(path)) {
        return { id: "launchdarkly", transport: "polling" };
      }
      if (/\/eval\/[a-f0-9-]{20,}\//.test(path)) {
        return { id: "launchdarkly", transport: "sse" };
      }
      if (/(?:^|\.)(?:posthog|i\.posthog)\.com$/.test(host) && (/\/decide\//.test(path) || path.startsWith("/flags/"))) {
        return { id: "posthog", transport: "polling" };
      }
      if (/\/ofrep\/v1\/sse/.test(path)) {
        return { id: "openfeature", transport: "sse" };
      }
      if (/\/ofrep\/v1\//.test(path)) {
        return { id: "openfeature", transport: "polling" };
      }
      if (host === "cdn.optimizely.com" && /^\/datafiles\/[A-Za-z0-9_-]+\.json$/.test(path)) {
        return { id: "optimizely", transport: "polling" };
      }
    } catch (_) {
    }
    return null;
  }

  // src/inject/providers/launchdarkly.ts
  function create() {
    const putListeners = [];
    let pollBump = 0;
    function isPayload(data) {
      if (!data || typeof data !== "object" || Array.isArray(data)) return false;
      const vals = Object.values(data);
      return vals.length > 0 && typeof vals[0] === "object" && vals[0] !== null && "version" in vals[0];
    }
    function applySSEOverrides(flags, overrides2) {
      const result = {};
      for (const key of Object.keys(flags)) {
        result[key] = key in overrides2 ? { ...flags[key], value: overrides2[key] } : flags[key];
      }
      return result;
    }
    return {
      id: "launchdarkly",
      isPayload,
      applyPollingOverrides(data, overrides2) {
        if (!isPayload(data)) return null;
        const d = data;
        ++pollBump;
        const result = {};
        for (const key of Object.keys(d)) {
          if (key in overrides2) {
            const flag = d[key];
            result[key] = {
              ...flag,
              value: overrides2[key],
              version: (flag["version"] || 0) + pollBump,
              ...flag["flagVersion"] !== void 0 ? { flagVersion: flag["flagVersion"] + pollBump } : {}
            };
          } else {
            result[key] = d[key];
          }
        }
        return result;
      },
      normalizeFlags(data) {
        const d = data;
        const normalized = {};
        for (const [key, flag] of Object.entries(d)) {
          if (flag && typeof flag === "object" && "value" in flag) {
            normalized[key] = { value: flag["value"] };
          }
        }
        return normalized;
      },
      registerListener(type, listener) {
        if (type === "put") {
          putListeners.push(listener);
          log("EventSource: put listener registered, total=%d", putListeners.length);
        }
      },
      dispatchFlagsUpdate(currentFlags2, overrides2, notifyFn) {
        log("dispatchFlagsUpdate: listeners=%d, flags=%d", putListeners.length, Object.keys(currentFlags2).length);
        if (putListeners.length === 0 || Object.keys(currentFlags2).length === 0) return;
        const modified = applySSEOverrides(currentFlags2, overrides2);
        const fakeEvent = new MessageEvent("put", { data: JSON.stringify(modified) });
        for (const listener of putListeners) {
          try {
            listener(fakeEvent);
          } catch (err) {
            log("dispatchFlagsUpdate listener error: %o", err);
          }
        }
        notifyFn();
      },
      sseEventTypes: /* @__PURE__ */ new Set(["put", "patch", "message"]),
      processSSEEvent(type, raw, currentFlags2, overrides2) {
        if (type === "put") {
          if (!isPayload(raw)) return null;
          const modified = applySSEOverrides(raw, overrides2);
          return { flags: raw, proxyData: JSON.stringify(modified), flagsChanged: true };
        }
        if (type === "patch") {
          const r = raw;
          let key;
          let updated;
          if (r["key"] != null && r["value"] !== void 0) {
            key = r["key"];
            updated = raw;
          } else if (r["path"] != null && r["data"] != null) {
            key = r["path"].replace(/^\/flags\//, "");
            updated = r["data"];
          }
          if (!key || updated === void 0) return null;
          log("EventSource patch: %s", key);
          currentFlags2[key] = { value: updated["value"] };
          if (key in overrides2) {
            const patchedOverride = { ...r };
            if (r["key"] != null) patchedOverride["value"] = overrides2[key];
            else if (r["path"] != null) patchedOverride["data"] = { ...r["data"], value: overrides2[key] };
            return { flagsChanged: true, proxyData: JSON.stringify(patchedOverride) };
          }
          return { flagsChanged: true, proxyData: null };
        }
        return null;
      }
    };
  }

  // src/inject/providers/openfeature.ts
  function create2() {
    let hooked = false;
    const snapshotListeners = [];
    return {
      id: "openfeature",
      isPayload(data) {
        return Array.isArray(data?.["flags"]) && (data["flags"].length === 0 || data["flags"][0]?.["key"] !== void 0);
      },
      applyPollingOverrides(data, overrides2) {
        if (!this.isPayload(data)) return null;
        const d = data;
        const flags = d.flags.map(
          (flag) => flag["key"] != null && String(flag["key"]) in overrides2 ? { ...flag, value: overrides2[String(flag["key"])], variant: String(overrides2[String(flag["key"])]) } : flag
        );
        return { ...d, flags };
      },
      normalizeFlags(data) {
        const flags = data.flags;
        const normalized = {};
        for (const flag of flags) {
          if (flag["key"] != null && flag["value"] !== void 0) {
            normalized[String(flag["key"])] = { value: flag["value"] };
          }
        }
        return normalized;
      },
      instrumentSDK(openFeature, getOverrides, onFlagsUpdate) {
        if (hooked) return true;
        const client = openFeature?.getClient?.();
        if (!client) {
          log("OpenFeature: getClient() unavailable");
          return false;
        }
        const capturedFlags = {};
        const valueMethods = ["getBooleanValue", "getStringValue", "getNumberValue", "getObjectValue"];
        const detailsMethods = ["getBooleanDetails", "getStringDetails", "getNumberDetails", "getObjectDetails"];
        for (const method of valueMethods) {
          const original = client[method]?.bind(client);
          if (!original) continue;
          client[method] = function(flagKey, defaultValue, ...args) {
            const ovr = getOverrides();
            if (flagKey in ovr) {
              if (capturedFlags[flagKey]?.value !== ovr[flagKey]) {
                capturedFlags[flagKey] = { value: ovr[flagKey] };
                onFlagsUpdate({ ...capturedFlags });
              }
              return ovr[flagKey];
            }
            const value = original(flagKey, defaultValue, ...args);
            if (capturedFlags[flagKey]?.value !== value || !(flagKey in capturedFlags)) {
              capturedFlags[flagKey] = { value };
              onFlagsUpdate({ ...capturedFlags });
            }
            return value;
          };
        }
        for (const method of detailsMethods) {
          const original = client[method]?.bind(client);
          if (!original) continue;
          client[method] = function(flagKey, defaultValue, ...args) {
            const ovr = getOverrides();
            if (flagKey in ovr) {
              if (capturedFlags[flagKey]?.value !== ovr[flagKey]) {
                capturedFlags[flagKey] = { value: ovr[flagKey] };
                onFlagsUpdate({ ...capturedFlags });
              }
              return { value: ovr[flagKey], flagKey, reason: "OVERRIDE" };
            }
            const details = original(flagKey, defaultValue, ...args);
            if (capturedFlags[flagKey]?.value !== details.value || !(flagKey in capturedFlags)) {
              capturedFlags[flagKey] = { value: details.value };
              onFlagsUpdate({ ...capturedFlags });
            }
            return details;
          };
        }
        hooked = true;
        log("OpenFeature: client hooked (%d methods patched)", valueMethods.length + detailsMethods.length);
        return true;
      },
      registerListener(type, listener) {
        if (type === "flags-snapshot") {
          snapshotListeners.push(listener);
          log("OpenFeature: flags-snapshot listener registered, total=%d", snapshotListeners.length);
        }
      },
      dispatchFlagsUpdate(currentFlags2, overrides2, notifyFn) {
        log("dispatchFlagsUpdate (OF): listeners=%d, flags=%d", snapshotListeners.length, Object.keys(currentFlags2).length);
        if (snapshotListeners.length === 0 || Object.keys(currentFlags2).length === 0) {
          notifyFn();
          return;
        }
        const payload = Object.entries(currentFlags2).map(([key, flag]) => {
          const value = key in overrides2 ? overrides2[key] : flag.value;
          return { key, value, reason: "STATIC", variant: String(value) };
        });
        const fakeEvent = new MessageEvent("flags-snapshot", { data: JSON.stringify(payload) });
        for (const listener of snapshotListeners) {
          try {
            listener(fakeEvent);
          } catch (err) {
            log("dispatchFlagsUpdate listener error: %o", err);
          }
        }
        notifyFn();
      },
      sseEventTypes: /* @__PURE__ */ new Set([
        "flags-snapshot",
        "flag-changed",
        "flag-deleted",
        "provider_ready",
        "configuration_change",
        "put",
        "patch",
        "message"
      ]),
      processSSEEvent(type, raw, currentFlags2, overrides2) {
        if (type === "flags-snapshot" || type === "provider_ready" || type === "put" || type === "message") {
          if (Array.isArray(raw)) {
            const normalized = {};
            for (const flag of raw) {
              if (flag["key"] != null && flag["value"] !== void 0) {
                normalized[String(flag["key"])] = { value: flag["value"] };
              }
            }
            if (Object.keys(normalized).length === 0) return null;
            log("OFREP %s: %d flags", type, Object.keys(normalized).length);
            return { flags: normalized, proxyData: null, flagsChanged: true };
          }
          const r = raw;
          if (r["flags"] && typeof r["flags"] === "object") {
            const normalized = {};
            for (const [key, flag] of Object.entries(r["flags"])) {
              normalized[key] = { value: flag["value"] };
            }
            if (Object.keys(normalized).length === 0) return null;
            log("OFREP %s: %d flags", type, Object.keys(normalized).length);
            return { flags: normalized, proxyData: null, flagsChanged: true };
          }
          return null;
        }
        if (type === "flag-changed" || type === "configuration_change" || type === "patch") {
          const r = raw;
          if (r["key"] != null && r["value"] !== void 0) {
            log("OFREP %s: %s", type, r["key"]);
            currentFlags2[String(r["key"])] = { value: r["value"] };
            return { flagsChanged: true, proxyData: null };
          }
          if (r["flags"] && typeof r["flags"] === "object") {
            for (const [key, flag] of Object.entries(r["flags"])) {
              currentFlags2[key] = { value: flag["value"] };
            }
            log("OFREP %s: %d flags updated", type, Object.keys(r["flags"]).length);
            return { flagsChanged: true, proxyData: null };
          }
          return null;
        }
        if (type === "flag-deleted") {
          const r = raw;
          if (r["key"] != null) {
            log("OFREP flag-deleted: %s", r["key"]);
            delete currentFlags2[String(r["key"])];
            return { flagsChanged: true, proxyData: null };
          }
        }
        return null;
      }
    };
  }

  // src/inject/providers/optimizely.ts
  function create3() {
    function isPayload(data) {
      if (!data || typeof data !== "object" || Array.isArray(data)) return false;
      const d = data;
      return Array.isArray(d["featureFlags"]) && Array.isArray(d["rollouts"]) && "revision" in d;
    }
    function getDefaultExperiment(rollout) {
      if (!rollout || !Array.isArray(rollout.experiments) || rollout.experiments.length === 0) return void 0;
      return rollout.experiments[rollout.experiments.length - 1];
    }
    function getRoutedVariation(experiment) {
      if (!experiment) return void 0;
      const alloc = experiment.trafficAllocation?.[0];
      if (!alloc) return experiment.variations?.[0];
      return experiment.variations.find((v) => v.id === alloc.entityId) ?? experiment.variations?.[0];
    }
    function parseVariableValue(type, raw) {
      if (raw == null) return null;
      switch (type) {
        case "boolean":
          return raw === "true";
        case "integer": {
          const n = parseInt(raw, 10);
          return Number.isNaN(n) ? raw : n;
        }
        case "double": {
          const n = parseFloat(raw);
          return Number.isNaN(n) ? raw : n;
        }
        case "json":
          try {
            return JSON.parse(raw);
          } catch {
            return raw;
          }
        default:
          return raw;
      }
    }
    function serializeVariableValue(value) {
      if (typeof value === "string") return value;
      if (typeof value === "boolean") return value ? "true" : "false";
      if (typeof value === "number") return String(value);
      return JSON.stringify(value);
    }
    return {
      id: "optimizely",
      isPayload,
      applyPollingOverrides(data, overrides2) {
        if (!isPayload(data)) return null;
        const original = data;
        const overrideKeys = Object.keys(overrides2);
        const cloned = JSON.parse(JSON.stringify(original));
        const rolloutsById = /* @__PURE__ */ new Map();
        for (const r of cloned.rollouts) rolloutsById.set(r.id, r);
        let mutated = false;
        for (const flag of cloned.featureFlags) {
          if (!(flag.key in overrides2)) continue;
          const overrideValue = overrides2[flag.key];
          const rollout = rolloutsById.get(flag.rolloutId);
          const experiment = getDefaultExperiment(rollout);
          if (!experiment || !Array.isArray(experiment.variations) || experiment.variations.length === 0) continue;
          const desiredEnabled = typeof overrideValue === "boolean" ? overrideValue : true;
          let target = experiment.variations.find((v) => v.featureEnabled === desiredEnabled);
          if (!target) {
            target = getRoutedVariation(experiment) ?? experiment.variations[0];
            target.featureEnabled = desiredEnabled;
          }
          experiment.trafficAllocation = [{ entityId: target.id, endOfRange: 1e4 }];
          if (flag.variables && flag.variables.length > 0 && typeof overrideValue !== "boolean") {
            if (!Array.isArray(target.variables)) target.variables = [];
            const flagVar = flag.variables[0];
            if (flagVar) {
              const existing = target.variables.find((v) => v.id === flagVar.id);
              const serialized = serializeVariableValue(overrideValue);
              if (existing) {
                existing.value = serialized;
              } else {
                target.variables.push({ id: flagVar.id, value: serialized, key: flagVar.key, type: flagVar.type });
              }
            }
          }
          mutated = true;
        }
        if (mutated) {
          const currentRev = parseInt(cloned.revision || "0", 10);
          cloned.revision = String((Number.isNaN(currentRev) ? 0 : currentRev) + 1);
        }
        log("Optimizely polling: %d flags, %d overrides applied", cloned.featureFlags.length, overrideKeys.length);
        return cloned;
      },
      normalizeFlags(data) {
        if (!isPayload(data)) return {};
        const d = data;
        const rolloutsById = /* @__PURE__ */ new Map();
        for (const r of d.rollouts) rolloutsById.set(r.id, r);
        const normalized = {};
        for (const flag of d.featureFlags) {
          const rollout = rolloutsById.get(flag.rolloutId);
          const experiment = getDefaultExperiment(rollout);
          const variation = getRoutedVariation(experiment);
          if (!variation) continue;
          const enabled = variation.featureEnabled === true;
          if (!flag.variables || flag.variables.length === 0) {
            normalized[flag.key] = { value: enabled };
            continue;
          }
          const flagVar = flag.variables[0];
          const variationVar = (variation.variables || []).find((v) => v.id === flagVar.id);
          const rawValue = variationVar?.value ?? flagVar.defaultValue;
          normalized[flag.key] = {
            value: enabled ? parseVariableValue(flagVar.type, rawValue) : parseVariableValue(flagVar.type, flagVar.defaultValue)
          };
        }
        return normalized;
      },
      registerListener(_type, _listener) {
      },
      dispatchFlagsUpdate(_flags, _overrides, notifyFn) {
        notifyFn();
      },
      sseEventTypes: /* @__PURE__ */ new Set(),
      processSSEEvent: () => null,
      instrumentSDK(sdk, getOverrides, onFlagsUpdate) {
        const client = sdk;
        if (!client || typeof client !== "object") return false;
        const captured = {};
        function recordNatural(key, value) {
          if (captured[key]?.value !== value || !(key in captured)) {
            captured[key] = { value };
            onFlagsUpdate({ ...captured });
          }
        }
        function buildOverrideDecision(flagKey, v) {
          const enabled = typeof v === "boolean" ? v : true;
          const variables = typeof v === "boolean" ? {} : { value: v };
          return { enabled, variables, variationKey: enabled ? "on" : "off", ruleKey: null, flagKey, userContext: null, reasons: ["OVERRIDE"] };
        }
        function wrapDecide(target, methodName) {
          if (typeof target[methodName] !== "function") return;
          const orig = target[methodName].bind(target);
          target[methodName] = function(flagKey, ...args) {
            const ovr = getOverrides();
            if (typeof flagKey === "string" && flagKey in ovr) {
              return buildOverrideDecision(flagKey, ovr[flagKey]);
            }
            const result = orig(flagKey, ...args);
            if (result && typeof result === "object") {
              const decision = result;
              const vars = decision.variables || {};
              const firstVar = Object.values(vars)[0];
              recordNatural(flagKey, firstVar !== void 0 ? firstVar : Boolean(decision.enabled));
            }
            return result;
          };
        }
        if (typeof client.createUserContext === "function") {
          const origCreate = client.createUserContext.bind(client);
          client.createUserContext = function(...args) {
            const ctx = origCreate(...args);
            if (ctx && typeof ctx === "object") {
              wrapDecide(ctx, "decide");
              for (const m of ["decideForKeys", "decideAll"]) {
                if (typeof ctx[m] !== "function") continue;
                const orig = ctx[m].bind(ctx);
                ctx[m] = function(...innerArgs) {
                  const result = orig(...innerArgs);
                  const ovr = getOverrides();
                  if (!result || typeof result !== "object") return result;
                  const out = {};
                  for (const [flagKey, decision] of Object.entries(result)) {
                    if (flagKey in ovr) {
                      out[flagKey] = buildOverrideDecision(flagKey, ovr[flagKey]);
                    } else {
                      const vars = decision.variables || {};
                      const firstVar = Object.values(vars)[0];
                      recordNatural(flagKey, firstVar !== void 0 ? firstVar : Boolean(decision.enabled));
                      out[flagKey] = decision;
                    }
                  }
                  return out;
                };
              }
            }
            return ctx;
          };
        }
        wrapDecide(client, "decide");
        if (typeof client.isFeatureEnabled === "function") {
          const orig = client.isFeatureEnabled.bind(client);
          client.isFeatureEnabled = function(flagKey, ...args) {
            const ovr = getOverrides();
            if (typeof flagKey === "string" && flagKey in ovr) return Boolean(ovr[flagKey]);
            const value = orig(flagKey, ...args);
            recordNatural(flagKey, value);
            return value;
          };
        }
        const variableMethods = ["getFeatureVariableBoolean", "getFeatureVariableString", "getFeatureVariableDouble", "getFeatureVariableInteger", "getFeatureVariableJSON"];
        for (const method of variableMethods) {
          if (typeof client[method] !== "function") continue;
          const orig = client[method].bind(client);
          client[method] = function(flagKey, ...args) {
            const ovr = getOverrides();
            if (typeof flagKey === "string" && flagKey in ovr) return ovr[flagKey];
            const value = orig(flagKey, ...args);
            recordNatural(flagKey, value);
            return value;
          };
        }
        if (typeof client.getAllFeatureVariables === "function") {
          const orig = client.getAllFeatureVariables.bind(client);
          client.getAllFeatureVariables = function(flagKey, ...args) {
            const ovr = getOverrides();
            if (typeof flagKey === "string" && flagKey in ovr) {
              const v = ovr[flagKey];
              return typeof v === "object" && v !== null ? v : { value: v };
            }
            const value = orig(flagKey, ...args);
            if (value && typeof value === "object") {
              const firstVar = Object.values(value)[0];
              if (firstVar !== void 0) recordNatural(flagKey, firstVar);
            }
            return value;
          };
        }
        log("Optimizely: client hooked");
        return true;
      }
    };
  }

  // src/inject/providers/posthog.ts
  function create4() {
    const SCALAR = /* @__PURE__ */ new Set(["boolean", "string", "number"]);
    function isV1Payload(data) {
      return data != null && typeof data === "object" && "featureFlags" in data && typeof data["featureFlags"] === "object";
    }
    function isV2Payload(data) {
      if (!data || typeof data !== "object") return false;
      const d = data;
      if (!("flags" in d) || typeof d["flags"] !== "object" || Array.isArray(d["flags"])) return false;
      const vals = Object.values(d["flags"]);
      return vals.length === 0 || typeof vals[0] === "object" && vals[0] !== null && "enabled" in vals[0];
    }
    function isPayload(data) {
      return isV1Payload(data) || isV2Payload(data);
    }
    return {
      id: "posthog",
      isPayload,
      applyPollingOverrides(data, overrides2) {
        if (isV1Payload(data)) {
          const d = data;
          const featureFlags = { ...d["featureFlags"] };
          for (const key of Object.keys(overrides2)) {
            if (key in featureFlags && SCALAR.has(typeof featureFlags[key])) {
              featureFlags[key] = overrides2[key];
            }
          }
          log("PostHog v1 polling: %d flags", Object.keys(featureFlags).length);
          return { ...d, featureFlags };
        }
        if (isV2Payload(data)) {
          const d = data;
          const flags = { ...d["flags"] };
          for (const key of Object.keys(overrides2)) {
            if (!(key in flags)) continue;
            const override = overrides2[key];
            const flag = { ...flags[key] };
            if (typeof override === "boolean") {
              flag["enabled"] = override;
              delete flag["variant"];
            } else {
              flag["enabled"] = true;
              flag["variant"] = String(override);
            }
            flags[key] = flag;
          }
          log("PostHog v2 polling: %d flags", Object.keys(flags).length);
          return { ...d, flags };
        }
        return null;
      },
      normalizeFlags(data) {
        if (isV1Payload(data)) {
          const featureFlags = data["featureFlags"];
          const normalized2 = {};
          for (const [key, value] of Object.entries(featureFlags)) {
            if (SCALAR.has(typeof value)) normalized2[key] = { value };
          }
          return normalized2;
        }
        const flags = data["flags"];
        const normalized = {};
        for (const [key, flag] of Object.entries(flags)) {
          normalized[key] = { value: flag["variant"] != null ? flag["variant"] : flag["enabled"] };
        }
        return normalized;
      },
      registerListener(_type, _listener) {
      },
      dispatchFlagsUpdate(_flags, _overrides, notifyFn) {
        notifyFn();
      },
      sseEventTypes: /* @__PURE__ */ new Set(),
      processSSEEvent: () => null
    };
  }

  // src/constants.ts
  var SOURCE_INJECT = "fc-inject";
  var SOURCE_CONTENT = "fc-content";
  var MSG_REQUEST_OVERRIDES = "REQUEST_OVERRIDES";
  var MSG_INIT_OVERRIDES = "INIT_OVERRIDES";
  var MSG_SET_OVERRIDE = "SET_OVERRIDE";
  var MSG_CLEAR_OVERRIDE = "CLEAR_OVERRIDE";
  var MSG_CLEAR_ALL_OVERRIDES = "CLEAR_ALL_OVERRIDES";
  var MSG_FLAGS_UPDATE = "FLAGS_UPDATE";

  // src/inject/index.ts
  var currentFlags = {};
  var overrides = {};
  var detectedProvider = null;
  var detectedTransport = null;
  var overridesReady = false;
  var overridesReadyCallbacks = [];
  function waitForOverrides() {
    if (overridesReady) return Promise.resolve();
    return new Promise((resolve) => overridesReadyCallbacks.push(resolve));
  }
  var providers = [create(), create2(), create3(), create4()];
  function getProvider(id) {
    if (!id) return null;
    return providers.find((p) => p.id === id) ?? null;
  }
  function notify() {
    window.postMessage(
      {
        source: SOURCE_INJECT,
        type: MSG_FLAGS_UPDATE,
        flags: currentFlags,
        overrides,
        provider: detectedProvider,
        transport: detectedTransport
      },
      "*"
    );
  }
  function setDetected(id, transport) {
    if (detectedProvider === id && detectedTransport === "sse" && transport === "polling") return;
    detectedProvider = id;
    detectedTransport = transport;
  }
  function applyOverrideImmediate() {
    log("applyOverrideImmediate: transport=%s, provider=%s", detectedTransport, detectedProvider);
    if (detectedTransport === "sse") {
      getProvider(detectedProvider)?.dispatchFlagsUpdate(currentFlags, overrides, notify);
    }
  }
  window.addEventListener("message", (e) => {
    if (!e.data || e.data.source !== SOURCE_CONTENT) return;
    switch (e.data.type) {
      case MSG_INIT_OVERRIDES:
        overrides = e.data.overrides || {};
        overridesReady = true;
        overridesReadyCallbacks.splice(0).forEach((r) => r());
        log("INIT_OVERRIDES: %o", overrides);
        break;
      case MSG_SET_OVERRIDE:
        log("SET_OVERRIDE: %s =", e.data.key, e.data.value);
        overrides[e.data.key] = e.data.value;
        applyOverrideImmediate();
        break;
      case MSG_CLEAR_OVERRIDE:
        log("CLEAR_OVERRIDE: %s", e.data.key);
        delete overrides[e.data.key];
        applyOverrideImmediate();
        break;
      case MSG_CLEAR_ALL_OVERRIDES:
        log("CLEAR_ALL_OVERRIDES");
        overrides = {};
        applyOverrideImmediate();
        break;
    }
  });
  var OriginalFetch = window.fetch;
  window.fetch = async function(input, init) {
    const url = input instanceof Request ? input.url : String(input);
    const detected = detectProvider(url);
    const [response] = await Promise.all([OriginalFetch(input, init), detected?.transport === "polling" ? waitForOverrides() : Promise.resolve()]);
    if (!detected || detected.transport !== "polling" || !response.ok) return response;
    log("fetch: polling URL matched (%s) %s %d", detected.id, url.split("?")[0], response.status);
    try {
      const data = await response.clone().json();
      const provider = getProvider(detected.id);
      if (!provider || !provider.isPayload(data)) {
        log("fetch: not a flag payload \u2014 response shape unexpected");
        return response;
      }
      currentFlags = provider.normalizeFlags(data);
      log("fetch: flag payload \u2713, %d flags", Object.keys(currentFlags).length);
      setDetected(detected.id, "polling");
      notify();
      if (Object.keys(overrides).length === 0) return response;
      const modified = provider.applyPollingOverrides(data, overrides);
      if (!modified) return response;
      const headers = new Headers(response.headers);
      headers.set("Content-Type", "application/json");
      headers.delete("Content-Length");
      headers.delete("ETag");
      headers.delete("Last-Modified");
      return new Response(JSON.stringify(modified), { status: response.status, statusText: response.statusText, headers });
    } catch (err) {
      log("fetch: parse error %o", err);
    }
    return response;
  };
  var OriginalXHR = window.XMLHttpRequest;
  function CustomXHR() {
    const xhr = new OriginalXHR();
    let requestUrl = "";
    const originalOpen = xhr.open.bind(xhr);
    xhr.open = function(method, url, ...args) {
      requestUrl = typeof url === "string" ? url : String(url);
      originalOpen(method, url, ...args);
    };
    xhr.addEventListener("readystatechange", function() {
      if (xhr.readyState !== 4 || xhr.status !== 200) return;
      const detected = detectProvider(requestUrl);
      if (!detected || detected.transport !== "polling") return;
      try {
        const data = JSON.parse(xhr.responseText);
        const provider = getProvider(detected.id);
        if (!provider || !provider.isPayload(data)) return;
        currentFlags = provider.normalizeFlags(data);
        log("XHR: flag payload \u2713, %d flags", Object.keys(currentFlags).length);
        setDetected(detected.id, "polling");
        notify();
        if (Object.keys(overrides).length === 0) return;
        const modified = provider.applyPollingOverrides(data, overrides);
        if (!modified) return;
        const modifiedJson = JSON.stringify(modified);
        Object.defineProperty(xhr, "responseText", { get: () => modifiedJson, configurable: true });
        Object.defineProperty(xhr, "response", {
          get: function() {
            return xhr.responseType === "json" ? modified : modifiedJson;
          },
          configurable: true
        });
        log("XHR: patched responseText");
      } catch (err) {
        log("XHR: error %o", err);
      }
    });
    return xhr;
  }
  window.XMLHttpRequest = CustomXHR;
  window.XMLHttpRequest.prototype = OriginalXHR.prototype;
  Object.assign(window.XMLHttpRequest, {
    UNSENT: OriginalXHR.UNSENT,
    OPENED: OriginalXHR.OPENED,
    HEADERS_RECEIVED: OriginalXHR.HEADERS_RECEIVED,
    LOADING: OriginalXHR.LOADING,
    DONE: OriginalXHR.DONE
  });
  var OriginalEventSource = window.EventSource;
  function CustomEventSource(url, init) {
    const urlStr = typeof url === "string" ? url : String(url);
    const detected = detectProvider(urlStr);
    log("EventSource created: %s \u2192 %s", urlStr.split("?")[0], detected ? detected.transport : "not detected");
    const es = new OriginalEventSource(url, init);
    const originalAEL = es.addEventListener.bind(es);
    const provider = detected ? getProvider(detected.id) : null;
    if (!provider && typeof window.OpenFeature !== "undefined") {
      log("EventSource: unknown URL with OpenFeature SDK \u2014 transport tagged as openfeature/sse");
      if (!detectedProvider) setDetected("openfeature", "sse");
      return es;
    }
    if (!provider)
      return es;
    es.addEventListener = function(type, listener, options) {
      if (!provider.sseEventTypes.has(type)) {
        originalAEL(type, listener, options);
        return;
      }
      const fn = typeof listener === "function" ? listener : listener.handleEvent.bind(listener);
      provider.registerListener(type, fn);
      originalAEL(
        type,
        (e) => {
          try {
            const raw = JSON.parse(e.data);
            const result = provider.processSSEEvent(type, raw, currentFlags, overrides);
            if (result) {
              if (result.flags) currentFlags = result.flags;
              if (result.flagsChanged) {
                setDetected(detected.id, "sse");
                log("EventSource %s: %d flags, provider=%s", type, Object.keys(currentFlags).length, detected.id);
                notify();
              }
              if (result.proxyData != null) {
                const proxied = Object.create(e, { data: { value: result.proxyData } });
                fn(proxied);
                return;
              }
            }
          } catch (_) {
          }
          fn(e);
        },
        options
      );
    };
    return es;
  }
  Object.assign(CustomEventSource, {
    prototype: OriginalEventSource.prototype,
    CONNECTING: OriginalEventSource.CONNECTING,
    OPEN: OriginalEventSource.OPEN,
    CLOSED: OriginalEventSource.CLOSED
  });
  window.EventSource = CustomEventSource;
  window.postMessage({ source: SOURCE_INJECT, type: MSG_REQUEST_OVERRIDES, origin: location.origin }, "*");
  function tryHookOpenFeature(sdk) {
    const ofProvider = getProvider("openfeature");
    if (!ofProvider) return;
    const success = ofProvider.instrumentSDK(
      sdk,
      () => overrides,
      (flags) => {
        currentFlags = flags;
        setDetected("openfeature", "sse");
        notify();
      }
    );
    if (success) setDetected("openfeature", "sse");
  }
  (function setupOpenFeatureDetection() {
    if (typeof window.OpenFeature !== "undefined") {
      tryHookOpenFeature(window.OpenFeature);
      return;
    }
    Object.defineProperty(window, "OpenFeature", {
      configurable: true,
      set(sdk) {
        Object.defineProperty(window, "OpenFeature", { value: sdk, writable: true, configurable: true });
        tryHookOpenFeature(sdk);
      }
    });
  })();
  function tryHookOptimizely(sdk) {
    const optProvider = getProvider("optimizely");
    if (!optProvider) return;
    const success = optProvider.instrumentSDK(
      sdk,
      () => overrides,
      (flags) => {
        currentFlags = { ...currentFlags, ...flags };
        setDetected("optimizely", "polling");
        notify();
      }
    );
    if (success) setDetected("optimizely", "polling");
  }
  (function setupOptimizelyDetection() {
    if (typeof window.optimizelyClient !== "undefined") {
      tryHookOptimizely(window.optimizelyClient);
      return;
    }
    Object.defineProperty(window, "optimizelyClient", {
      configurable: true,
      set(sdk) {
        Object.defineProperty(window, "optimizelyClient", { value: sdk, writable: true, configurable: true });
        tryHookOptimizely(sdk);
      }
    });
  })();
  log("loaded");
})();
