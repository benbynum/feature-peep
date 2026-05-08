# feature-flag-devtools — Project Plan

**Version:** 0.9.0  
**Date:** 2026-05-08  
**Status:** Active — feasibility spike in progress

---

## Current Focus

**Validate core technical feasibility before building anything real.**

Two unknowns block the entire MVP:

1. Can a Manifest V3 content script patch `window.EventSource` before the LD SDK loads?
2. Can we rewrite the SSE payload (proxy `MessageEvent.data`) before the SDK's handler sees it, enabling transparent overrides?

If both work: proceed with Option 1 (SSE rewriting) as the override mechanism.
If (1) works but (2) doesn't: fall back to SDK method patching — but this breaks for npm-bundled apps.
If (1) doesn't work: we need a page-injected script, which has different Manifest V3 constraints.

The spike is intentionally messy. Project name, structure, and polish are ignored until feasibility is confirmed.

---

## Spike Goals

- [ ] Minimal Chrome extension with a `document_start` content script
- [ ] Patch `window.EventSource` and confirm the patch is visible to the page's JS
- [ ] Open a real LD-connected app; confirm SSE `put` payload is intercepted and logged
- [ ] Proxy the `MessageEvent.data` in `addEventListener` wrapping; confirm the SDK receives the modified payload and the app renders accordingly
- [ ] If any step fails, document why and what the fallback is

Spike lives in `spike/` — throwaway code, no monorepo, no TypeScript, no build step. Plain JS manifest extension loaded unpacked.

---

## Post-Spike

Once feasibility is confirmed, return to the full plan and build for real:
- Proper monorepo structure (`packages/core`, `packages/extension`)
- TypeScript
- Popup UI with flag list and override controls
- localStorage persistence for overrides
- Payload-first LD detection

---

## Everything Else (unchanged from v0.8)

See PLAN-v0.8.md for full context: problem statement, competitive landscape, strategic direction, roadmap, detection strategy, monorepo structure, and open questions.

---

*Bump the version header and filename when making substantive changes.*
