# FeatureCreep — Project Plan

**Version:** 0.15.0
**Date:** 2026-05-13
**Status:** Active — onboarding, rename, settings, storage cleanup

---

## Scope

Four tracks in priority order:

1. **Onboarding / Demo mode** — shipped in v0.15
2. **Rename to FeaturePeep** — domain purchased, branding update
3. **Settings page** — surface user-facing controls
4. **Storage cleanup** — consolidate `localStorage` → `chrome.storage.local`

---

## Track 1: Onboarding / Demo Mode ✓ SHIPPED

When no flags are detected, the popup now shows interactive sample flags so users can immediately explore the UI. A link to a live demo site (TBD) lets them see real detection in action. On by default; permanently dismissible.

### What shipped

**New file: `src/popup/demoFlags.ts`**
- `DEMO_PROVIDER_ID = 'launchdarkly'` — uses inline SVG badge, no external asset dependency
- `DEMO_SITE_URL = 'https://demo.featurecreep.dev'` — placeholder, update when deployed
- `DEMO_FLAGS` — four sample flags covering all value types: boolean, string, number, JSON

**`src/constants.ts`**
- Added `STORAGE_DEMO_DISABLED = 'fc:onboarding:demoDisabled'`

**`src/popup/index.ts`**
- `demoDisabled`, `demoOverrides`, `isDemoMode` state
- `applyOverride(key, value)` / `clearOverride(key)` helpers — route to in-memory `demoOverrides` in demo mode; send real `MSG_SET_OVERRIDE` otherwise
- Demo branch in `render()`: rebinds `flags`/`overrides` to demo data when `isDemoMode`
- Provider badge shows "Demo — no flags detected on this page" title in demo mode
- `#demo-banner` shown/hidden based on `isDemoMode`; `demo-site-link` href set programmatically
- Parallel async init: `chrome.storage.local.get(STORAGE_DEMO_DISABLED)` and `MSG_GET_FLAGS` fire concurrently; render after both resolve
- Dismiss button sets `STORAGE_DEMO_DISABLED = true` in `chrome.storage.local`

**`extension/popup.html`** — `#demo-banner` div added inside `#state-flags` before `#search-bar`

**`extension/popup.css`** — amber callout styles for demo banner

### Behaviour
- First open, no flags → popup expands to 560px, LD badge, amber banner, four interactive sample flags
- Toggle/override a demo flag → updates `demoOverrides` in memory only; no messages sent to background
- Dismiss → `fc:onboarding:demoDisabled = true` persisted; shows plain empty state forever
- Real flags detected → `MSG_FLAGS_UPDATE` received; next `render()` exits demo mode automatically

### Pending
- Deploy demo site and update `DEMO_SITE_URL` in `src/popup/demoFlags.ts`
- When per-provider demo sites ship: change `DEMO_SITE_URL` to `Record<ProviderId, string>`; update the one callsite in `render()`

---

## Track 2: Rename to FeaturePeep

