# feature-flag-devtools — Project Plan

**Version:** 0.10.0  
**Date:** 2026-05-08  
**Status:** Active — feasibility confirmed, building for real

---

## Feasibility: Confirmed ✅

Spike validated all three technical unknowns on 2026-05-08:

| Check | Result | Detail |
|---|---|---|
| S1: MV3 content script can patch `window.EventSource` before SDK loads | ✅ | `<script>` tag injection from content.js into page DOM reaches `window` before the LD SDK initializes |
| S2: SSE `put` payload is interceptable and readable | ✅ | LD client SDK streams flags as a flat object: `{"flag-key": {version, flagVersion, value, variation, ...}}` — not wrapped in `{flags: {}}` as initially assumed |
| S3: Proxied `MessageEvent.data` is seen by the SDK — app renders accordingly | ✅ | `Object.create(e, { data: { value: modifiedPayload } })` delivers modified flag values to the SDK transparently. Flipping `sample-flag` from `true → false` caused the feature to disappear from the app UI. SDK and app had no knowledge of the interception. |

**The override mechanism works. Build for real.**

---

## Name

**`feature-flag-devtools`** — framework-agnostic, provider-agnostic. Project directory rename deferred until after MVP is working.

---

## Problem

Developers using feature flag services have no runtime tooling for inspecting or locally overriding flag state without touching the provider. Changing a flag in the provider affects every other developer hitting the same environment. On staging or QA you may not even have permission to do that.

The root need: **inspect and locally override flag state in any environment, without touching the app's codebase, without affecting any other developer's session, and without changing anything in the provider.**

"Without touching the app's codebase" means no installs, no commits, no config changes. The app's UI will visually change when a flag is overridden — that's the point — but the app has no idea it received a patched value.

---

## What This Tool Does

A Chrome extension that detects LaunchDarkly on any page, shows live flag state, and lets the developer override any flag value locally — without touching the app's codebase and without affecting any other developer's session.

---

## Competitive Landscape

| Tool | Provider | Zero install | Overrides | Any env | Status |
|---|---|---|---|---|---|
| GrowthBook DevTools | GrowthBook only | No (`enableDevMode`) | Yes | No | Active, 10k users |
| Optimizely Inspector | Optimizely only | Yes | Yes | Yes | Active, 597 users |
| LD JSSDK Event Viewer | LaunchDarkly only | Yes | No | Unknown | New, 3 stars |
| Everything else | Custom/single | No | Varies | No | Tiny or abandoned |

Gap: no tool does passive zero-install detection + overrides across multiple providers. LD JSSDK Event Viewer is nearest competitor — same target, read-only, no traction. Override capability is our differentiator.

---

## Roadmap

1. **MVP** — Extension: LaunchDarkly, passive detection, live flag display, local overrides, popup UI
2. **v2** — Extension: OpenFeature hook injection (covers Unleash, DevCycle, etc. in one move)
3. **v3+** — Extension: Additional native providers
4. **Later** — Drop-in React component (different audience, different use case)

---

## MVP Scope

**In scope:**
- Content script injects page-world script via `<script>` tag
- `window.EventSource` patch intercepts LD SSE stream
- LD client SDK `put`/`patch` parser (flat flag object format confirmed)
- Popup UI: flag list with key, value, type; override controls
- Local flag value overrides via proxied `MessageEvent.data`
- Override persistence across reloads (localStorage)
- Clear individual overrides and clear all
- Visual distinction between overridden and provider-resolved flags
- Payload-first LD detection (works through proxies)

**Out of scope for MVP:**
- OpenFeature or any provider other than LaunchDarkly
- Firefox
- Flag evaluation history
- Evaluation reason / metadata
- DevTools panel (popup confirmed as the surface)

---

## Technical Approach (confirmed)

### Injection chain

```
manifest.json
  content_scripts: content.js (document_start, isolated world)
    → injects inject.js as <script> tag into page DOM (page world)
      → patches window.EventSource
      → wraps addEventListener on each new EventSource instance
      → proxies MessageEvent.data with overrides applied before SDK sees it
      → posts flag state to content.js via window.postMessage
  content.js
    → relays to background service worker via chrome.runtime.sendMessage
  background.js
    → relays to popup via chrome.runtime.sendMessage / port
  popup.html + popup.js
    → renders flag list and override controls
```

### LD SSE format (confirmed from spike)

```js
// put event — full flag state, flat object:
{
  "flag-key": {
    "version": 16,
    "flagVersion": 17,
    "value": true,        // the resolved value
    "variation": 0,
    "trackEvents": false
  }
}

// patch event — single flag update (format TBC from live observation)
```

### Override proxy (confirmed working)

```js
es.addEventListener = function(type, listener, options) {
  if (type === 'put' || type === 'patch' || type === 'message') {
    originalAddEventListener(type, (e) => {
      const modified = applyOverrides(JSON.parse(e.data))
      const proxied = Object.create(e, { data: { value: JSON.stringify(modified) } })
      listener(proxied)
    }, options)
  } else {
    originalAddEventListener(type, listener, options)
  }
}
```

### Override storage

Overrides stored in `localStorage` under a known key (e.g. `ffd:overrides`), scoped per origin. `inject.js` reads overrides on every `put`/`patch` event and applies them before proxying. Popup reads and writes the same storage via `chrome.scripting` or a content script bridge.

---

## Detection Strategy

1. **Payload shape** — flat object of versioned flag objects (confirmed format)
2. **localStorage `ld:` prefix** — corroborating signal
3. **URL matching** — fast path for `*.launchdarkly.com`
4. **User config** — manual fallback

---

## Monorepo Structure (target, post-MVP)

```
feature-flag-devtools/
├── packages/
│   ├── core/               ← panel UI, flag types, normalization
│   ├── extension/          ← Chrome extension
│   └── component/          ← drop-in React component (deferred)
├── examples/
│   └── demo-app/
├── spike/                  ← throwaway validation code (keep for reference)
├── plans/
└── requirements/
```

For MVP, build directly in `extension/` without the monorepo wrapper. Refactor into monorepo after MVP is working.

---

## Open Questions

- [ ] `patch` event format: confirm from live observation (spike only saw `put`)
- [ ] Override input UX: inline toggle for booleans, text input for string/number/object?
- [ ] Override persistence scope: per origin (confirmed as right default)
- [ ] `localStorage` key for overrides: `ffd:overrides` or similar — must not collide with `ld:` prefix
- [ ] Chrome Web Store policy: review before submission
- [ ] Styling: inline styles for MVP (no build complexity)

---

## Context / Origin

- v0.2–v0.5: problem, component model, SSE interception approach, monorepo
- v0.6: extension-first pivot; payload-first detection; name change
- v0.7: competitive research; LD JSSDK Event Viewer as nearest competitor
- v0.8: overrides confirmed as MVP (not deferred); corrected "read-only" error
- v0.9: pivoted to feasibility spike before building
- v0.10: spike complete — all three checks pass. LD client SDK `put` format confirmed (flat object, not `{flags:{}}`). Override proxy via `Object.create` confirmed working. Building for real.

---

*Bump the version header and filename when making substantive changes.*
