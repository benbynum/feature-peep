# openfeature-react-devtools — Project Plan

**Version:** 0.5.0  
**Date:** 2026-05-08  
**Status:** Pre-development / requirements iteration

---

## Problem

OpenFeature is a CNCF-incubating vendor-neutral standard for feature flags. Teams using it (with LaunchDarkly, Unleash, DevCycle, Flagsmith, etc. as backing providers) currently have no dedicated developer tooling for inspecting flag state at runtime. You either litter your app with `console.log` or context-dive your way through React DevTools manually.

There is no equivalent of Redux DevTools or React Query Devtools for the OpenFeature ecosystem.

### The multi-developer, multi-environment problem

Beyond simple inspection, there is a deeper pain point that local overrides must solve:

**Per-developer isolation.** When a developer wants to test with a flag set to a specific value, the only way to do it today is to change the value in the provider (LaunchDarkly, Unleash, etc.). That change is global — it affects every other developer hitting the same environment. There is no safe, isolated way to test a flag combination without stepping on teammates.

**Multi-environment + microservices complexity.** Real teams run multiple environments: local, dev, staging, prod. Microservices compound this: a developer often runs their target service locally while connecting to the shared "dev" environment for everything else. Flag evaluation rules are frequently tied to service behavior or attributes. When service A runs locally and depends on dev-environment flag rules scoped to service A's characteristics, the developer may be forced to mutate the shared dev flag value to get the behavior they need — again affecting everyone else in the dev environment.

In both cases, the root need is the same: **flag overrides that live in the browser, are invisible to the provider, and have zero effect on other developers or environments.**

---

## Two Products, Not Two Versions

This project produces two distinct tools that serve meaningfully different use cases. They share a panel UI and type definitions but differ in how they get flag state.

| | Component (v0/v1) | Extension (v2) |
|---|---|---|
| **Who** | Developer who owns the codebase | Any developer with the extension installed |
| **Where** | Local dev, CI preview environments | Local, dev, staging, QA, production — any environment |
| **Install required** | Yes — package + one JSX line | No app-side install |
| **Approach** | OpenFeature hooks API | SSE interception |
| **Provider-specific code** | No | Yes |
| **Fragility** | Low | Medium |
| **Spirit** | React Query Devtools, Redux DevTools | React DevTools browser extension |

They are complementary. Neither supersedes the other. The component gives integrated, persistent tooling for developers who own the app. The extension gives zero-install inspector-style access to any environment — including ones you don't control.

---

## Proposed Solution

Ship both tools. Start with the component (fastest path to something useful, no extension scaffolding). Build the extension once the panel logic is proven. Share code between them via a monorepo.

**The component** hooks into OpenFeature's standard hook API — provider-agnostic, clean, low fragility.

**The extension** intercepts the provider's SSE stream directly — provider-specific, but works without any app-side cooperation.

---

## Scope

### v0 — Component: Core Panel

- Display all flags the app has evaluated, with resolved values, types, and evaluation metadata
- Show which provider is active
- Real-time updates via OpenFeature hooks
- Draggable/collapsible panel UI, dev-mode only
- Zero dependencies beyond OpenFeature Web SDK peer dep
- Single npm package

**Out of scope for v0:** overrides, extension, multi-provider display, analytics, flag history

### v1 — Component: Overrides

Local flag overrides, scoped to the developer's browser only. Must:

- Never touch the provider — local to the browser session
- Allow any flag to be forced to any value
- Persist across reloads (localStorage)
- Visually distinguish overridden vs. provider-resolved flags
- Clear individually or all at once

Implementation: hooks observe but cannot mutate return values — overrides require provider wrapping or in-memory provider swap. Primary open architectural question for v1.

### v2 — Extension

Zero-install inspector for any environment:

- Content script monkey-patches `EventSource` before the SDK loads, intercepting the provider's SSE stream
- Detects which provider is active, routes to the appropriate parser
- Parses the event stream into normalized flag state
- Renders the same panel UI from the `devtools` package
- Chrome first; Firefox after

#### SSE interception approach

The extension runs in a content script with access to the page's network layer. By patching `EventSource` before the SDK loads, it can observe the raw flag update stream without needing `window.OpenFeature` to be exposed or any app cooperation at all.

Each provider has a different wire format — LaunchDarkly's SSE payload looks nothing like Unleash's — so the extension maintains a parser per provider:

```
extension/
└── src/
    └── parsers/
        ├── launchdarkly.ts
        ├── unleash.ts
        └── devcycle.ts
```

These formats are undocumented and could change without notice, but in practice they are stable — people have reverse-engineered them before and they don't shift frequently. This is a known maintenance surface, not a weekly burden.

**Target providers for v2:** LaunchDarkly, Unleash, DevCycle (same three as v0).

---

## Technical Approach

### Component (v0): OpenFeature hooks

