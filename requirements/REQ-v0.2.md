# feature-flag-devtools — MVP Requirements
<!-- template version: 1.1 -->
<!-- scope: Chrome extension, LaunchDarkly only -->

## Problem

<!--
  Write this yourself. Starter draft below.
-->

_TODO: fill in your own words. Starter draft:_

Developers using LaunchDarkly have no browser-native way to inspect live flag state on a running page — in any environment. The only options are the LaunchDarkly dashboard (which shows config, not runtime evaluation), `console.log`, or the network tab. There is no way to see which flags evaluated on this page, with what values, in real time. On environments you don't control — staging, QA, a client's app — there's no option at all short of asking someone to add logging.

---

## End State

| # | What must be true | How you'd verify it |
|---|-------------------|---------------------|
| E1 | A developer can see all LaunchDarkly flags evaluated on the current page without modifying the app | Open extension panel on any LD-connected page; flags appear with keys, values, and types |
| E2 | Flag state updates in real time as the provider pushes changes | Trigger a remote flag change in LD dashboard; panel updates without page reload |
| E3 | The extension works regardless of whether LD traffic goes through a proxy | Test on a page where LD requests go to a custom domain; flags still appear |
| E4 | No changes to the app's codebase are required | Install extension only; open any LD app without touching its source |
| E5 | The extension works on local, dev, and staging environments | Validate on localhost, then push test app to dev and confirm |

---

## Requirements

### Detection

**FR-01 — Payload-based LaunchDarkly detection**
What: The extension identifies a page as using LaunchDarkly by matching the shape of SSE event data, not by URL.
Acceptance: Flags are detected on a page that proxies LD traffic through a non-launchdarkly.com domain. URL alone is never the sole detection mechanism.
Serves: E3, E4

**FR-02 — URL fast-path**
What: If an `EventSource` URL matches `*.launchdarkly.com`, skip payload matching and route directly to the LD parser.
Acceptance: Standard (non-proxied) LD apps are detected immediately on first SSE connection without waiting for message parsing.
Serves: E1

**FR-03 — localStorage corroboration**
What: Presence of `ld:` prefixed keys in localStorage is used as a secondary confirming signal.
Acceptance: Detection confidence is higher when both SSE payload and localStorage signals match. Neither signal alone is a hard requirement.
Serves: E3

### Flag State

**FR-04 — Full flag snapshot on connect**
What: When the LD SSE stream opens, the `put` event delivers the full current flag state. The extension captures and displays all flags immediately.
Acceptance: On page load, all flags appear in the panel within 2 seconds of the SSE connection opening. Count matches what the LD dashboard shows as evaluated for this client.
Serves: E1

**FR-05 — Incremental updates**
What: `patch` events from the SSE stream update individual flag values in the panel without a full reload.
Acceptance: Changing a flag value in the LD dashboard causes the panel to update the affected flag within 2 seconds. Unaffected flags are unchanged.
Serves: E2

**FR-06 — Flag display**
What: Each flag is shown with its key, resolved value, and inferred type (boolean, string, number, object/JSON).
Acceptance: Boolean flags show true/false; string flags show the value quoted; number flags show numeric value; JSON/object flags show a collapsed preview. Type is inferred from the resolved value, not declared separately.
Serves: E1

### Panel UI

**FR-07 — Extension panel**
What: Flag state is accessible via a DevTools panel tab or extension popup. TBD which. _(TODO: decide — DevTools panel requires the DevTools to be open; popup is always one click away but has less space.)_
Acceptance: Developer can view flags without opening the browser DevTools. OR: developer opens DevTools and sees a dedicated "Feature Flags" tab.
Serves: E1

**FR-08 — Empty and loading states**
What: The panel communicates clearly when no LD flags have been detected yet.
Acceptance: Before detection: shows "No LaunchDarkly flags detected on this page." After detection but before `put` event: shows a loading indicator. After `put`: shows flag list.
Serves: E1

### Injection

**FR-09 — EventSource patch fires before SDK**
What: The content script patches `window.EventSource` before the LaunchDarkly SDK initializes, so the SDK's SSE connection is intercepted from the first byte.
Acceptance: Flags are detected on a page where the LD SDK initializes immediately on page load (no lazy init). If `document_start` content scripts cannot reach `window` in Manifest V3, a page-injected script is used instead.
Serves: E1, E4

---

## Constraints

- **No app changes required.** The extension must work on any LaunchDarkly-connected page without the app opting in, enabling debug mode, or exposing any global.
- **Chrome only for MVP.** Firefox deferred.
- **Read-only for MVP.** No flag overrides, no value mutation.
- **No LaunchDarkly API credentials required.** The extension reads the client-side SSE stream only — no server-side API calls, no SDK key exposure.
- **No data leaves the browser.** Flag state is local to the extension. No analytics, no telemetry, no external calls.

---

## Out of Scope

- Flag overrides / value mutation (v2)
- OpenFeature support (v2)
- Any provider other than LaunchDarkly (v3+)
- Firefox (later)
- Evaluation reason / metadata (later)
- Flag evaluation history / timeline (later)
- Multi-provider display (later)
- Drop-in React component (later, different product)

---

## Open Questions

- [ ] **Panel surface:** DevTools panel tab vs. extension popup? DevTools panel has more vertical space and sits alongside the network tab (where SSE streams are visible); popup is always accessible without opening DevTools but is smaller. _(Decide before building UI.)_
- [ ] **Manifest V3 injection timing:** Can a `document_start` content script reliably patch `window.EventSource` before the LD SDK loads, or is a page-injected `<script>` required? This is the primary technical unknown — answer on day one.
- [ ] **LD SDK version compatibility:** Does the SSE `put`/`patch` wire format vary across major versions of the LD JS SDK? Needs verification against SDK changelog.
- [ ] **Payload collision risk:** Could a non-LD SSE stream produce a payload that matches the LD format? Low priority for MVP — acceptable to ship and monitor.
- [ ] **Styling approach:** Inline styles (simplest, no build complexity), CSS modules, or a minimal design system? Decide before building the panel.
