# Security

## Reporting a vulnerability

Open a [GitHub issue](https://github.com/benbynum/feature-peep/issues) for general bugs. For sensitive security issues please email **benbynum@gmail.com** with a description of the issue and steps to reproduce. You can expect a response within a few days.

## Known security characteristics

### postMessage origin is not verified

`inject.js` runs in the browser's MAIN world and communicates with `content.js` via `window.postMessage`. Messages are distinguished by a `source` field (`fc-inject` / `fc-content`) rather than by origin, which means any JavaScript already running on the page can spoof those messages and, for example, apply or clear flag overrides.

The practical impact is bounded: a script that can run on your page already has direct access to the feature flag SDK and can manipulate it without the extension. Override changes are local to that browser session and are not transmitted anywhere. This behaviour is inherent to MAIN-world content script architecture and is documented here rather than treated as a bug.

### MAIN world script patches browser globals

`inject.js` wraps `window.fetch`, `window.XMLHttpRequest`, and `window.EventSource` at `document_start`. This is required to intercept SDK network traffic before the SDK initialises. The wrappers pass all requests through to the originals unchanged unless the URL matches a known feature flag provider pattern.

### Feedback submission calls an external service

The popup's "Submit feedback" form (`src/popup/index.ts`) is the one place the extension makes a network request of its own: it POSTs the message — and an email address, if the user chooses to provide one — to a fixed Formspree endpoint (`src/constants.ts`) so the maintainer can read and reply to it. This is opt-in and user-initiated; nothing is sent unless the user types a message and clicks Send.

## Extension permissions

| Permission | Why it's needed |
|---|---|
| `storage` | Persists flag overrides in `chrome.storage.local`, scoped per origin. Never leaves the device. |
| `tabs` | Tracks which tab is active so the popup shows the correct tab's flags and overrides reach the right tab. |
| `windows` | Detects window focus changes so the active-tab tracking stays accurate when switching windows. |

The extension uses `"matches": ["<all_urls>"]` in its content scripts because feature flag SDKs can run on any site. It does not read page content, form data, or credentials — it only inspects URLs and JSON responses from known flag provider endpoints.

`host_permissions` additionally includes `https://formspree.io/*`, scoped narrowly to the feedback form's POST endpoint described above.
