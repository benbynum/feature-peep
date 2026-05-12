# FeatureCreep — Project Plan

**Version:** 0.14.0
**Date:** 2026-05-12
**Status:** Active — pre-publish fixes, OFREP polling, PostHog provider

---

## Scope

Three tracks in priority order:

1. **Pre-publish fixes** — blocking Chrome Store submission
2. **OFREP polling** — complete the OpenFeature provider (SSE already done)
3. **PostHog** — first new native provider

---

## Track 1: Pre-publish Fixes

### 1.1 — `windows` permission

**File:** `extension/manifest.json`

Add `"windows"` to `permissions`. The popup calls `chrome.windows.getLastFocused` and the background uses `chrome.windows.get` / `chrome.windows.onFocusChanged`. Both are present without the explicit permission today.

### 1.2 — Per-origin override scoping

Currently all overrides live under a single `fc:overrides` key in `chrome.storage.local`, causing bleed across sites.

**New key scheme:** `fc:overrides:<origin>` (e.g. `fc:overrides:https://app.example.com`)

Changes:

- **`src/inject/index.js`**: on `REQUEST_OVERRIDES`, include `location.origin` in the postMessage so content.js can compute the correct key
- **`extension/content.js`**: read `e.data.origin` and load `fc:overrides:${origin}` from storage; return it in `INIT_OVERRIDES`; use the same scoped key for inline writes if any
- **`extension/background.js`**: on `SET_OVERRIDE` / `CLEAR_OVERRIDE` / `CLEAR_ALL_OVERRIDES`, get the active tab's origin from its URL; read/write `fc:overrides:${origin}` instead of `fc:overrides`
- **`src/popup/index.js`**: no change — popup talks to background which resolves the key from the tab URL

Migration: old `fc:overrides` key is silently abandoned. No migration needed pre-publish.

### 1.3 — README accuracy

