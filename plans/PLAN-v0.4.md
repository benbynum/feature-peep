# openfeature-react-devtools — Project Plan

**Version:** 0.4.0  
**Date:** 2026-05-07  
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

This project will eventually produce two distinct tools that serve meaningfully different use cases. They share underlying logic but are not the same product at different stages of maturity.

### Component — for developers building the app

| | |
|---|---|
| **Who** | Developer who owns the codebase |
| **Where** | Local dev, CI preview environments |
| **Install** | Add package, drop in one JSX line |
| **Access** | Opt-in, committed to the repo |
| **Spirit** | React Query Devtools, Redux DevTools |

The component works because the developer controls the codebase, is willing to install a package, and is running in dev mode. It's integrated, persistent, and lives alongside the app.

### Extension — for developers debugging any environment

| | |
|---|---|
| **Who** | Any developer with the extension installed |
| **Where** | Local, dev, staging, QA, production — any environment |
| **Install** | None on the app side. Install extension once in browser. |
| **Access** | Works on any page where OpenFeature is present |
| **Spirit** | React DevTools browser extension |

The extension detects `window.OpenFeature` (or whatever the SDK exposes globally), injects its hook, and reads flag state — without touching the codebase at all. It works on your app, a colleague's app, a client's app you're debugging, a staging environment you don't own.

This is categorically different from the component. You don't install React DevTools into your app — you have it in your browser and it works wherever React is running. Same model here.

**The extension unlocks environments the component can never reach**: staging, QA, production — places where you can't or won't add a dev dependency. It also requires zero buy-in from whoever built the app.

---

## Proposed Solution

Ship both tools. Start with the component (fastest path to something useful, zero extension scaffolding), then build the extension once the hook/inspection logic is proven.

**Works with any OpenFeature-compatible provider.** Both tools hook into the OpenFeature Web SDK's standard hook API, not any vendor-specific SDK or provider internals. Provider is irrelevant.

---

## Scope

### v0 — Component (start here)

The smallest useful thing, for developers who own the codebase:

- Display all flags the app has evaluated, with their resolved values, types, and evaluation metadata
- Show which provider is active
- Reflect flag evaluations and changes in real time
- Draggable/collapsible panel UI, dev-mode only
- Zero dependencies beyond OpenFeature Web SDK peer dep
- Distributed as a single npm package

**Out of scope for v0:**
- Flag overrides / local mutation
- Browser extension
- Multi-provider support display
- Analytics or flag history

### v1 — Overrides (component)

The primary mechanism for safe, isolated flag testing in team environments. Overrides must:

- Live entirely in the browser (localStorage + in-memory) — never touch the provider
- Allow any flag value to be overridden per-developer without affecting anyone else
- Persist overrides across reloads (localStorage)
- Be instantly clearable (clear all overrides button)
- Visually distinguish overridden flags from provider-resolved flags

Implementation: overrides require a different mechanism than the v0 hook approach — hooks observe but cannot mutate return values. A wrapper provider or in-memory provider swap is needed. This is the primary open architectural question for v1.

### v2 — Extension

For developers debugging any environment without touching the codebase:

- Detects `window.OpenFeature` on page load, injects a hook, reads flag state
- Renders the same panel UI in a browser extension popup or side panel
- No app-side install required
- Works on local, dev, staging, QA, production
- Chrome first; Firefox after

The hook and panel logic from v0 are reused. The extension is a new delivery mechanism, not new feature-flag logic.

---

## Technical Approach

### v0: OpenFeature hooks, component drop-in

The component mounts, registers an OpenFeature hook internally, and cleans up on unmount. All SDK wiring is hidden inside the component — the user sees none of it.

```ts
useEffect(() => {
  const hook = new DevToolsHook(setState)
  OpenFeature.addHooks(hook)
  return () => OpenFeature.clearHooks() // cleanup
}, [])
```

The hook intercepts every flag evaluation, pipes it into local React state, and the panel renders from that state. Real-time: no polling, no provider events to subscribe to manually.

This is the **React Query Devtools model exactly** — users already know it. The component is the entire install surface.

### v0 API surface (complete — do not expand until someone asks)

```tsx
<OpenFeatureDevtools />                         // defaults
<OpenFeatureDevtools position="bottom-right" /> // optional
<OpenFeatureDevtools defaultOpen={false} />     // optional
```

No separate hook registration, no store config, no provider re-wiring.

### Usage

