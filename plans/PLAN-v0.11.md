# feature-flag-devtools — Project Plan

**Version:** 0.11.0  
**Date:** 2026-05-08  
**Status:** Active — MVP extension built, pending local validation

---

## Status

MVP extension is built and ready to load unpacked. Feasibility confirmed via spike (see v0.10). Building for real is done; next step is validation against a real LD app locally and then in a dev environment.

---

## MVP Extension — What Was Built

Six files, no build step, plain JS:

```
extension/
├── manifest.json   ← MV3, popup + content script + service worker
├── inject.js       ← page world: patches EventSource, applies overrides, fires fake puts
├── content.js      ← bridge: inject.js ↔ background
├── background.js   ← state per tab, relay to popup, persist overrides to chrome.storage.local
├── popup.html      ← UI structure
├── popup.js        ← flag list, override controls, live updates
└── popup.css       ← clean light theme, monospace values, override indicators
```

**Core flow:**
- `inject.js` patches `window.EventSource`, wraps `addEventListener` on each instance
- LD `put` event: captured, SDK listeners stored, overrides applied, proxied event delivered to SDK
- Override set: popup → background → content.js → inject.js → `fireFakePut()` calls stored SDK listeners directly with modified payload → app re-renders immediately
- Override persisted to `chrome.storage.local` (survives page reload)
- Popup: flag list sorted A–Z, click to expand override editor, boolean toggle, string/number/JSON text input, restore to provider value, clear all

**Known gaps / best-effort:**
- `patch` event format not confirmed from live observation — handler covers two known formats but may need adjustment
- Service worker termination (MV3): if background is idle and terminated, tab state is lost until next SSE event
- Overrides are per-origin (chrome.storage.local scoped to extension, not to specific origin — may need revisiting if user has multiple LD apps open)

---

## Validation Plan

1. Load `extension/` unpacked in Chrome (developer mode → Load unpacked)
2. Open LD-connected app locally
3. Confirm flags appear in popup
4. Set a boolean override → confirm app visually changes
5. Reload page → confirm override persists
6. Clear override → confirm app returns to provider value
7. Push app to dev environment → confirm extension works there too

---

## Post-MVP Feature: Flag Filtering

When an app has many flags (50–100+), an unfiltered list is unwieldy. Post-MVP: allow the user to pin/filter which flags they care about on a given page or app.

Options to explore:
- Search/filter input in the popup header (filter by key substring)
- Pin flags to top of list (persisted per origin)
- Hide flags with no override and no recent change (focus mode)
- Tag/group flags by prefix (common LD convention: `feature-`, `exp-`, `kill-switch-`)

This does not affect the MVP. Note as a known UX limitation when the flag count is high.

---

## Everything Else (unchanged from v0.10)

Problem, competitive landscape, strategic direction, roadmap, detection strategy, open questions — see PLAN-v0.10.md.

---

*Bump the version header and filename when making substantive changes.*
