# [FeaturePeep](https://featurepeep.com)

Inspect and override feature flags in real-time. Any page, any environment.

![FeaturePeep demo](extension/assets/feature-peep-demo-hq.gif)

## Install

Chrome Web Store approval is pending. In the meantime, install directly from GitHub in under a minute:

1. [Download this repo as a ZIP](https://github.com/benbynum/feature-peep/archive/refs/heads/main.zip) and unzip it
2. Open `chrome://extensions`
3. Enable **Developer mode** (toggle, top-right)
4. Click **Load unpacked** → select the `extension/` folder inside the unzipped directory

The extension will appear in your toolbar. Pin it for easy access.

## Why it exists

At my last job we had 100+ flags across 5 environments with 40 engineers and QA testers using them. Toggling a value to smoke test a feature meant risking someone else's environment, breaking CI, or causing countless other potential side effects. FeaturePeep changes that!

- Zero config — works with what's already on the page, no API keys or SDK setup required
- See every active flag on the current page instantly — production, staging, or local
- Override flags locally without touching shared environments or breaking CI
- No dashboard access needed — useful for engineers, QA, and anyone asking "is that flag on in prod?"

## Supported Providers

| Provider | Transport | Notes |
|---|---|---|
| OpenFeature / OFREP | Streaming + Polling | Any OFREP-compliant provider works automatically |
| LaunchDarkly | Streaming + Polling | Native SDK and OpenFeature adapter both supported |
| PostHog | Polling | Boolean, string, and number flags; PostHog Cloud only |

## Future Providers

- Statsig
- Optimizely
- Split / Harness
- Unleash
- GrowthBook
- DevCycle

Don't see your provider? [Open an issue](https://github.com/benbynum/feature-peep/issues) or submit a pull request.

## Security

See [SECURITY.md](SECURITY.md) for extension permissions rationale, known security characteristics, and how to report a vulnerability.

## Privacy

FeaturePeep collects no user data. It does not make network requests of its own, transmit anything to external servers, or communicate with provider APIs. All flag data is read locally from your browser's existing SDK traffic. Overrides are stored in your browser's local extension storage and never leave your device.

Full details at [featurepeep.com/privacy](https://featurepeep.com/privacy).

## Limitations

- Chrome only
- Client-side only — only detects flags evaluated in the browser; flags evaluated server-side won't appear
- Overrides are local to your browser — does not modify server-side flags or access provider admin APIs
- PostHog self-hosted instances require manual URL configuration (coming soon)
- Intended for frontend debugging and QA workflows
