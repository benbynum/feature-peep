# feature-flag-devtools — Project Plan

**Version:** 0.8.0  
**Date:** 2026-05-08  
**Status:** Active — building MVP today

---

## Name

**`feature-flag-devtools`** — framework-agnostic, provider-agnostic.

---

## Problem

Developers using feature flag services have no runtime tooling for inspecting or locally overriding flag state without access to the provider's dashboard. Changing a flag in the provider to test a value locally affects every other developer hitting the same environment. On staging or QA — environments you may not control — there's no tooling at all.

The root need: **inspect and locally override flag state in any environment, without touching the app's codebase, without affecting any other developer's session, and without changing anything in the provider.**

---

## What This Tool Does

A Chrome extension that detects LaunchDarkly on any page, shows live flag state, and lets the developer override any flag value locally — without touching the app's codebase and without affecting any other developer's session.

"Without touching the app's codebase" means no installs, no commits, no config changes. The app's UI will visually change when a flag is overridden — that's the point — but the app itself has no idea it received a patched value. It behaves as if the flag was always set that way.

---

## Competitive Landscape

Research conducted 2026-05-08.

| Tool | Provider | Zero install | Overrides | Any env | Status |
|---|---|---|---|---|---|
| GrowthBook DevTools | GrowthBook only | No (`enableDevMode` required) | Yes | No | Active, 10k users |
| Optimizely Inspector | Optimizely only | Yes | Yes | Yes | Active, 597 users |
| LD JSSDK Event Viewer | LaunchDarkly only | Yes (passive) | No | Unknown | New, 3 stars |
| Everything else | Custom/single-vendor | No | Varies | No | Tiny or abandoned |

**The gap:** no tool does passive, zero-install detection with local overrides across multiple providers. LD JSSDK Event Viewer is the nearest competitor — same target, read-only only, zero traction. Override capability is our differentiator over it.

**OpenFeature:** no browser extension or devtools of any kind exists.

---

## Strategic Direction

**Extension first. LaunchDarkly first.**

LaunchDarkly has the largest install base. The extension reaches developers on staging and prod without any code changes. Override capability — patching flag values transparently in the browser — is feasible and is the core value prop, not a later addition.

**Roadmap:**
1. **MVP** — Extension: LaunchDarkly, passive detection, live flag display, local overrides
2. **v2** — Extension: OpenFeature hook injection (covers Unleash, DevCycle, etc. in one move)
3. **v3+** — Extension: Additional native providers (Statsig, DevCycle native, Flagsmith, etc.)
4. **Later** — Drop-in component (different audience, different use case)

---

## Two Products, Not Two Versions

| | Component (later) | Extension (now) |
|---|---|---|
| **Who** | Developer who owns the codebase | Any developer with the extension |
| **Where** | Local dev only | Any environment |
| **Install required** | Yes — package + JSX line | No app-side install |
| **Approach** | OpenFeature hooks API | SSE interception + SDK patching |
| **Provider-specific code** | No | Yes |
| **Fragility** | Low | Medium |

---

## MVP Scope

A Chrome extension that detects LaunchDarkly on any page, displays live flag state, and allows local flag value overrides.

**In scope:**
- `EventSource` monkey-patch in content script to intercept LD SSE stream
- LaunchDarkly SSE payload parser (`put` and `patch` events)
- Panel UI: flag list with key, value, type
- Real-time updates as provider pushes changes
- Local flag value overrides — patched transparently into the app, no codebase changes
- Override persistence across page reloads (localStorage)
- Clear individual overrides and clear all
- Payload-first detection (works through proxies and non-standard domains)
- localStorage `ld:` prefix as secondary detection signal

**Out of scope for MVP:**
- OpenFeature or any provider other than LaunchDarkly
- Firefox
- Flag evaluation history / timeline
- Evaluation reason / metadata display
- Multi-provider display

**Validation plan:**
1. Load extension unpacked in Chrome (developer mode)
2. Open existing LD-connected app locally — confirm flags display and overrides visually change app behavior
3. Push that app to dev environment — confirm extension works there too

---

## Detection Strategy

