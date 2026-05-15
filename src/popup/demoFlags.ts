import type { FlagsMap } from '../types.js'

export const DEMO_PROVIDER_ID = 'launchdarkly' as const
export const DEMO_SITE_URL = 'https://featurepeep.com'

export const DEMO_FLAGS: FlagsMap = {
  'enable-dark-mode':      { value: false },
  'checkout-button-color': { value: 'blue' },
  'max-items-per-page':    { value: 25 },
  'experiment-config':     { value: { variant: 'control', weight: 0.5 } },
}
