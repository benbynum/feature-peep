# feature-flag-devtools — Project Plan

**Version:** 0.12.0  
**Date:** 2026-05-08  
**Status:** Active — MVP validated, pre-publish cleanup in progress

---

## MVP Validation Results

Extension loaded and tested against a real LD-connected app. Results:

| Check | Result |
|---|---|
| Flags appear in popup | ✅ |
| Boolean override immediately changes app UI | ✅ |
| Override persists across page reload | ✅ |
| Restore returns app to provider value | ✅ |
| Works with LD native JS SDK | ✅ |
| Works with LD via OpenFeature adapter | ✅ (SSE interception is below the OF abstraction layer) |

**Confirmed broader than originally scoped:** the extension works for both LD native SDK and LD used via the OpenFeature adapter. Both use the same LD SSE stream. No additional code needed. Scope note updated accordingly.

---

## Known Provider Coverage (SSE)

| Setup | Works |
|---|---|
| LaunchDarkly native JS client SDK | ✅ confirmed |
| LaunchDarkly via OpenFeature adapter | ✅ confirmed |
| LaunchDarkly polling-only mode (streaming disabled) | ❌ out of scope |
| OpenFeature with non-LD providers (Unleash, DevCycle, etc.) | Roadmap v2 |

---

## Pre-Publish Checklist

Three things before this ships:

1. **Tab scoping bug (fix immediately)** — Flags from any tab broadcast to the popup regardless of which tab is active. User sees flags from background tabs mixed with or replacing the current tab's flags. Fix: background.js must only forward `FLAGS_UPDATE` to popup when the sending tab is the currently active tab.

2. **UI cleanup** — See REQ-v0.5 for specifics.

3. **Project rename** — Directory and any references updated from `openfeature-react-devtools` to the new name. Deferred until the other two are done.

---

## Post-MVP Backlog

**Flag filtering / focus mode** — Apps with many flags (50–100+) produce an unmanageable list. Options: search/filter input, pin flags to top, hide unmodified flags, group by key prefix (common LD convention: `feature-`, `exp-`, `kill-switch-`). Does not affect MVP.

**OpenFeature non-LD providers (v2)** — Hook injection via `window.OpenFeature.addHooks()` covers Unleash, DevCycle, Flagsmith, etc. in one move. Separate from SSE interception.

**Additional native providers (v3+)** — Statsig, DevCycle native, Flagsmith SaaS. Each requires a payload parser.

**Drop-in React component** — Different product, different audience. Deferred.

---

## Strategic Direction (unchanged)

Extension first, LaunchDarkly first. The extension reaches any environment without app changes. Component is later, different use case.

Roadmap:
1. MVP — LD (native + OF adapter), SSE, popup, overrides ← **here**
2. v2 — OpenFeature hook injection (non-LD providers)
3. v3+ — Additional native providers
4. Later — Drop-in component

---

*Bump the version header and filename when making substantive changes.*
