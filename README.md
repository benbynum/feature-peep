# FeatureCreep

Inspect and override feature flags without touching your app or environment config.

![FeatureCreep demo](feature-creep-demo-hq.gif)

## Why it exists

At my last company we had 100+ flags across 5 environments and 40 engineers. Changing a flag to test something meant risking someone else's environment or breaking CI. FeatureCreep fixes that!

- See which flags are active on any page, any env, instantly
- Reproduce bugs that only appear in a specific flag state
- Test both sides of a flag without touching the dashboard
- No more waiting on someone with dashboard access to make a change

## Supported Providers

| Provider | Transport | Notes |
|---|---|---|
| LaunchDarkly (native JS SDK) | Streaming + Polling | Full support |
| LaunchDarkly via OpenFeature adapter | Streaming + Polling | Full support — same stream |
| OpenFeature / OFREP | Streaming + Polling | Matnaw and other OFREP-compliant providers |
| PostHog | Polling | Boolean, string, and number flags; PostHog Cloud only |

## Future Providers

- Statsig, Unleash, Optimizely, Split / Harness, DevCycle, GrowthBook

Don't see your provider? Open an issue or submit a pull request.

## Install

Not yet on the Chrome Web Store. Load it manually:

1. Clone this repo
2. Open `chrome://extensions`
3. Enable **Developer mode**
4. Click **Load unpacked** → select the `extension/` folder

## Security

See [SECURITY.md](SECURITY.md) for extension permissions rationale, known security characteristics, and how to report a vulnerability.

## Privacy

FeatureCreep collects no user data. It does not make network requests of its own, transmit anything to external servers, or communicate with provider APIs. All flag data is read locally from your browser's existing SDK traffic. Overrides are stored in your browser's local extension storage and never leave your device.

## Scope

- Does not modify server-side feature flags
- Does not access provider admin APIs
- Overrides are local to your browser session
- Intended for frontend debugging and QA workflows

## Limitations

- Chrome only
- PostHog self-hosted instances require manual URL configuration (coming soon)
