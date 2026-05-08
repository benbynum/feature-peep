# feature-flag-devtools — Pre-publish Requirements
<!-- scope: tab scoping bug + UI cleanup, prior to rename and publish -->

## Problem

MVP is functionally validated. Two issues block publishing:

1. **Tab bleed** — The popup shows flags from whichever tab sent the most recent `FLAGS_UPDATE`, not necessarily the tab the user is currently on. Flags from background tabs pollute or replace the current tab's view.
2. **UI polish** — Several rough edges to smooth before the extension is presentable to others.

---

## End State

| # | What must be true | How you'd verify it |
|---|-------------------|---------------------|
| E1 | The popup shows only flags for the currently active tab | Open two different LD apps in separate tabs; switch between them; popup always shows flags for the tab you're on |
| E2 | Flags from background tabs never appear in the popup | Have a background tab actively streaming LD updates; confirm popup on the foreground tab is unaffected |
| E3 | The UI is clean enough to share publicly | _TODO: your call on what "clean" means — open question below_ |

---

## Requirements

### Bug: Tab Scoping

**FR-01 — FLAGS_UPDATE scoped to active tab**
What: The background service worker only forwards `FLAGS_UPDATE` to the popup when the message originates from the currently active tab.
Acceptance: Flags from non-active tabs are stored in `tabState` but never pushed to the popup while a different tab is active. Switching to a tab with flags shows that tab's flags (on next popup open — popup re-requests state on open).
Serves: E1, E2

Implementation: In `background.js`, after storing `tabState[sender.tab.id]`, query the active tab before broadcasting. Only send if `sender.tab.id === activeTab.id`.

### UI Cleanup

**FR-02 — _TODO: list specific UI issues_**
What: _Fill in what looks rough — layout, spacing, fonts, colors, states, interactions._
Acceptance: _Your call._
Serves: E3

Open for now — see Open Questions.

---

## Out of Scope

- Flag filtering / search (post-MVP backlog)
- OpenFeature non-LD providers (v2)
- Additional native providers (v3+)
- Project rename (after these are done)
- Firefox

---

## Open Questions

- [ ] **UI cleanup specifics** — What exactly needs changing? Walk through the popup and list anything that looks off before we touch it.
- [ ] **Tab switch behavior** — When the user switches tabs, the popup closes (standard Chrome behavior). On reopen, `GET_FLAGS` fetches the new active tab's state. Is this acceptable, or should we proactively show a "this tab has no flags" state faster?
- [ ] **Overrides across tabs** — Currently overrides are stored globally in `chrome.storage.local` (not per origin). If the user has the same LD SDK key on two different origins, overrides bleed across. Is this a problem now, or post-MVP?