```ts
useEffect(() => {
  const hook = new DevToolsHook(setState)
  OpenFeature.addHooks(hook)
  return () => OpenFeature.clearHooks()
}, [])
```

Hook intercepts every flag evaluation, pipes into local React state, panel renders from state. No polling, no provider events, no provider-specific code.

### v0 API surface (complete — do not expand until someone asks)

```tsx
<OpenFeatureDevtools />
<OpenFeatureDevtools position="bottom-right" />
<OpenFeatureDevtools defaultOpen={false} />
```

### Extension (v2): SSE interception

```ts
// injected before SDK loads
const OriginalEventSource = window.EventSource
window.EventSource = class extends OriginalEventSource {
  constructor(url: string, init?: EventSourceInit) {
    super(url, init)
    if (isProviderStream(url)) {
      this.addEventListener('message', parseAndForward)
    }
  }
}
```

The extension shell handles: manifest, content scripts, background worker, provider detection, SSE parsing. It imports the panel UI component and flag type definitions from the `devtools` package — the panel is built once and used in both contexts.

---

## Monorepo Structure

pnpm workspaces from day one. The extension imports shared logic from `devtools` — panel UI, flag normalization utilities, type definitions. Not just organization; actual code sharing.

```
openfeature-react-devtools/
├── packages/
│   ├── devtools/               ← npm package: component + hook logic + panel UI
│   │   ├── src/
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── extension/              ← browser extension shell
│       ├── src/
│       │   ├── content/        ← EventSource patch, provider detection
│       │   ├── parsers/        ← per-provider SSE parsers
│       │   └── popup/          ← renders <Panel /> from devtools package
│       ├── manifest.json
│       └── package.json
├── examples/
│   └── demo-app/               ← dogfooding ground, signals project has a testing target
├── plans/
└── requirements/
```

The `extension` package is a shell: browser boilerplate + SSE interception + parser registry. The panel renders from the `devtools` package. Duplication is minimal.

The `examples/demo-app` exists from day one even as a stub — it's a testing ground for dogfooding and signals to contributors that the project has a working reference.

---

## Target Providers

| Provider | Component (v0) | Extension (v2) |
|---|---|---|
| LaunchDarkly | Implicit (hooks API) | SSE parser required |
| Unleash | Implicit (hooks API) | SSE parser required |
| DevCycle | Implicit (hooks API) | SSE parser required |

---

## Sequencing Rationale

**Component before extension:**
- No Manifest v3 boilerplate, no content script sandboxing, no store submission
- Ships to npm fast, demonstrable in a README gif
- Proves hook + panel logic before wrapping it in extension infrastructure
- API surface is validated before it becomes a compatibility constraint

**Extension is not an upgrade to the component** — it is a separate product with a separate value proposition, different technical approach, and different maintenance surface. When it ships, it should be framed that way.

---

## Open Questions

- [ ] Does `OpenFeature.addHooks()` capture evaluations that happen before the component mounts (e.g., during early app init)? If so, do we miss flags evaluated before the hook is registered?
- [ ] Does `OpenFeature.clearHooks()` clear all hooks globally, including any the host app registered independently? If so, we need a scoped remove instead of a full clear.
- [ ] Does OpenFeature Web SDK expose the active provider name/metadata at runtime for the panel header?
- [ ] For v1 overrides: hooks cannot mutate return values — override mechanism TBD (wrapper provider vs. in-memory provider swap).
- [ ] For v2 SSE interception: Manifest v3 restricts content script timing — can we reliably patch `EventSource` before the SDK loads, or do we need a different injection strategy?
- [ ] Is there appetite from OpenFeature maintainers to list this as a community tool? (CNCF sandbox — networking opportunity)
- [ ] Styling approach: CSS modules, inline styles, or zero-style with a headless option?

---

## Context / Origin

Conversation with Claude (2026-05-07–08) covering:
- Initial project ideation; selected over `next-a11y-reporter`, `pnpm-why-graph`, and others
- OpenFeature provider landscape: LaunchDarkly >> Unleash, DevCycle, Flagsmith, Flipt as core ecosystem
- Optimizety/PostHog are experimentation platforms with flag support, not OpenFeature-native
- Panel-before-extension decision made based on DX friction tradeoff
- v0.2.0: real-world multi-developer / multi-environment / microservices context; v1 override feature sharpened to primary value prop
- v0.3.0: v0 uses OpenFeature hooks API, not provider wrapping; component drop-in model confirmed
- v0.4.0: extension reframed as categorically distinct product — different users, environments, install model
- v0.5.0: extension technical approach locked as SSE interception (monkey-patch `EventSource` in content script), not OpenFeature hooks; per-provider SSE parsers documented as known maintenance surface; monorepo structure detailed with explicit code-sharing rationale; `window.OpenFeature` open question closed (SSE interception doesn't depend on it)

---

*Bump the version header and filename when making substantive changes.*
