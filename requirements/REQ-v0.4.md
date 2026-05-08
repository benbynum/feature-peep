# feature-flag-devtools — Feasibility Spike Requirements
<!-- scope: spike only — throwaway code to validate technical approach -->

## Goal

Validate two technical unknowns before building anything real. If either fails, we need to know why and what the fallback is before committing to an architecture.

---

## Spike End State

| # | What must be true | How you'd verify it |
|---|-------------------|---------------------|
| S1 | A Manifest V3 content script can patch `window.EventSource` before the LD SDK initializes | Log `'patched'` from the content script; confirm the LD SDK's SSE connection goes through the patched class |
| S2 | The SSE `put` payload is interceptable and readable | Log the raw `put` event data from the patched EventSource; confirm it contains the expected LD flag structure |
| S3 | The `MessageEvent.data` can be proxied before the SDK's handler sees it | Modify one flag value in the proxied payload; confirm the app renders as if that flag were set to the modified value |

S3 is the critical one. S1 and S2 are prerequisites.

---

## Spike Constraints

- Plain JavaScript — no TypeScript, no build step, no bundler
- Single flat directory — no monorepo, no packages
- Load unpacked in Chrome developer mode
- Validate against a real LD-connected app (user's existing app)
- Throwaway — none of this code ships

---

## Spike Structure

```
spike/
├── manifest.json
├── inject.js      ← page-world script (patches window.EventSource)
├── content.js     ← content script (injects inject.js into page)
└── test.html      ← optional local test page if needed
```

Note: Manifest V3 content scripts run in an isolated world and cannot directly access `window` of the page. The likely solution is `content.js` injecting `inject.js` as a `<script>` tag into the page DOM — this runs in the page world and can patch `window.EventSource`. This itself is something to confirm.

---

## Spike Non-Goals

Everything in REQ-v0.3 that isn't S1–S3: UI, persistence, popup, detection strategy, Firefox, TypeScript, monorepo, polish.

---

## Fallback Decision Tree

If S1 fails (can't reach `window.EventSource` from content script):
→ Use `<script>` tag injection from content script into page DOM. Confirm this works in Manifest V3 with `"world": "MAIN"` or script injection.

If S2 fails (payload not interceptable):
→ Investigate whether LD SDK uses `onmessage` property instead of `addEventListener`. Adjust accordingly.

If S3 fails (can't proxy `MessageEvent.data`):
→ Fall back to SDK method patching (`LDClient.variation()` monkey-patch). Document that this breaks for npm-bundled apps where `LDClient` isn't a global.
→ If both fail: reconsider architecture entirely before proceeding.
