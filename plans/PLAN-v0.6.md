# feature-flag-devtools — Project Plan

**Version:** 0.6.0  
**Date:** 2026-05-08  
**Status:** Pre-development / requirements iteration

---

## Name

**`feature-flag-devtools`** — framework-agnostic, provider-agnostic, describes exactly what it is.

Previous working name `openfeature-react-devtools` is retired. The extension works at the network layer regardless of framework or whether OpenFeature is in use. Scoping the name to either would misrepresent the product.

---

## Problem

Developers using feature flag services have no runtime tooling for inspecting flag state without access to the provider's dashboard. The only options are `console.log`, network tab spelunking, or logging into LaunchDarkly and hoping the flag state you see there matches what the page actually evaluated.

This is worse in multi-environment and multi-developer setups. Changing a flag in the provider to test a value locally affects every other developer hitting the same environment. On staging or QA — environments you may not even control — there's no tooling at all.

The root need: **inspect and override flag state in any environment, without touching the codebase or the provider.**

---

## Strategic Direction

**Extension first. LaunchDarkly first.**

The extension reaches every environment — local, dev, staging, QA, production — with zero app-side install. The component only reaches developers who own the codebase, use OpenFeature, and are running in dev mode. The extension's addressable audience is categorically larger.

LaunchDarkly has the largest install base of any feature flag service, and many of those teams use the native SDK without OpenFeature. Starting there maximizes immediate reach. OpenFeature support follows as v2, which — via hook injection — covers Unleash, DevCycle, and other OF-compatible providers in one move.

The component remains in the roadmap but is not the MVP.

---

## Product Roadmap

### MVP — Extension: LaunchDarkly

Browser extension that detects LaunchDarkly on any page and displays live flag state. No app changes required.

- Payload-based LD detection (see Detection below)
- SSE stream interception and parsing
- Panel UI: flag list with names, values, types
- Real-time updates as flags change
- Chrome only

### v2 — Extension: OpenFeature

Add OpenFeature detection. When `window.OpenFeature` is present, inject a hook instead of parsing SSE — one move covers all OF-compatible providers (Unleash, DevCycle, Flagsmith, etc.).

### v3+ — Extension: Additional Native Providers

Named SaaS providers for teams not using OpenFeature: Statsig, DevCycle native, Flagsmith SaaS, etc. Each adds a payload parser. Self-hosted providers (Unleash, GrowthBook) are lower priority due to detection complexity.

### Later — Drop-in Component

React component for developers who want the panel integrated into their app. Uses OpenFeature hooks API. Provider-agnostic. Serves a different use case (persistent, dev-mode, opt-in) from a different audience (developers who own the codebase). Not the MVP; deferred until the extension's panel UI is stable.

---

## Detection Strategy

URL-based detection is insufficient and must not be the primary mechanism. Enterprise and government deployments commonly route provider traffic through proxies — the page makes requests to `flags.mycompany.com`, not `clientstream.launchdarkly.com`. Non-standard TLDs (`launchdarkly.gov`, `launchdarkly.us` for FedRAMP) also break URL matching. The extension cannot assume it will ever see a LaunchDarkly domain in a URL.

### Detection stack (in priority order)

**1. Payload shape — primary signal**

Intercept all `EventSource` connections regardless of URL. Attempt to parse the event data against known provider wire formats. LaunchDarkly's SSE payload is distinctive:

```
event: put
data: {"flags":{"flag-key":{"value":true,"version":1,...}}}

event: patch
data: {"path":"/flags/flag-key","data":{"value":false,...}}
```

The combination of `flags` object, versioned flag values, and `put`/`patch` event types is unlikely to collide with other SSE streams (chat, notifications, live data feeds). Collision risk is low; false positive risk is acceptable given the secondary signals below.

**2. localStorage prefix — secondary confirmation**

LaunchDarkly consistently writes client-side storage under `ld:` prefixed keys. This happens in the browser regardless of any proxy. A strong corroborating signal when payload detection fires.

**3. URL matching — fast path only**

If the URL contains `launchdarkly.com`, skip payload parsing and go straight to LD mode. This is an optimization for the common unproxied case, not the primary detection path.

**4. User configuration — manual fallback**

For heavily locked-down environments where all automatic detection fails, the extension provides a manual override: "I'm on a LaunchDarkly app." Stored per origin. Last resort.

