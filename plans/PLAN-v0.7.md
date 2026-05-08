# feature-flag-devtools — Project Plan

**Version:** 0.7.0  
**Date:** 2026-05-08  
**Status:** Active — building v0 today

---

## Name

**`feature-flag-devtools`** — framework-agnostic, provider-agnostic.

---

## Problem

Developers using feature flag services have no runtime tooling for inspecting flag state without access to the provider's dashboard. Changing a flag in the provider to test a value locally affects every other developer hitting the same environment. On staging or QA — environments you may not control — there's no tooling at all.

The root need: **inspect flag state in any environment, without touching the codebase or the provider.**

---

## Competitive Landscape

Research conducted 2026-05-08. Key findings:

| Tool | Provider | Zero install | Any env | Status |
|---|---|---|---|---|
| GrowthBook DevTools | GrowthBook only | No (`enableDevMode` required) | No | Active, 10k users |
| Optimizely Inspector | Optimizely only | Yes | Yes | Active, 597 users |
| LD JSSDK Event Viewer | LaunchDarkly only | Yes (passive) | Unknown | New, 3 stars — nearest competitor |
| Everything else | Custom/single-vendor | No | No | Tiny or abandoned |

**The gap:** no tool does passive, zero-install detection across multiple providers. Optimizely Inspector proves the model works. LD JSSDK Event Viewer is the one to beat for the MVP — same target, same approach, zero traction yet, read-only only.

**OpenFeature:** no browser extension or devtools of any kind exists. Complete gap.

**Core differentiator to defend:** passive multi-provider detection, zero app changes, any environment including production. Overrides without app changes (monkey-patching SDK evaluation methods) is the v2 differentiator that nothing else does.

---

## Strategic Direction

**Extension first. LaunchDarkly first.**

LaunchDarkly has the largest install base. Many teams use the native SDK without OpenFeature. The extension reaches them on staging and prod without any code changes — a categorically stronger first pitch than asking for a dependency and a commit.

**Roadmap:**
1. **MVP** — Extension: LaunchDarkly, passive SSE detection, read-only panel
2. **v2** — Extension: OpenFeature hook injection (covers Unleash, DevCycle, etc. in one move)
3. **v3+** — Extension: Additional native providers (Statsig, DevCycle native, Flagsmith SaaS)
4. **Later** — Drop-in component for developers who want the panel integrated (different audience, different use case)

---

## Two Products, Not Two Versions

| | Component (later) | Extension (now) |
|---|---|---|
| **Who** | Developer who owns the codebase | Any developer with the extension |
| **Where** | Local dev only | Any environment |
| **Install required** | Yes — package + JSX line | No app-side install |
| **Approach** | OpenFeature hooks API | SSE interception / hook injection |
| **Provider-specific code** | No | Yes |
| **Fragility** | Low | Medium |

---

## MVP Scope (building today)

A Chrome extension that passively detects LaunchDarkly on any page and displays live flag state. No app changes required.

**In scope:**
- `EventSource` monkey-patch in content script
- LaunchDarkly SSE payload parser (`put` and `patch` events)
- Panel UI: flag list with key, value, type
- Real-time updates as flags change
- Payload-first detection (works through proxies and non-standard domains)
- localStorage `ld:` prefix as secondary detection signal

**Out of scope for MVP:**
- Flag overrides
- OpenFeature or other providers
- Firefox
- Flag evaluation history
- Evaluation reason / metadata display

**Validation plan:**
1. Load extension unpacked in Chrome (developer mode)
2. Open existing LD-connected app locally — confirm flags appear
3. Push that app to dev environment — confirm extension works there too (validates non-localhost behavior, and may exercise proxy/non-standard domain detection depending on how dev env is configured)

---

## Detection Strategy

URL-based detection is not the primary mechanism. Enterprise deployments route LD traffic through proxies; non-standard domains (`launchdarkly.us`, `launchdarkly.gov`) break URL matching.

**Detection stack:**

