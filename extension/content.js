// inject.js runs in the MAIN world (see manifest) — no script tag injection needed.
// This file runs in the isolated content script world and bridges
// window.postMessage (from inject.js) ↔ chrome.runtime (background/popup).

// ── Page world → extension ────────────────────────────────────────────────

window.addEventListener('message', (e) => {
  if (!e.data || e.data.source !== 'fc-inject') return

  // Extension context is invalidated when the extension reloads mid-page.
  // Stop trying to communicate — user must refresh the tab.
  if (!chrome.runtime?.id) return

  if (e.data.type === 'REQUEST_OVERRIDES') {
    const key = `fc:overrides:${e.data.origin || location.origin}`
    chrome.storage.local.get(key, (result) => {
      window.postMessage({
        source: 'fc-content',
        type: 'INIT_OVERRIDES',
        overrides: result[key] || {},
      }, '*')
    })
    return
  }

  // Forward FLAGS_UPDATE to background
  chrome.runtime.sendMessage(e.data).catch(() => {})
})

// ── Extension → page world ────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg) => {
  if (['SET_OVERRIDE', 'CLEAR_OVERRIDE', 'CLEAR_ALL_OVERRIDES'].includes(msg.type)) {
    window.postMessage({ source: 'fc-content', ...msg }, '*')
  }
})
