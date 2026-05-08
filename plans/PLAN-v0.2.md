# openfeature-react-devtools — Project Plan

**Version:** 0.2.0  
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

**Works with any OpenFeature-compatible provider.** The tool hooks into the OpenFeature Web SDK's standard API, not any vendor-specific SDK. Provider is irrelevant to the tool.

---

## Scope

### v0 — Core Panel (start here)

The smallest useful thing:

- Display all currently registered flags and their resolved values
- Show flag type (boolean, string, number, object)
- Show which provider is active
- Reflect flag state changes in real time (subscribe to OpenFeature provider events)
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

Implementation: use OpenFeature's in-memory provider layered on top of the real provider, or a custom override hook, so the SDK itself resolves the overridden value rather than the app needing to know about overrides.

### v2 — Browser Extension

- Wrap the panel logic in a Chrome/Firefox extension
- Extension reads flag state via injected content script
- No app-side install required for end users

---

## Technical Approach

### Phase 1: npm package, dev-mode panel

The panel is a React component that calls `OpenFeature.getClient()` and reads flag state directly from the SDK. OpenFeature Web SDK exposes provider events (`PROVIDER_READY`, `PROVIDER_CONFIGURATION_CHANGED`) that we subscribe to for live updates.

```
@openfeature/react-sdk       ← peer dependency
openfeature-react-devtools   ← this package
```

Usage target:

```tsx
// main.tsx or _app.tsx
import { OpenFeatureDevTools } from 'openfeature-react-devtools';

function App() {
  return (
    <>
      <YourApp />
      {process.env.NODE_ENV === 'development' && <OpenFeatureDevTools />}
    </>
  );
}
```

### Phase 2: Extension wrapper

Once the panel component is stable, the extension injects it into any app that has the OpenFeature SDK present on `window`.

---

## Target Providers (v0 compatibility)

All three of these have official OpenFeature Web SDK support and represent the bulk of current adoption:

1. **LaunchDarkly** — enterprise incumbent, largest install base
2. **Unleash** — most widely deployed open-source option
3. **DevCycle** — OpenFeature-native, governance board contributor

Compatibility is implicit (we depend on the standard SDK, not any provider), but these three should be explicitly tested and documented.

---

## Rationale: Panel Before Extension

Browser extensions introduce: Manifest v3 boilerplate, cross-browser surface area, extension store submission, content script sandboxing. That's a week of scaffolding before writing feature-flag logic.

A dev-mode React component ships fast, is demonstrable in a README gif, and can be published to npm within days. The extension is a natural v2 once the API surface is proven.

This mirrors the pattern of Redux DevTools and React Query Devtools — both shipped as in-app packages before (or instead of) extensions.

---

## Open Questions

- [ ] Does OpenFeature Web SDK expose enough to enumerate all registered flags, or do we need a supplemental registry pattern?
- [ ] Is there appetite from OpenFeature maintainers to list this as a community tool? (CNCF sandbox — networking opportunity)
- [ ] Monorepo structure from day one (core + extension packages) or single package until v2?
- [ ] Styling approach: CSS modules, inline styles, or zero-style with a headless option?
- [ ] For v1 overrides: implementation approach is a wrapper provider (checks localStorage overrides first, delegates to real provider for everything else). Key API design question: should the developer manually wrap their provider, or should `<OpenFeatureDevTools provider={...} />` accept the provider as a prop and handle wrapping + registration internally? The latter keeps adoption at "one JSX change" but makes the component own provider registration. Decision has real implications for DX and adoption.

---

## Repo Structure (proposed)

```
openfeature-react-devtools/
├── README.md
├── plans/                    ← versioned plan iterations
│   └── PLAN-v0.2.md
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
- v0.2.0: added real-world multi-developer / multi-environment / microservices context; this sharpens the v1 override feature from "nice to have" to "primary value prop"

---

*This document is the source of truth for requirements iteration. Bump the version header and filename when making substantive changes.*