1. **Payload shape** — intercept all `EventSource` connections, attempt LD parse on every message. LD's `put`/`patch` format with versioned flags is distinctive.
2. **localStorage `ld:` prefix** — corroborating signal, client-side and proxy-immune.
3. **URL matching** — fast path only for unproxied `*.launchdarkly.com`.
4. **User config** — manual override of last resort.

---

## Technical Approach

### Content script injection

```ts
// injected at document_start, before any SDK loads
const Original = window.EventSource
window.EventSource = class extends Original {
  constructor(url: string, init?: EventSourceInit) {
    super(url, init)
    this.addEventListener('message', (e) => tryParseLD(url, e.data))
  }
}
```

`run_at: document_start` in manifest is critical — if the patch fires after the LD SDK initializes, the SDK holds a reference to the original `EventSource` and the patch is invisible.

**Risk:** Manifest V3 restricts script injection timing. If `document_start` content scripts can't reach `window` in time (they run in an isolated world), we need an injected script via `chrome.scripting.executeScript` or a `<script>` tag injected into the page. This is the primary technical risk for day one; it's solvable but may require an iteration.

### Messaging architecture

```
page (patched EventSource)
  → content script (tryParseLd, normalizes flag state)
    → background service worker (chrome.runtime.sendMessage)
      → devtools panel / popup (renders flag list)
```

### LaunchDarkly SSE parser

```ts
// put event: full flag state
{ flags: { [key: string]: { value: unknown, version: number, ... } } }

// patch event: single flag update
{ path: '/flags/flag-key', data: { value: unknown, version: number, ... } }
```

Parser normalizes both into a flat `Map<string, FlagState>` that the panel renders from.

---

## Monorepo Structure

```
feature-flag-devtools/
├── packages/
│   ├── core/               ← panel UI, flag types, normalization (shared)
│   ├── extension/          ← Chrome extension (MVP)
│   │   ├── src/
│   │   │   ├── content/    ← EventSource patch, detection
│   │   │   ├── parsers/    ← launchdarkly.ts (MVP), openfeature.ts (v2), ...
│   │   │   ├── background/ ← service worker
│   │   │   └── panel/      ← renders <Panel /> from core
│   │   └── manifest.json
│   └── component/          ← drop-in React component (deferred)
├── examples/
│   └── demo-app/           ← test app for dogfooding
├── plans/
└── requirements/
```

---

## Open Questions

- [ ] Manifest V3 injection timing: does `document_start` content script reach `window.EventSource` before the LD SDK, or do we need a page-injected script? (answer today)
- [ ] Payload collision: are there common SSE formats that could false-positive as LD? (low priority — acceptable risk for MVP)
- [ ] LD SDK versions: does the SSE `put`/`patch` format vary across LD JS SDK major versions?
- [ ] `window.OpenFeature` availability: is it exposed in all OF web SDK versions? (v2 concern)
- [ ] Chrome Web Store policy: any concern with globally patching `EventSource`? (pre-submission review)
- [ ] Does FedRAMP LD (`launchdarkly.us`) use the same SSE wire format?
- [ ] Styling: CSS modules, inline styles, or headless?
- [ ] OpenFeature community listing appetite?

---

## Context / Origin

Conversation with Claude (2026-05-07–08):
- v0.2.0: multi-developer / multi-environment problem; overrides as primary value prop
- v0.3.0: component uses OF hooks, not provider wrapping; drop-in model confirmed
- v0.4.0: extension reframed as categorically distinct product
- v0.5.0: extension uses SSE interception; monorepo structure; code sharing via core package
- v0.6.0: extension-first pivot; name → `feature-flag-devtools`; payload-first detection to handle proxies and non-standard domains
- v0.7.0: competitive research completed — space is genuinely unoccupied for multi-provider zero-install detection; LD JSSDK Event Viewer is nearest competitor (read-only, no traction); MVP scoped to LD extension, building today, validation plan documented

---

*Bump the version header and filename when making substantive changes.*
