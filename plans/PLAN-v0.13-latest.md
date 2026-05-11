# FeatureCreep — Project Plan

**Version:** 0.13.0
**Date:** 2026-05-09
**Status:** Active — polling support + provider architecture

---

## Context

MVP validated with LaunchDarkly in SSE/streaming mode. Next milestone: support LD in polling mode (streaming disabled), and lay the architectural foundation for multiple providers and transports.

---

## Provider + Transport Architecture

Provider and transport are two separate concepts:

- **Provider** — which feature flag system (LaunchDarkly, Statsig, PostHog, etc.)
- **Transport** — how flags are delivered (SSE, polling via fetch/XHR, WebSocket, SDK hook)

Each provider can support multiple transports. The first transport that fires determines what gets reported. Both are surfaced in the UI badge: `LaunchDarkly · streaming` vs `LaunchDarkly · polling`.

### Provider registry (inject.js)

```js
const PROVIDERS = {
  launchdarkly: {
    name: 'LaunchDarkly',
    transports: ['sse', 'polling'],
    detect: {
      sse:     (url) => isLDStreamUrl(url),
      polling: (url) => isLDPollUrl(url),
    },
    parse: {
      put:   parseLDPut,    // full flag snapshot
      patch: parseLDPatch,  // single flag update
    }
  }
}
```

### Interceptors (inject.js)

Three interceptors patched at `document_start`, all active simultaneously:

| Interceptor | Targets | Status |
|---|---|---|
| `EventSource` patch | SSE streams | ✅ done |
| `fetch` patch | Polling (modern SDKs) | 🔲 next |
| `XMLHttpRequest` patch | Polling (older SDKs/bundlers) | 🔲 after fetch |

Interceptors are transport-agnostic — they detect the provider by URL pattern and delegate to the provider's parser.

---

## URL Detection Strategy

### Tier 1 — Direct to LD (exact host match)

| Host | Transport |
|---|---|
| `clientstream.launchdarkly.com` | SSE |
| `stream.launchdarkly.com` | SSE (older SDK) |
| `app.launchdarkly.com` | Polling |
| `sdk.launchdarkly.com` | Polling (some configs) |

### Tier 2 — Relay proxy (path-pattern match, any host)

Match on path regardless of host:

```
/sdk/evalx/{24-32 char hex}/contexts/   → LD polling
/sdk/eval/{24-32 char hex}/users/       → LD polling (older SDK)
/eval/{24-32 char hex}/                 → LD SSE (relay)
```

Relay proxy is identified when: host doesn't match Tier 1 but path matches a known LD pattern.

### Tier 3 — User-configured URLs (v2)

When automatic detection fails, user can add custom base URLs via extension options page:

```json
{
  "customProviders": [
    { "baseUrl": "https://ld-relay.mycompany.com", "provider": "launchdarkly" }
  ]
}
```

Stored in `chrome.storage.sync`. Checked after Tier 1 and Tier 2 fail.

---

## Implementation Plan

### Phase 1 — Polling support (current)

1. **`fetch` interceptor in inject.js**
   - Wrap `window.fetch` at `document_start`
   - On response: check URL against provider detection (Tier 1 + Tier 2)
   - Clone response to read body without consuming it
   - Parse JSON, run through `isLDPut`, notify extension
   - Pass original response through untouched to SDK

2. **`XMLHttpRequest` interceptor in inject.js**
   - Wrap `XMLHttpRequest.prototype.open` and `send`
   - Same detection and parsing logic
   - Lower priority than fetch — most modern LD SDK versions use fetch

3. **Transport field in `FLAGS_UPDATE`**
   - Add `transport: 'sse' | 'polling'` to the message
   - Background passes it through to popup
   - Badge shows transport type

4. **Relay proxy detection (Tier 2)**
   - Path-pattern regex alongside host matching
   - No user config required — works automatically

### Phase 2 — User-configured URLs (v2)

1. **Options page** (`options.html/js`)
   - Simple list of custom base URLs with provider assignment
   - Saved to `chrome.storage.sync`

2. **inject.js reads custom URLs on startup**
   - `REQUEST_CUSTOM_URLS` message to content.js → reads storage → `INIT_CUSTOM_URLS` response
   - Added to Tier 3 detection

3. **Manifest update**
   - Add `options_page` or `options_ui` entry
   - Add `chrome.storage.sync` permission if not already present

### Phase 3 — Additional providers (v3+)

Each new provider adds an entry to the `PROVIDERS` registry with its own:
- URL detection patterns
- Response parser
- Transport preferences

OpenFeature hook injection is a separate transport type entirely (no URL matching needed — hooks into the OF SDK API directly).

---

## Open Questions

- [ ] **Polling interval behavior** — LD polls every 30s by default. Should FeatureCreep show a "last updated" timestamp so the user knows the data might be stale?
- [ ] **Relay proxy path ambiguity** — if the user's relay is behind a path like `/api/ld/sdk/evalx/...`, Tier 2 regex may not match. Tier 3 (custom URLs) is the fallback.
- [ ] **Transport display** — show in badge as `LaunchDarkly · polling` or just an icon indicator?
- [ ] **options_page timing** — build options page as part of Phase 2 or wait until a second provider needs it?

---

## Files Affected

| File | Changes |
|---|---|
| `extension/inject.js` | fetch + XHR interceptors, provider registry, transport field |
| `extension/content.js` | pass-through of transport field |
| `extension/background.js` | pass-through of transport field in FLAGS_UPDATE |
| `extension/popup.js` | transport display in badge |
| `extension/popup.css` | badge transport styling |
| `extension/options.html/js` | Phase 2 |
| `extension/manifest.json` | options_page entry (Phase 2) |

---

*Bump version and filename on substantive changes.*
