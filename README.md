# FeaturePeep

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

At my last company we had 100+ flags across 5 environments. There were 40 engineers. Toggling a value to smoke test a feature meant risking someone else's environment, breaking CI, or causing countless other potential side effects. FeaturePeep changes that!

- Auto-detect which provider is implemented
- See which flags are active on any page instantly
- Reproduce bugs in all environemnts without worrying about negative downstream effects
- No more waiting on someone with dashboard access to make a change

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

## Scope

- Does not modify server-side feature flags
- Does not access provider admin APIs
- Overrides are local to your browser session
- Intended for frontend debugging and QA workflows

## Limitations

- Chrome only
- PostHog self-hosted instances require manual URL configuration (coming soon)