### Detection for non-SSE providers

Some providers use HTTP polling rather than SSE (some Flagsmith configs, some Unleash setups). For these, intercept `fetch`/`XHR` and apply the same payload-first approach — watch all traffic, filter by response shape. Noisier than SSE interception but workable. Not needed for LaunchDarkly MVP.

---

## Technical Approach

### SSE interception

The content script patches `EventSource` before the SDK loads. All connections are observed; the LD payload parser runs opportunistically on all of them.

```ts
const OriginalEventSource = window.EventSource
window.EventSource = class extends OriginalEventSource {
  constructor(url: string, init?: EventSourceInit) {
    super(url, init)
    this.addEventListener('message', (e) => tryParseAsProvider(url, e.data))
  }
}
```

`tryParseAsProvider` runs each registered parser in sequence. First match wins. Parsed flag state is forwarded to the panel via the extension's messaging layer.

### Provider parsers

```
extension/
└── src/
    └── parsers/
        ├── launchdarkly.ts    ← MVP
        ├── openfeature.ts     ← v2 (hook injection, not SSE)
        ├── statsig.ts         ← v3+
        └── ...
```

Wire formats are undocumented but stable in practice. Known maintenance surface; not a weekly burden.

### OpenFeature (v2) — hook injection, not SSE parsing

When `window.OpenFeature` is detected, inject a hook rather than parsing SSE:

```ts
window.OpenFeature.addHooks(new DevToolsHook(forwardToPanel))
```

One hook covers all OpenFeature-compatible providers. No per-provider parsing needed for the OF path.

---

## Monorepo Structure

pnpm workspaces. The panel UI is built once in `core` and consumed by both the extension and (eventually) the drop-in component. The extension is a shell: Manifest v3 boilerplate + interception layer + parser registry + panel render.

```
feature-flag-devtools/
├── packages/
│   ├── core/                   ← panel UI, flag types, normalization — shared
│   ├── extension/              ← browser extension
│   │   ├── src/
│   │   │   ├── content/        ← EventSource/fetch patch, detection orchestration
│   │   │   ├── parsers/        ← per-provider payload parsers
│   │   │   ├── background/     ← service worker
│   │   │   └── panel/          ← renders <Panel /> from core
│   │   └── manifest.json
│   └── component/              ← drop-in React component (deferred)
├── examples/
│   └── demo-app/               ← LD-configured test app for dogfooding
├── plans/
└── requirements/
```

---

## Open Questions

- [ ] Manifest v3 content script injection timing: can `EventSource` be reliably patched before the LD SDK loads, or is a `"run_at": "document_start"` content script with a separate injected script needed?
- [ ] Payload collision risk: are there common SSE stream formats that could false-positive as LaunchDarkly? Worth surveying (Pusher, Ably, etc.).
- [ ] Does `window.OpenFeature` exist reliably in all OF web SDK versions, or is this version-dependent?
- [ ] localStorage `ld:` key prefix: confirm this is stable across LD JS SDK major versions.
- [ ] Chrome Web Store: any policy concerns with a content script that patches `EventSource` globally? Worth reviewing before investing in the extension.
- [ ] Does the FedRAMP offering (`launchdarkly.us` or similar) use the same SSE wire format? Payload detection should handle it, but worth confirming.
- [ ] Styling approach for the panel: CSS modules, inline styles, or zero-style with a headless option?
- [ ] Is there appetite from OpenFeature maintainers to list this as a community tool?

---

## Context / Origin

Conversation with Claude (2026-05-07–08) covering:
- Initial project ideation
- OpenFeature provider landscape; LaunchDarkly as dominant install base
- Component drop-in model (React Query Devtools pattern, OpenFeature hooks)
- Extension as categorically distinct product — zero install, any environment
- SSE interception via `EventSource` monkey-patch in content script
- v0.6.0: strategic pivot finalized — extension first, LaunchDarkly first, component deferred. Name changed to `feature-flag-devtools` (framework/provider agnostic). URL-based detection retired as primary mechanism in favor of payload-shape detection, addressing proxy deployments and non-standard domains (FedRAMP, .gov). Full detection stack documented. OpenFeature v2 path clarified as hook injection (not SSE parsing), covering all OF providers in one move.

---

*Bump the version header and filename when making substantive changes.*
