# openfeature-react-devtools — Project Plan

**Version:** 0.3.0  
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

## Proposed Solution

A React component — distributed as an npm package — that renders an in-app developer panel showing live OpenFeature flag state. Installed once in dev mode, zero browser extension, zero store submission.

**Works with any OpenFeature-compatible provider.** The tool hooks into the OpenFeature Web SDK's standard hook API, not any vendor-specific SDK or provider internals. Provider is irrelevant to the tool.

---

## Scope

### v0 — Core Panel (start here)

The smallest useful thing:

- Display all flags the app has evaluated, with their resolved values, types, and evaluation metadata
- Show which provider is active
- Reflect flag evaluations and changes in real time
- Draggable/collapsible panel UI, dev-mode only
- Zero dependencies beyond OpenFeature Web SDK peer dep
- Distributed as a single npm package

**Out of scope for v0:**
- Flag overrides / local mutation
- Browser extension wrapper
- Multi-provider support display
- Analytics or flag history

### v1 — Overrides

This is the primary mechanism for safe, isolated flag testing in team environments. Overrides must:

- Live entirely in the browser (localStorage + in-memory) — never touch the provider
- Allow any flag value to be overridden per-developer without affecting anyone else
- Persist overrides across reloads (localStorage)
- Be instantly clearable (clear all overrides button)
- Visually distinguish overridden flags from provider-resolved flags

Implementation: overrides require a different mechanism than the v0 hook approach (hooks observe but cannot mutate return values). A wrapper provider or in-memory provider swap is needed — this is the open architectural question for v1.

### v2 — Browser Extension

- Wrap the panel logic in a Chrome/Firefox extension
- Extension reads flag state via injected content script
- No app-side install required for end users

---

## Technical Approach

### v0: OpenFeature hooks, not provider wrapping

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

That's it. No separate hook registration, no store config, no provider re-wiring.

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

### Why not provider wrapping?

Provider wrapping (replacing `OpenFeature.setProvider()` with a wrapped version) is more invasive: it requires touching provider initialization code, not just JSX. It also couples the devtools to the provider lifecycle in ways that complicate cleanup and hot-reload behavior. Hooks are the right abstraction for observation; provider wrapping may be necessary for v1 overrides (where you need to mutate return values), but it is explicitly the wrong direction for v0.

### Phase 2: Extension wrapper

Once the panel component is stable, the extension injects it into any app that has the OpenFeature SDK present on `window`.

---

## Target Providers (v0 compatibility)

All three of these have official OpenFeature Web SDK support and represent the bulk of current adoption:

1. **LaunchDarkly** — enterprise incumbent, largest install base
2. **Unleash** — most widely deployed open-source option
3. **DevCycle** — OpenFeature-native, governance board contributor

Compatibility is implicit (we depend on the standard hook API, not any provider), but these three should be explicitly tested and documented.

---

## Rationale: Panel Before Extension

Browser extensions introduce: Manifest v3 boilerplate, cross-browser surface area, extension store submission, content script sandboxing. That's a week of scaffolding before writing feature-flag logic.

A dev-mode React component ships fast, is demonstrable in a README gif, and can be published to npm within days. The extension is a natural v2 once the API surface is proven.

This mirrors the pattern of Redux DevTools and React Query Devtools — both shipped as in-app packages before (or instead of) extensions.

---

## Open Questions

- [ ] Does `OpenFeature.addHooks()` capture evaluations that happen before the component mounts (e.g., during SSR or early app init)? If so, do we miss flags evaluated before the hook is registered?
- [ ] Does `OpenFeature.clearHooks()` clear all hooks globally, including any the host app registered independently? If so, we need a scoped remove instead of a full clear.
- [ ] Does OpenFeature Web SDK expose the active provider name/metadata at runtime for display?
- [ ] Is there appetite from OpenFeature maintainers to list this as a community tool? (CNCF sandbox — networking opportunity)
- [ ] Monorepo structure from day one (core + extension packages) or single package until v2?
- [ ] Styling approach: CSS modules, inline styles, or zero-style with a headless option?
- [ ] For v1 overrides: hooks cannot mutate return values, so overrides require a different mechanism. Options: (a) wrapper provider, (b) swap to in-memory provider seeded with current values + override applied. This is the primary open architectural question for v1.

---

## Repo Structure (proposed)

```
openfeature-react-devtools/
├── README.md
├── plans/                    ← versioned plan iterations
│   ├── PLAN-v0.2.md
│   └── PLAN-v0.3.md
├── requirements/
│   └── REQ-v0.1.md
├── packages/
│   └── devtools/             ← v0 npm package
│       ├── src/
│       ├── package.json
│       └── tsconfig.json
└── examples/
    └── with-launchdarkly/
```

Monorepo (pnpm workspaces) from day one, so the extension package slot exists without a breaking restructure later.

---

## Context / Origin

Conversation with Claude (2026-05-07) covering:
- Initial project ideation; selected over `next-a11y-reporter`, `pnpm-why-graph`, and others
- OpenFeature provider landscape: LaunchDarkly >> Unleash, DevCycle, Flagsmith, Flipt as core ecosystem
- Optimizely/PostHog exist in the space but are experimentation platforms with flag support, not OpenFeature-native
- Panel-before-extension decision made based on DX friction tradeoff
- v0.2.0: added real-world multi-developer / multi-environment / microservices context; v1 override feature sharpened from "nice to have" to "primary value prop"
- v0.3.0: architectural decision locked — v0 uses OpenFeature hooks API for observation, not provider wrapping. Component drop-in model confirmed (React Query Devtools pattern). Provider wrapping explicitly ruled out for v0; remains open question for v1 overrides.

---

*This document is the source of truth for requirements iteration. Bump the version header and filename when making substantive changes.*