```tsx
// main.tsx or _app.tsx
import { OpenFeatureDevtools } from 'openfeature-react-devtools';

function App() {
  return (
    <>
      <YourApp />
      {process.env.NODE_ENV === 'development' && <OpenFeatureDevtools />}
    </>
  );
}
```

One line. Familiar pattern. Done.

### Why not provider wrapping for v0?

Provider wrapping (replacing `OpenFeature.setProvider()` with a wrapped version) requires touching provider initialization code, not just JSX. It also couples the devtools to the provider lifecycle in ways that complicate cleanup and hot-reload behavior. Hooks are the right abstraction for observation. Provider wrapping may be necessary for v1 overrides (where you need to mutate return values), but it is the wrong direction for v0.

### v2: Extension hook injection

The extension content script detects `window.OpenFeature`, calls `OpenFeature.addHooks()` with the same `DevToolsHook` from v0, and renders the panel in an extension side panel or popup. The core inspection logic is identical — only the delivery changes.

---

## Target Providers (v0 compatibility)

1. **LaunchDarkly** — enterprise incumbent, largest install base
2. **Unleash** — most widely deployed open-source option
3. **DevCycle** — OpenFeature-native, governance board contributor

Compatibility is implicit (we depend on the standard hook API), but these three should be explicitly tested and documented.

---

## Sequencing Rationale

**Component before extension** because:
- Zero extension scaffolding (no Manifest v3, no content script sandboxing, no store submission)
- Ships fast, demonstrable in a README gif, publishable to npm within days
- Proves the hook + panel logic before wrapping it in extension infrastructure
- Validates API surface before it becomes a compatibility constraint

**Extension is not just v2 of the component** — it is a separate product with a separate value proposition. When it ships, it should be framed that way, not as an upgrade.

---

## Open Questions

- [ ] Does `OpenFeature.addHooks()` capture evaluations that happen before the component mounts (e.g., during early app init)? If so, do we miss flags evaluated before the hook is registered?
- [ ] Does `OpenFeature.clearHooks()` clear all hooks globally, including any the host app registered independently? If so, we need a scoped remove instead of a full clear.
- [ ] Does OpenFeature Web SDK expose the active provider name/metadata at runtime for display in the panel?
- [ ] For v1 overrides: hooks cannot mutate return values. Options: (a) wrapper provider that checks localStorage overrides first, then delegates to real provider; (b) swap to in-memory provider seeded with current values + override applied. Primary open architectural question for v1.
- [ ] For v2 extension: does the OpenFeature Web SDK expose itself on `window` by default, or does the app need to opt in? If opt-in, extension reach is limited.
- [ ] Is there appetite from OpenFeature maintainers to list this as a community tool? (CNCF sandbox — networking opportunity)
- [ ] Monorepo structure from day one (core + extension packages) or single package until v2?
- [ ] Styling approach: CSS modules, inline styles, or zero-style with a headless option?

---

## Repo Structure (proposed)

```
openfeature-react-devtools/
├── README.md
├── plans/                    ← versioned plan iterations
│   ├── PLAN-v0.2.md
│   ├── PLAN-v0.3.md
│   └── PLAN-v0.4.md
├── requirements/
│   └── REQ-v0.1.md
├── packages/
│   ├── devtools/             ← v0/v1 npm package (component)
│   │   ├── src/
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── extension/            ← v2 browser extension (slot exists, not yet built)
└── examples/
    └── with-launchdarkly/
```

Monorepo (pnpm workspaces) from day one so the extension slot exists without a breaking restructure later.

---

## Context / Origin

Conversation with Claude (2026-05-07) covering:
- Initial project ideation; selected over `next-a11y-reporter`, `pnpm-why-graph`, and others
- OpenFeature provider landscape: LaunchDarkly >> Unleash, DevCycle, Flagsmith, Flipt as core ecosystem
- Optimizety/PostHog exist in the space but are experimentation platforms with flag support, not OpenFeature-native
- Panel-before-extension decision made based on DX friction tradeoff
- v0.2.0: added real-world multi-developer / multi-environment / microservices context; v1 override feature sharpened from "nice to have" to "primary value prop"
- v0.3.0: architectural decision locked — v0 uses OpenFeature hooks API for observation, not provider wrapping. Component drop-in model confirmed (React Query Devtools pattern). Provider wrapping explicitly ruled out for v0.
- v0.4.0: reframed extension as a categorically different product, not just a v2 upgrade. Component and extension serve different users, different environments, different install models. Extension is the React DevTools browser extension analogue — zero app-side install, works anywhere OpenFeature is present including staging and production.

---

*This document is the source of truth for requirements iteration. Bump the version header and filename when making substantive changes.*
