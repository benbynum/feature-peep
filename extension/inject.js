(() => {
  // src/inject/log.js
  var log = (fmt, ...args) => console.log(`[FeatureCreep] ${fmt}`, ...args);

  // src/inject/detection.js
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
    } catch (_) {
    }
    return null;
  }

  // src/inject/providers/launchdarkly.js
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
      // Modifies a polling flag payload to inject overrides. Bumps version fields
      // so the SDK's change-detection (newVersion > storedVersion) fires correctly.
      // Returns the modified payload, or null if data is not a flag payload.
      applyPollingOverrides(data, overrides2) {
        if (!isPayload(data)) return null;
        ++pollBump;
        const result = {};
        for (const key of Object.keys(data)) {
          if (key in overrides2) {
            const flag = data[key];
            result[key] = {
              ...flag,
              value: overrides2[key],
              version: (flag.version || 0) + pollBump,
              ...flag.flagVersion !== void 0 ? { flagVersion: flag.flagVersion + pollBump } : {}
            };
          } else {
            result[key] = data[key];
          }
        }
        return result;
      },
      registerPutListener(listener) {
        putListeners.push(listener);
        log("EventSource: put listener registered, total=%d", putListeners.length);
      },
      fireFakePut(currentFlags2, overrides2, notifyFn) {
        log("fireFakePut: listeners=%d, flags=%d", putListeners.length, Object.keys(currentFlags2).length);
        if (putListeners.length === 0 || Object.keys(currentFlags2).length === 0) return;
        const modified = applySSEOverrides(currentFlags2, overrides2);
        const fakeEvent = new MessageEvent("put", { data: JSON.stringify(modified) });
        for (const listener of putListeners) {
          try {
            listener(fakeEvent);
          } catch (err) {
            log("fireFakePut listener error: %o", err);
          }
        }
        notifyFn();
      },
      // Returns the overridden flag map to send to the SDK, or null if not an LD payload.
      handleSSEPut(raw, overrides2) {
        if (!isPayload(raw)) return null;
        return applySSEOverrides(raw, overrides2);
      },
      // Mutates currentFlags with the patched flag. Returns whether a patch was
      // recognized and, if an override is active, the modified event data to proxy.
      handleSSEPatch(raw, currentFlags2, overrides2) {
        let key, updated;
        if (raw.key && raw.value !== void 0) {
          key = raw.key;
          updated = raw;
        } else if (raw.path && raw.data) {
          key = raw.path.replace(/^\/flags\//, "");
          updated = raw.data;
        }
        if (!key || !updated) return { patched: false };
        log("EventSource patch: %s", key);
        currentFlags2[key] = updated;
        if (key in overrides2) {
          const patchedOverride = { ...raw };
          if (raw.key) patchedOverride.value = overrides2[key];
          else if (raw.path) patchedOverride.data = { ...updated, value: overrides2[key] };
          return { patched: true, overrideData: patchedOverride };
        }
        return { patched: true, overrideData: null };
      }
    };
  }

  // src/inject/providers/openfeature.js
  function create2() {
    let hooked = false;
    return {
      id: "openfeature",
      isPayload: () => false,
      applyPollingOverrides: () => null,
      // Patches OpenFeature client evaluation methods to capture flags and inject overrides.
      // Works for any underlying provider regardless of transport.
      hookSDK(openFeature, getOverrides, onFlagsUpdate) {
        if (hooked) return true;
        const client = openFeature.getClient?.();
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
      registerPutListener() {
      },
      // No SSE replay for OF — evaluation hooks return overrides on the next call.
      // Just fire notify() so the popup stays in sync with the current override state.
      fireFakePut(currentFlags2, overrides2, notifyFn) {
        notifyFn();
      },
      handleSSEPut: () => null,
      handleSSEPatch: () => ({ patched: false })
    };
  }

  // src/inject/index.js
  var currentFlags = {};
  var overrides = {};
  var detectedProvider = null;
  var detectedTransport = null;
  var providers = [create(), create2()];
  function getProvider(id) {
    return providers.find((p) => p.id === id) ?? null;
  }
  function notify() {
    window.postMessage({
      source: "fc-inject",
      type: "FLAGS_UPDATE",
      flags: currentFlags,
      overrides,
      provider: detectedProvider,
      transport: detectedTransport
    }, "*");
  }
  function setDetected(id, transport) {
    detectedProvider = id;
    detectedTransport = transport;
  }
  function applyOverrideImmediate() {
    log("applyOverrideImmediate: transport=%s, provider=%s", detectedTransport, detectedProvider);
    if (detectedTransport === "sse") {
      getProvider(detectedProvider)?.fireFakePut(currentFlags, overrides, notify);
    }
  }
  window.addEventListener("message", (e) => {
    if (!e.data || e.data.source !== "fc-content") return;
    switch (e.data.type) {
      case "INIT_OVERRIDES":
        overrides = e.data.overrides || {};
        log("INIT_OVERRIDES: %o", overrides);
        break;
      case "SET_OVERRIDE":
        log("SET_OVERRIDE: %s =", e.data.key, e.data.value);
        overrides[e.data.key] = e.data.value;
        applyOverrideImmediate();
        break;
      case "CLEAR_OVERRIDE":
        log("CLEAR_OVERRIDE: %s", e.data.key);
        delete overrides[e.data.key];
        applyOverrideImmediate();
        break;
      case "CLEAR_ALL_OVERRIDES":
        log("CLEAR_ALL_OVERRIDES");
        overrides = {};
        applyOverrideImmediate();
        break;
    }
  });
  var OriginalFetch = window.fetch;
  window.fetch = async function(input, init) {
    const url = input instanceof Request ? input.url : String(input);
    const response = await OriginalFetch.call(this, input, init);
    const detected = detectProvider(url);
    if (!detected || detected.transport !== "polling" || !response.ok) return response;
    log("fetch: polling URL matched (%s) %s %d", detected.id, url.split("?")[0], response.status);
    try {
      const data = await response.clone().json();
      const provider = getProvider(detected.id);
      const modified = provider?.applyPollingOverrides(data, overrides);
      if (modified) {
        log("fetch: flag payload \u2713, %d flags", Object.keys(data).length);
        setDetected(detected.id, "polling");
        currentFlags = data;
        notify();
        return new Response(JSON.stringify(modified), {
          status: response.status,
          statusText: response.statusText,
          headers: { "Content-Type": "application/json" }
        });
      }
      log("fetch: not a flag payload \u2014 response shape unexpected");
    } catch (err) {
      log("fetch: parse error %o", err);
    }
    return response;
  };
  var OriginalXHR = window.XMLHttpRequest;
  window.XMLHttpRequest = function() {
    const xhr = new OriginalXHR();
    let requestUrl = "";
    const originalOpen = xhr.open.bind(xhr);
    xhr.open = function(method, url, ...args) {
      requestUrl = typeof url === "string" ? url : String(url);
      return originalOpen(method, url, ...args);
    };
    xhr.addEventListener.call(xhr, "readystatechange", function() {
      if (xhr.readyState !== 4 || xhr.status !== 200) return;
      const detected = detectProvider(requestUrl);
      if (!detected || detected.transport !== "polling") return;
      try {
        const data = JSON.parse(xhr.responseText);
        const provider = getProvider(detected.id);
        const modified = provider?.applyPollingOverrides(data, overrides);
        if (!modified) return;
        log("XHR: flag payload \u2713, %d flags", Object.keys(data).length);
        setDetected(detected.id, "polling");
        currentFlags = data;
        const modifiedJson = JSON.stringify(modified);
        Object.defineProperty(xhr, "responseText", { get: () => modifiedJson, configurable: true });
        Object.defineProperty(xhr, "response", {
          get: function() {
            return xhr.responseType === "json" ? modified : modifiedJson;
          },
          configurable: true
        });
        log("XHR: patched responseText");
        notify();
      } catch (err) {
        log("XHR: error %o", err);
      }
    });
    return xhr;
  };
  window.XMLHttpRequest.prototype = OriginalXHR.prototype;
  var OriginalEventSource = window.EventSource;
  window.EventSource = function(url, init) {
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
    if (!provider) return es;
    es.addEventListener = function(type, listener, options) {
      if (type !== "put" && type !== "patch" && type !== "message") {
        originalAEL(type, listener, options);
        return;
      }
      if (type === "put") provider.registerPutListener(listener);
      originalAEL(type, (e) => {
        try {
          const raw = JSON.parse(e.data);
          if (type === "put") {
            const modified = provider.handleSSEPut(raw, overrides);
            if (modified !== null) {
              setDetected(detected.id, "sse");
              log("EventSource put: %d flags, provider=%s", Object.keys(raw).length, detected.id);
              currentFlags = raw;
              notify();
              const proxied = Object.create(e, { data: { value: JSON.stringify(modified) } });
              listener(proxied);
              return;
            }
          }
          if (type === "patch") {
            const result = provider.handleSSEPatch(raw, currentFlags, overrides);
            if (result.patched) {
              notify();
              if (result.overrideData) {
                const proxied = Object.create(e, { data: { value: JSON.stringify(result.overrideData) } });
                listener(proxied);
                return;
              }
            }
          }
        } catch (_) {
        }
        listener(e);
      }, options);
    };
    return es;
  };
  window.EventSource.prototype = OriginalEventSource.prototype;
  window.EventSource.CONNECTING = OriginalEventSource.CONNECTING;
  window.EventSource.OPEN = OriginalEventSource.OPEN;
  window.EventSource.CLOSED = OriginalEventSource.CLOSED;
  window.postMessage({ source: "fc-inject", type: "REQUEST_OVERRIDES" }, "*");
  function tryHookOpenFeature(sdk) {
    const ofProvider = getProvider("openfeature");
    if (!ofProvider) return;
    const success = ofProvider.hookSDK(sdk, () => overrides, (flags) => {
      currentFlags = flags;
      if (!detectedProvider) setDetected("openfeature", "sse");
      notify();
    });
    if (success && !detectedProvider) setDetected("openfeature", "sse");
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
  log("loaded");
})();
