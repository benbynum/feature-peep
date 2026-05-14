# FeaturePeep — Project Plan

**Version:** 0.16.0
**Date:** 2026-05-14
**Status:** Active — settings, storage cleanup, icon/logo, UI polish

---

## Scope

Five tracks in priority order:

1. **Settings page** — surface user-facing controls
2. **Storage cleanup** — consolidate `localStorage` → `chrome.storage.local`
3. **Icon / Logo** — replace placeholder icons
4. **UI polish** — color scheme and visual refresh (post-MVP)
5. **Multiple providers** — detect and display more than one provider per page (post-MVP)

Tracks 1–2 are carry-forwards from v0.15. Tracks 3–5 are new.

---

## Previously Shipped

| Track | Version | Status |
|---|---|---|
| Onboarding / Demo mode | v0.15 | ✓ Shipped |
| Rename to FeaturePeep | v0.16 | ✓ Shipped |

**Rename notes:** Internal `fc:` storage key prefixes were intentionally left unchanged — altering them would silently drop all existing users' stored overrides. `SOURCE_INJECT = 'fc-inject'` and `SOURCE_CONTENT = 'fc-content'` messaging constants also unchanged.

---

## Track 1: Settings Page

Surface controls that currently require DevTools to access.

### Motivation
- Re-enabling demo mode after dismissal requires: DevTools → Application → Storage → `chrome.storage.local` → delete `fc:onboarding:demoDisabled`
- More user-facing knobs will accumulate over time (per-provider toggles, self-hosted URLs)

### Proposed controls (v1)
- **Demo mode** — toggle re-enable (writes/clears `STORAGE_DEMO_DISABLED`)
- Future: per-provider detection toggles
- Future: self-hosted PostHog URL (deferred from PLAN-v0.13)
- Future: storage inspector — view/clear overrides by origin

### Implementation options

| Option | Tradeoff |
|---|---|
| Gear icon → slide-down panel inside popup | Lowest friction; good for ≤5 toggles |
| `options_ui` in manifest (opens inline in chrome://extensions) | Standard Chrome pattern; separate page context |
| `options_page` (opens in new tab) | Most space; awkward for simple toggles |

**Recommendation:** Gear icon panel inside the popup for v1. Promote to `options_page` if the list grows beyond ~5 items.

### Files affected (estimated)
- `extension/popup.html` — gear icon button in header, settings panel div
- `extension/popup.css` — settings panel styles
- `src/popup/index.ts` — settings panel toggle, demo re-enable handler

---

## Track 2: Storage Cleanup — `localStorage` → `chrome.storage.local`

### Current state

| What | API | Key |
|---|---|---|
| Flag overrides | `chrome.storage.local` | `fc:overrides:{origin}` |
| Demo disabled | `chrome.storage.local` | `fc:onboarding:demoDisabled` |
| Search bar open | `localStorage` | `fc:searchOpen:{origin}` |
| Search query | `localStorage` | `fc:searchQuery:{origin}` |

### Problem
`localStorage` in extension pages can be cleared by browser "Clear browsing data" depending on Chrome version. `chrome.storage.local` is explicitly exempt. The split also creates a confusing two-API model for what is conceptually the same persistent UI state.

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
- `localStorage.getItem(k)` → removed (reads happen only in batched init)

**Scope:** ~10 call sites in `src/popup/index.ts`. No background or content changes.

**Migration:** Old `localStorage` keys silently abandoned — search state resets once on upgrade, which is acceptable.

---

## Track 3: Icon / Logo

### Problem
Current icons are placeholders. The extension has no distinct visual identity in the toolbar or Chrome Web Store.

### Todo
- Design or commission a FeaturePeep icon (flag motif? magnifying glass over a flag?)
- Export at required sizes: 16×16, 32×32, 48×48, 128×128 (PNG)
- Replace `extension/icons/icon{16,32,48,128}.png`
- Update `extension/manifest.json` if paths change
- Create a matching logo asset for README / Web Store listing

---

## Track 4: UI Polish (post-MVP)

### Problem
The popup UI is functional but visually generic. Color scheme, typography, and component styling were chosen for speed, not brand.

### Todo
- Define a color palette that fits the FeaturePeep brand (ties into icon work above)
- Audit `extension/popup.css` for inconsistencies and dead rules
- Consider a dark mode variant (respects `prefers-color-scheme`)
- Polish demo banner, search bar, toolbar, and flag row layout

**Dependency:** Should follow icon/logo work — colors will derive from the identity.

---

## Track 5: Multiple Providers (post-MVP)

### Question
**How should the popup handle a page that has more than one provider active simultaneously?**

This is a real scenario: a team could run LaunchDarkly for flags while a framework like OpenFeature wraps it, resulting in duplicate or overlapping data from two providers.

### Options to evaluate

| Approach | Tradeoff |
|---|---|
| Show flags from the first provider detected; ignore subsequent | Simple; hides real data |
| Merge flags across providers; deduplicate by key | Useful but ambiguous when keys collide across providers |
| Show a provider switcher in the header; display one provider at a time | Clear separation; adds UI complexity |
| Show all flags grouped by provider | Most complete; longer list |

### Open questions
- Should overrides target a specific provider or be provider-agnostic?
- If two providers expose the same flag key with different values, which wins?
- Does detection order matter (stream vs. poll timing)?

**Deferred until:** core provider support (LaunchDarkly, OpenFeature, PostHog) is stable and at least one user reports a multi-provider use case.

---

## Open Questions

- Demo site URL — what domain/path for `DEMO_SITE_URL` in `src/popup/demoFlags.ts`?
- Settings page: popup-embedded panel vs. `options_ui`?
- Multiple providers: which display approach fits the target use case?

---

## Out of Scope

- PostHog self-hosted detection (probabilistic; deferred pending options page)
- PostHog SSE (PostHog does not push flag changes)
- Additional providers beyond LaunchDarkly, OpenFeature, PostHog
- Firefox

---

*Bump version and filename on substantive changes.*
