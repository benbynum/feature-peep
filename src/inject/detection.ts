import type { DetectedProvider } from '../types.js'

export function detectProvider(url: string): DetectedProvider | null {
  try {
    const u = new URL(url, location.href)
    const host = u.hostname
    const path = u.pathname

    if (/(?:^|\.)(?:clientstream|stream)\.launchdarkly\.com$/.test(host)) {
      return { id: 'launchdarkly', transport: 'sse' }
    }
    if (/(?:^|\.)(?:app|sdk)\.launchdarkly\.com$/.test(host)) {
      return { id: 'launchdarkly', transport: 'polling' }
    }
    if (/\/sdk\/evalx\/[a-f0-9-]{20,}\/contexts\//i.test(path) ||
        /\/sdk\/eval\/[a-f0-9-]{20,}\/users\//i.test(path)) {
      return { id: 'launchdarkly', transport: 'polling' }
    }
    if (/\/eval\/[a-f0-9-]{20,}\//.test(path)) {
      return { id: 'launchdarkly', transport: 'sse' }
    }
    if (/(?:^|\.)(?:posthog|i\.posthog)\.com$/.test(host) && (/\/decide\//.test(path) || path.startsWith('/flags/'))) {
      return { id: 'posthog', transport: 'polling' }
    }
    if (/\/ofrep\/v1\/sse/.test(path)) {
      return { id: 'openfeature', transport: 'sse' }
    }
    if (/\/ofrep\/v1\//.test(path)) {
      return { id: 'openfeature', transport: 'polling' }
    }
  } catch (_) {}
  return null
}
