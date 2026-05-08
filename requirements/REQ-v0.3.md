# feature-flag-devtools — MVP Requirements
<!-- template version: 1.1 -->
<!-- scope: Chrome extension, LaunchDarkly, display + local overrides -->

## Problem

<!--
  Write this yourself. Starter draft below.
-->

_TODO: fill in your own words. Starter draft:_

Developers using LaunchDarkly have no way to inspect or locally override live flag state on a running page without changing the provider. To test a flag value, you must change it in the LaunchDarkly dashboard — which affects every other developer hitting the same environment. On staging or QA you may not even have permission to do that. The result: developers either litter code with `console.log`, avoid testing flag branches entirely, or step on teammates' environments to test their own work.

---

## End State

| # | What must be true | How you'd verify it |
|---|-------------------|---------------------|
| E1 | A developer can see all LaunchDarkly flags evaluated on the current page | Open extension panel on any LD-connected page; all evaluated flags appear with keys, values, and types |
| E2 | Flag state updates in real time as the provider pushes changes | Change a flag in LD dashboard; panel updates without page reload |
| E3 | A developer can override any flag value and see the app visually change | Set an override in the panel; the app UI reflects the new value without a page reload or code change |
| E4 | Overrides are local to the developer's browser and invisible to anyone else | Confirm a second browser/device on the same app sees the provider-resolved value, not the override |
| E5 | Overrides survive page reloads | Set an override; hard-refresh; override is still applied and the app still reflects it |
| E6 | The extension works regardless of whether LD traffic goes through a proxy | Test on a page where LD requests go to a non-launchdarkly.com domain; flags still appear and overrides still work |
| E7 | No changes to the app's codebase are required | Install extension only; open any LD app without touching its source, making commits, or adding dependencies |
| E8 | The extension works on local, dev, and staging environments | Validate on localhost then push test app to dev env and confirm |

---

## Requirements

### Detection

**FR-01 — Payload-based LaunchDarkly detection**
What: The extension identifies a page as using LaunchDarkly by matching the shape of SSE event data, not by URL.
Acceptance: Flags are detected on a page that proxies LD traffic through a non-launchdarkly.com domain. URL is never the sole detection mechanism.
Serves: E6, E7

**FR-02 — URL fast-path**
What: If an `EventSource` URL matches `*.launchdarkly.com`, skip payload matching and route directly to the LD parser.
Acceptance: Standard (non-proxied) LD apps are detected immediately without waiting for message parsing.
Serves: E1

**FR-03 — localStorage corroboration**
What: Presence of `ld:` prefixed keys in localStorage is used as a secondary confirming signal.
Acceptance: Detection confidence is higher when both SSE payload and localStorage signals match.
Serves: E6

### Flag State

**FR-04 — Full flag snapshot on connect**
What: The `put` event delivers full current flag state. The extension captures and displays all flags immediately.
Acceptance: All flags appear in the panel within 2 seconds of the SSE connection opening.
Serves: E1

**FR-05 — Incremental updates**
What: `patch` events update individual flag values in the panel in real time.
Acceptance: Changing a flag in the LD dashboard updates the affected flag in the panel within 2 seconds. Unaffected flags are unchanged.
Serves: E2

**FR-06 — Flag display**
What: Each flag shows its key, resolved value (or override value if active), and inferred type (boolean, string, number, object).
Acceptance: Overridden flags are visually distinguished from provider-resolved flags (badge, color, or indicator — TBD). Type is inferred from the value.
Serves: E1, E3

### Overrides

**FR-07 — Local flag override**
What: A developer can set any flag to any value via the panel. The override is applied transparently — the app receives the overridden value from its normal `variation()` call with no knowledge of the extension.
Acceptance: Setting an override causes the app UI to visually reflect the new value. A second browser session on the same app sees the provider-resolved value, not the override.
Serves: E3, E4

**FR-08 — Override persistence**
What: Overrides survive page reloads.
Acceptance: After a hard refresh, all previously set overrides are re-applied before the app's first flag evaluation. The app reflects override values from the start.
Serves: E5

**FR-09 — Override visibility**
What: The panel clearly distinguishes overridden flags from provider-resolved flags.
Acceptance: Overridden flags show a visual indicator. The original provider-resolved value is shown alongside the override. Count of active overrides shown in panel header or similar.
Serves: E3

**FR-10 — Remove overrides**
What: A developer can remove individual overrides or clear all at once.
Acceptance: Removing an override immediately restores the provider-resolved value in the app. "Clear all" removes every override and restores all flags.
Serves: E3, E4

### Injection

**FR-11 — EventSource patch fires before SDK**
What: The content script patches `window.EventSource` before the LaunchDarkly SDK initializes.
Acceptance: Flags are detected on a page where the LD SDK initializes immediately on page load. If Manifest V3 content scripts cannot reach `window` directly, a page-injected script is used instead.
Serves: E1, E7

**FR-12 — Override mechanism is transparent to the app**
What: The app's flag evaluation calls (`variation()` etc.) return override values without any modification to the app.
Acceptance: The app has no console errors, no modified source, and no awareness that values have been patched. Override works on any LD JS SDK version in use.
Serves: E3, E7

### Panel UI

**FR-13 — Panel surface** _(TODO: decide — DevTools panel tab vs. extension popup)_
What: Flag state and override controls are accessible via a dedicated UI surface.
Acceptance: Developer can view flags and set overrides without navigating to the LD dashboard.
Serves: E1, E3

**FR-14 — Empty and loading states**
What: The panel communicates clearly when no LD activity has been detected.
Acceptance: Before detection: "No LaunchDarkly flags detected on this page." After detection, before `put` event: loading indicator. After `put`: flag list with override controls.
Serves: E1

---

## Constraints

- **No app changes required.** Works on any LD-connected page without opt-in, debug mode, or exposed globals.
- **Overrides are browser-local.** Override state never leaves the browser. No provider mutation, no cross-session effect.
- **No LD API credentials required.** Reads the client-side SSE stream only.
- **No data leaves the browser.** No analytics, no telemetry, no external calls.
- **Chrome only for MVP.** Firefox deferred.

---

## Out of Scope

- OpenFeature support (v2)
- Any provider other than LaunchDarkly (v3+)
- Firefox (later)
- Flag evaluation history / timeline (later)
- Evaluation reason / metadata (later)
- Multi-provider display (later)
- Drop-in React component (later, different product)

---

## Open Questions

- [ ] **Panel surface:** DevTools panel tab vs. extension popup? Decide before building UI.
- [ ] **Override mechanism:** SSE response rewriting (inject overrides into `put` payload) vs. SDK method patching (`variation()` monkey-patch)? Both are transparent to the app; decide based on reliability across LD SDK versions.
- [ ] **Manifest V3 injection timing:** `document_start` content script vs. page-injected `<script>`? Answer on day one.
- [ ] **Override input UX:** How does the developer set an override value? Inline edit in the flag list? A modal? For boolean flags a toggle makes sense; for string/number/object a text input is needed.
- [ ] **Override persistence scope:** localStorage per origin (simplest and most useful) or per tab?
- [ ] **Styling approach:** Inline styles vs. CSS modules?