URL-based detection is not the primary mechanism. Enterprise deployments proxy LD traffic; non-standard domains (`launchdarkly.us`, `launchdarkly.gov`) break URL matching.

**Detection stack:**
1. **Payload shape** — intercept all `EventSource` connections, match LD's `put`/`patch` format
2. **localStorage `ld:` prefix** — corroborating signal, proxy-immune
3. **URL matching** — fast path for unproxied `*.launchdarkly.com` only
4. **User config** — manual override of last resort

---

## Technical Approach

### SSE interception (read)

```ts
const Original = window.EventSource
window.EventSource = class extends Original {
  constructor(url: string, init?: EventSourceInit) {
    super(url, init)
    this.addEventListener('message', (e) => tryParseLD(url, e.data))
  }
}
```

Captures full flag state from `put` events; incremental updates from `patch` events.

### Override mechanism (write)

Two viable approaches — implementation decides which:

1. **SSE response rewriting**: inject override values into the `put` payload before the SDK processes it. SDK stores overridden values natively; `variation()` calls return them without further patching.
2. **SDK method patching**: monkey-patch `LDClient.variation()` etc. to check an override store first. Clean, SDK-format-independent.

Either approach is transparent to the app. The app calls `variation('my-flag')` and receives the overridden value with no knowledge of the extension.

### Injection timing

`run_at: document_start` in manifest is critical. If the patch fires after the LD SDK initializes, the SDK holds a reference to the original `EventSource`. Primary technical risk for day one — may require a page-injected `<script>` tag rather than a content script if Manifest V3 isolated worlds prevent direct `window` access.

### Messaging

```
page (patched EventSource + override store)
  → content script (parse, normalize)
    → background service worker
      → devtools panel / popup (render flag list + override controls)
```

---

## Monorepo Structure

```
feature-flag-devtools/
├── packages/
│   ├── core/               ← panel UI, flag types, normalization (shared)
│   ├── extension/          ← Chrome extension (MVP)
│   │   ├── src/
│   │   │   ├── content/    ← EventSource patch, detection, override store
│   │   │   ├── parsers/    ← launchdarkly.ts (MVP), ...
│   │   │   ├── background/ ← service worker
│   │   │   └── panel/      ← renders <Panel /> from core
│   │   └── manifest.json
│   └── component/          ← drop-in React component (deferred)
├── examples/
│   └── demo-app/
├── plans/
└── requirements/
```

---

## Open Questions

- [ ] **Panel surface:** DevTools panel tab vs. extension popup? Decide before building UI.
- [ ] **Override mechanism:** SSE rewriting vs. SDK method patching? Decide on day one based on what's more reliable across LD SDK versions.
- [ ] **Manifest V3 injection timing:** `document_start` content script vs. page-injected script? Answer on day one.
- [ ] **LD SDK version compatibility:** Does the SSE wire format vary across major LD JS SDK versions?
- [ ] **Override persistence scope:** localStorage per origin? Per tab? Per origin is simplest and most useful.
- [ ] **Chrome Web Store policy:** Any concern with globally patching `EventSource` and SDK methods?
- [ ] **Styling approach:** Inline styles vs. CSS modules?
- [ ] **FedRAMP LD wire format:** Same SSE format as standard LD?

---

## Context / Origin

Conversation with Claude (2026-05-07–08):
- v0.2.0: multi-developer / multi-environment problem; overrides as primary value prop
- v0.3.0: component uses OF hooks, not provider wrapping; drop-in model confirmed
- v0.4.0: extension as categorically distinct product
- v0.5.0: SSE interception; monorepo; code sharing
- v0.6.0: extension-first pivot; name → `feature-flag-devtools`; payload-first detection
- v0.7.0: competitive research; LD JSSDK Event Viewer as nearest competitor; MVP scoped
- v0.8.0: corrected critical error — overrides are MVP, not deferred. "Read-only for MVP" was wrong and contradicted the problem statement. Core value prop is local overrides with no codebase changes; app UI changes visually but app has no knowledge of the patch.

---

*Bump the version header and filename when making substantive changes.*
