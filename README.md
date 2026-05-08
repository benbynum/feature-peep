# Flagtap

A Chrome extension for inspecting and overriding feature flags on any page without touching your app or environment config.

## What Flagtap does

Open the popup on any page using a supported feature flag provider and you'll see every flag the SDK has received, its current value, and its type. Click a flag to override it. The override takes effect immediately in the running app and persists across page reloads. Click "restore actual value" to go back to the SDK's value.

## Origin

At my last company we had over 100 flags in 5 environments and 40+ engineers working with them. If we used a tool like this we could have:

- known instantly which flags are active on any page, any environment
- easily reproduced bugs that only occur only in a specific flag state
- tested both sides of a flag without toggling it for the whole org
- avoided waiting on someone with LD dashboard access to toggle something

## Supported Providers

| Provider | Notes |
|---|---|
| LaunchDarkly (native JS SDK) | Full support |
| LaunchDarkly via OpenFeature adapter | Full support — same SSE stream |

## Future Providers

- OpenFeature (non-LaunchDarkly providers)
- Optimizely
- PostHog
- Unleash
- Statsig
- Split / Harness
- DevCycle
- GrowthBook

Don't see your provider? Just ask, or submit a pull request.

## Install

Not yet published to the Chrome Web Store. Load it manually:

1. Clone this repo
2. Open `chrome://extensions`
3. Enable **Developer mode** (top right)
4. Click **Load unpacked** and select the `extension/` folder

## Usage

Open the Flagtap popup from the Chrome toolbar on any page using a supported provider.

- **Flags list** — all flags received by the SDK on the active tab, sorted alphabetically, with type and current value shown
- **Override a flag** — click any flag to expand the editor. Booleans get a true/false toggle; strings, numbers, and JSON get a text input
- **Restore** — click "restore actual value" to remove the override and return to the SDK value
- **Clear all** — removes all active overrides at once

Overrides persist across page reloads via `chrome.storage.local`. They are cleared when you use "restore" or "clear all."

## Limitations

- LaunchDarkly in polling-only mode is not supported (streaming must be enabled)
- Firefox is not supported

## Status

MVP. Tested against real LD-connected apps running both the native SDK and the OpenFeature adapter.