- **Supported Providers table**: add OpenFeature/OFREP row (streaming + polling once Track 2 ships)
- **Limitations**: remove "Requires LaunchDarkly streaming mode (polling not supported)"
- **Future Providers**: remove OpenFeature (it's shipped)
- **Install**: remove "Not yet on the Chrome Web Store" once published

### 1.4 — Empty state copy

`extension/popup.html`: change hint from:
> "Flags appear once the SDK initializes and streams."

to:
> "Flags appear once the SDK initializes."

### 1.5 — Store listing (manual / out-of-code)

- Screenshot(s) at 1280×800 or 640×400 (PNG or JPG)
- Short description ≤132 chars
- Long description
- Privacy policy hosted at a stable URL

---

## Track 2: OFREP Polling

Detection already maps `/ofrep/v1/` → `{ id: 'openfeature', transport: 'polling' }`. The fetch/XHR interceptors call `applyPollingOverrides` which returns `null` today (no-op stub).

### 2.1 — Provider interface: `normalizeFlags(data)`

The interceptors do `currentFlags = data` after a polling hit. For LaunchDarkly, the raw response is already `{ flagKey: { value, version } }` so `flag.value` works in the popup. OFREP and PostHog have different shapes — they need normalization before storing.

**Change to `src/inject/index.js`** (both fetch and XHR interceptors):

```js
// replace:
currentFlags = data
// with:
currentFlags = provider.normalizeFlags?.(data) ?? data
```

LaunchDarkly: no `normalizeFlags` needed (identity behavior via `??`).

### 2.2 — Implement OFREP polling in `src/inject/providers/openfeature.js`

OFREP `/ofrep/v1/evaluate/flags` response shape:
```json
{
  "flags": [
    { "key": "flag-key", "value": true, "reason": "STATIC", "variant": "true" }
  ]
}
```

**`isPayload(data)`**:
```js
Array.isArray(data?.flags) && (data.flags.length === 0 || data.flags[0]?.key !== undefined)
```

An empty `flags` array is a valid "no flags for this user" response and should be accepted — it clears `currentFlags` correctly rather than leaving stale flags visible.

**`applyPollingOverrides(data, overrides)`**:
- Validate with `isPayload`
- Clone `data.flags` array, substituting `value` for any key present in `overrides`
- Return `{ ...data, flags: clonedFlags }` (same shape, same field names)

**`normalizeFlags(data)`**:
- Map `data.flags` array → `{ [flag.key]: { value: flag.value } }`
- Used by the interceptors to populate `currentFlags`

---

## Track 3: PostHog Native Provider

PostHog uses HTTP polling for feature flags only — no SSE. All SSE provider methods are no-ops.

### 3.1 — Detection

**File:** `src/inject/detection.js`

Add after existing LaunchDarkly checks, before OFREP:

```js
// PostHog Cloud (us + eu)
if (/(?:^|\.)(?:posthog|i\.posthog)\.com$/.test(host) && /\/decide\//.test(path)) {
  return { id: 'posthog', transport: 'polling' }
}
```

Self-hosted PostHog runs on a customer-controlled domain — hostname-based detection is impossible without user config. Self-hosted is a known limitation for MVP; deferred to the options page (Phase 2).

### 3.2 — Inject provider

**New file:** `src/inject/providers/posthog.js`

PostHog `/decide/?v=3` response shape:
```json
{
  "featureFlags": { "my-flag": true, "multivariate": "variant-a" },
  "featureFlagPayloads": { "payload-flag": "{\"key\": \"value\"}" }
}
```

MVP scope: boolean, string, and number flags only. `featureFlagPayloads` (JSON payloads) are out of scope — passed through unmodified.

**`isPayload(data)`**:
```js
data && typeof data === 'object' && 'featureFlags' in data
  && typeof data.featureFlags === 'object'
```

**`applyPollingOverrides(data, overrides)`**:
- Validate with `isPayload`
- Clone `featureFlags`; for each key in `overrides`, substitute if the original value is boolean, string, or number (skip JSON/object values)
- Pass `featureFlagPayloads` through unmodified
- Return `{ ...data, featureFlags: clonedFlags }`

**`normalizeFlags(data)`**:
- Map `data.featureFlags` → `{ [key]: { value } }`, filtering to boolean/string/number values only

**SSE no-ops:**
```js
registerListener: () => {},
fireFakePut: (_flags, _overrides, notifyFn) => notifyFn(),
sseEventTypes: new Set(),
processSSEEvent: () => null,
```

### 3.3 — Popup provider meta

**New file:** `src/popup/providers/posthog.js`

```js
export const meta = {
  id: 'posthog',
  name: 'PostHog',
  logoOnly: false,
  imageSrc: null,      // fill in: hosted logo URL or base64
  viewBox: '...',      // if SVG path
  svgPath: '...',
  svgTransform: '',
}
```

Use the PostHog hedgehog SVG mark. Check what format existing providers use in `src/popup/providers/`.

### 3.4 — Wire into registries

**`src/inject/index.js`**:
```js
import { create as createPostHog } from './providers/posthog.js'
// add to providers array:
const providers = [createLaunchDarkly(), createOpenFeature(), createPostHog()]
```

**`src/popup/index.js`**:
```js
import { meta as phMeta } from './providers/posthog.js'
// add to PROVIDERS:
const PROVIDERS = { [ldMeta.id]: ldMeta, [ofMeta.id]: ofMeta, [phMeta.id]: phMeta }
```

---

## Files Affected

| File | Track | Change |
|---|---|---|
| `extension/manifest.json` | 1 | add `windows` permission |
| `src/inject/index.js` | 1, 2, 3 | origin in REQUEST_OVERRIDES; `normalizeFlags` call; PostHog import |
| `extension/content.js` | 1 | origin-scoped override key |
| `extension/background.js` | 1 | origin-scoped override key |
| `extension/popup.html` | 1 | empty state copy |
| `README.md` | 1 | accuracy fixes |
| `src/inject/providers/openfeature.js` | 2 | `isPayload`, `applyPollingOverrides`, `normalizeFlags` |
| `src/inject/detection.js` | 3 | PostHog URL patterns |
| `src/inject/providers/posthog.js` | 3 | new file |
| `src/popup/index.js` | 3 | PostHog import + PROVIDERS entry |
| `src/popup/providers/posthog.js` | 3 | new file |

---

## Open Questions

None.

---

## Out of Scope

- Options page / custom provider URLs (Phase 2 per v0.13 plan)
- PostHog self-hosted detection (requires options page)
- PostHog JSON flags and `featureFlagPayloads` (post-MVP)
- PostHog SSE / real-time flag streaming (PostHog doesn't push flag changes)
- Additional providers beyond PostHog
- Firefox

---

*Bump version and filename on substantive changes.*
