# openfeature-react-devtools
<!-- template version: 1.1 -->

## Problem

<!--
  Who has what pain, and why does solving it matter now?
  Write this yourself, without help. If you can't, the project isn't ready to spec.
-->

_TODO: fill in your own words. Starter draft:_

Developers using OpenFeature have no runtime tooling for inspecting flag state. The only options are `console.log` or manually navigating React DevTools. Worse, there is no safe way to test a flag value locally without changing it in the provider — which affects every other developer hitting the same environment. In multi-service teams, this compounds: running a service locally against a shared dev environment can force mutations to shared flag rules just to get a specific evaluation behavior.

---

## End State

<!--
  What must be true after this ships? Not features — observable outcomes.
  If you can't describe how you'd verify it, it's too vague.
-->

### v0 — Core Panel

| # | What must be true | How you'd verify it |
|---|-------------------|---------------------|
| E1 | A developer can see all currently resolved flags and their values without leaving the app | Open the panel; all flags the app has evaluated are listed with name, type, and value |
| E2 | The panel reflects flag changes without a page reload | Trigger a remote flag change; panel updates within 1–2 seconds |
| E3 | The tool works with any OpenFeature-compatible provider and requires no provider-specific code | Install with LaunchDarkly, Unleash, and DevCycle; panel works identically for all three |
| E4 | Adding the tool to an app is a single JSX line and nothing else | Follow the README; count the lines of setup code required |
| E5 | The panel has no presence in a production build | Build with NODE_ENV=production; verify no panel renders and bundle size is unaffected |

### v1 — Overrides

| # | What must be true | How you'd verify it |
|---|-------------------|---------------------|
| E6 | A developer can force any flag to any value without affecting any other developer's session | Set an override locally; confirm a second browser/device still sees the provider-resolved value |
| E7 | Overrides survive page reloads | Set an override; hard-refresh; override is still applied |
| E8 | A developer can tell at a glance which flags are overridden vs. provider-resolved | Open the panel; overridden flags are visually distinct from resolved ones |

---

## Requirements

<!--
  FR-## — Name
  What: [capability in plain language]
  Acceptance: [specific, testable conditions — including failure cases]
  Serves: [E#]
-->

### v0 — Core Panel

**FR-01 — Flag listing**
What: The panel displays all flags the app has evaluated, with name, resolved value, and type (boolean, string, number, object).
Acceptance: Every flag evaluation that goes through the OpenFeature client appears in the panel. Flags evaluated after mount appear without a refresh. Unknown or error-state flags are shown with their reason.
Serves: E1

**FR-02 — Real-time updates**
What: The panel reacts to provider configuration change events without a page reload.
Acceptance: When the backing provider emits `PROVIDER_CONFIGURATION_CHANGED`, affected flag values update in the panel within 2 seconds. No manual refresh required.
Serves: E2

**FR-03 — Provider identity**
What: The panel shows the name of the currently active provider.
Acceptance: Displayed name matches `OpenFeature.getProviderMetadata().name`. Updates if the provider is swapped at runtime.
Serves: E1, E3

**FR-04 — Provider agnosticism**
What: The panel integrates via `@openfeature/web-sdk` APIs only — no provider-specific imports or assumptions.
Acceptance: Verified working against LaunchDarkly, Unleash, and DevCycle. No provider SDK is a direct or indirect dependency.
Serves: E3

**FR-05 — Single-line install**
What: Adding the panel to an app requires adding one JSX element and one import.
Acceptance: The README setup section fits in under 10 lines including the import. No provider re-wiring, no context providers, no config objects required for v0.
Serves: E4

**FR-06 — Production exclusion**
What: The panel is excluded from production builds with no manual tree-shaking required.
Acceptance: When `NODE_ENV === 'production'`, the component renders null. The production bundle contains no panel code. Verified via bundle analysis.
Serves: E5

**FR-07 — Panel UX**
What: The panel is draggable, collapsible, and unobtrusive.
Acceptance: Can be repositioned anywhere on screen via drag. Can be collapsed to a small toggle. Collapsed/expanded state persists across page reloads (localStorage). Does not block app interaction when collapsed.
Serves: E1, E4

---

### v1 — Overrides

**FR-08 — Local flag override**
What: A developer can set any flag to any value via the panel. The override is local to their browser only.
Acceptance: Override takes effect immediately after setting. A second browser session on the same app sees the provider-resolved value, not the override. Override survives hard refresh.
Serves: E6, E7

**FR-09 — Override persistence**
What: Overrides are stored in localStorage and restored on load.
Acceptance: After a hard refresh, all previously set overrides are re-applied before the first flag evaluation completes. Overrides scoped to the origin (not shared across different apps on different domains).
Serves: E7

**FR-10 — Override visibility**
What: The panel visually distinguishes overridden flags from provider-resolved flags.
Acceptance: Overridden flags show a clear indicator (badge, color, icon — TBD). Count of active overrides shown in the panel header. Overridden value and original provider-resolved value both visible.
Serves: E8

**FR-11 — Clear overrides**
What: Developer can remove all overrides in one action.
Acceptance: "Clear all" removes every override from localStorage and immediately restores provider-resolved values for all flags. Individual override removal also supported.
Serves: E6, E8

---

## Constraints

<!--
  Hard limits that are non-negotiable regardless of implementation approach.
-->

- **Zero production footprint.** No panel code, styles, or logic in production bundles. Enforced at the component level, not just by caller convention.
- **No extra peer dependencies.** `@openfeature/web-sdk` (and optionally `@openfeature/react-sdk`) are the only peer deps. No UI library, no state management library.
- **Local-only overrides.** Override state must never leave the browser. No server calls, no shared state, no cross-tab synchronization.
- **No mutation of global provider state.** The tool must not affect flag evaluation for any session other than the one it's running in.

---

## Out of Scope

<!--
  Explicitly deferred — not forgotten.
-->

- Browser extension (v2)
- Multi-provider display (multiple active providers)
- Flag evaluation history / timeline
- Flag analytics or usage metrics
- Non-web targets (React Native, SSR, Node)
- Flag creation or remote value mutation (this tool is read + local-override only)
- Auth/permissions gating on the panel itself

---

## Open Questions

<!--
  Every unresolved decision lives here.
  Resolved questions get a one-line answer appended and stay as a record.
-->

- **Flag enumeration**: Does `@openfeature/web-sdk` expose an API to list all registered flags, or only flags that have already been evaluated? If evaluation-only, do we need a supplemental registry pattern?
- **v1 provider API**: Should `<OpenFeatureDevTools provider={...} />` own provider registration (wraps + registers internally), or does the developer wrap the provider manually before passing to `OpenFeature.setProvider()`? Former is lower friction; latter is more explicit.
- **Runtime provider re-registration**: Can the Web SDK accept a new provider registration at component mount time without breaking existing clients or causing double-evaluation?
- **Styling approach**: CSS modules, inline styles, or zero-style with a headless API? Inline styles ship easiest; headless is most flexible but more work.
- **Monorepo from day one?** Single package until v2 extension, or pnpm workspaces now to avoid a restructure later?
- **OpenFeature community listing**: Is there appetite from OpenFeature maintainers to list this as a community tool?