Domain purchased. User-facing rename only — internal `fc:` storage prefixes must NOT change (changing them would invalidate all existing users' stored overrides).

### Changes required

| File | Change |
|---|---|
| `extension/manifest.json` | `name`, `short_name`, `description` fields |
| `extension/popup.html` | `<title>` tag, header `<span class="title">` text |
| `README.md` | All occurrences of "FeatureCreep" / "Feature Creep" |
| `package.json` | `name` field |
| `src/popup/demoFlags.ts` | `DEMO_SITE_URL` — update to new domain once deployed |
| Chrome Web Store listing | Manual — name, description, store URL |
| GitHub repo name | Optional — coordinate with any existing links |

### What NOT to change
- `fc:` storage key prefixes — changing these silently drops all existing user overrides
- `SOURCE_INJECT = 'fc-inject'`, `SOURCE_CONTENT = 'fc-content'` — internal messaging constants
- Directory name `feature-creep/` — cosmetic, low priority

---

## Track 3: Settings Page

Surface controls that currently require DevTools to access.

### Motivation
- Re-enabling demo mode after dismissal requires: DevTools → Application → Storage → `chrome.storage.local` → delete `fc:onboarding:demoDisabled`
- More user-facing knobs will accumulate over time (per-provider toggles, self-hosted URLs)

### Proposed controls (v1)
- **Demo mode** — toggle re-enable (writes/clears `STORAGE_DEMO_DISABLED`)
- Future: per-provider detection toggles
- Future: self-hosted PostHog URL (see PLAN-v0.13 out-of-scope item)
- Future: storage inspector — view/clear overrides by origin

### Implementation options

| Option | Tradeoff |
|---|---|
| Gear icon → slide-down panel inside popup | Lowest friction; good for ≤5 toggles |
| `options_ui` in manifest (opens inline in chrome://extensions) | Standard Chrome pattern; separate page context |
| `options_page` (opens in new tab) | Most space; awkward for simple toggles |

**Recommendation:** Gear icon panel inside the popup for v1. Promote to `options_page` if the list grows beyond ~5 items.

### Files affected (estimated)
- `extension/manifest.json` — add `options_ui` or nothing (if popup-embedded)
- `extension/popup.html` — gear icon button in header, settings panel div
- `extension/popup.css` — settings panel styles
- `src/popup/index.ts` — settings panel toggle, demo re-enable handler

---

## Track 4: Storage Cleanup — `localStorage` → `chrome.storage.local`

### Current state

| What | API | Key |
|---|---|---|
| Flag overrides | `chrome.storage.local` | `fc:overrides:{origin}` |
| Demo disabled | `chrome.storage.local` | `fc:onboarding:demoDisabled` |
| Search bar open | `localStorage` | `fc:searchOpen:{origin}` |
| Search query | `localStorage` | `fc:searchQuery:{origin}` |

### Problem
`localStorage` in extension pages can be cleared by browser "Clear browsing data" (clears cookies and site data) depending on Chrome version. `chrome.storage.local` is explicitly exempt. The split also creates a confusing two-API model for what is conceptually the same persistent UI state.

### Why `localStorage` was used originally
Synchronous reads — search state was read synchronously at popup init before any async work. This is no longer a constraint: the parallel async init pattern added in v0.15 already gates render on a `chrome.storage.local.get` call. Adding search state to the same call costs nothing.

### Implementation

Batch all three settings into one `chrome.storage.local.get`:

```ts
chrome.storage.local.get(
  [STORAGE_DEMO_DISABLED, searchStateKey, searchQueryKey],
  (result) => {
    demoDisabled = result[STORAGE_DEMO_DISABLED] === true
    searchOpen   = result[searchStateKey] === true
    searchQuery  = result[searchQueryKey] || ''
    storageReady = true
    maybeRender()
  }
)
```

Update writes in `applySearchOpen()` and search input/clear listeners:
- `localStorage.setItem(k, v)` → `chrome.storage.local.set({ [k]: v })`
- `localStorage.removeItem(k)` → `chrome.storage.local.remove(k)`
- `localStorage.getItem(k)` → removed (reads now happen only in the batched init)

**Scope:** ~10 call sites in `src/popup/index.ts`. No background or content changes.

**Migration:** Old `localStorage` keys silently abandoned — search state resets once on upgrade, which is acceptable.

---

## Files Affected Summary

| File | Track | Change |
|---|---|---|
| `src/popup/demoFlags.ts` | 1 | new file (shipped) |
| `src/constants.ts` | 1 | `STORAGE_DEMO_DISABLED` (shipped) |
| `src/popup/index.ts` | 1, 4 | demo mode (shipped); storage migration |
| `extension/popup.html` | 1, 3 | demo banner (shipped); settings panel |
| `extension/popup.css` | 1, 3 | demo styles (shipped); settings styles |
| `extension/manifest.json` | 2, 3 | rename; optional options_ui |
| `README.md` | 2 | rename |
| `package.json` | 2 | rename |

---

## Open Questions

- Demo site URL — what domain/path for `DEMO_SITE_URL`?
- Settings page: popup-embedded panel vs `options_ui`?

---

## Out of Scope

- PostHog self-hosted detection (probabilistic; deferred pending options page)
- PostHog SSE (PostHog does not push flag changes)
- Additional providers beyond LaunchDarkly, OpenFeature, PostHog
- Firefox

---

*Bump version and filename on substantive changes.*
