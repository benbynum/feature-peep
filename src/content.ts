import {
  SOURCE_INJECT, SOURCE_CONTENT,
  MSG_REQUEST_OVERRIDES, MSG_INIT_OVERRIDES,
  MSG_SET_OVERRIDE, MSG_CLEAR_OVERRIDE, MSG_CLEAR_ALL_OVERRIDES,
  STORAGE_OVERRIDES_PREFIX,
} from './constants.js'

// ── Page world → extension ────────────────────────────────────────────────

window.addEventListener('message', (e: MessageEvent) => {
  if (!e.data || e.data.source !== SOURCE_INJECT) return

  if (!chrome.runtime?.id) return

  if (e.data.type === MSG_REQUEST_OVERRIDES) {
    const key = `${STORAGE_OVERRIDES_PREFIX}${(e.data.origin as string | undefined) || location.origin}`
    chrome.storage.local.get(key, (result) => {
      window.postMessage({
        source: SOURCE_CONTENT,
        type: MSG_INIT_OVERRIDES,
        overrides: (result[key] as Record<string, unknown>) || {},
      }, '*')
    })
    return
  }

  chrome.runtime.sendMessage(e.data).catch(() => {})
})

// ── Extension → page world ────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg: { type: string }) => {
  if (([MSG_SET_OVERRIDE, MSG_CLEAR_OVERRIDE, MSG_CLEAR_ALL_OVERRIDES] as string[]).includes(msg.type)) {
    window.postMessage({ source: SOURCE_CONTENT, ...msg }, '*')
  }
})
