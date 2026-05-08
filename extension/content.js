// inject.js runs in the MAIN world (see manifest) — no script tag injection needed.
// This file runs in the isolated content script world and bridges
// window.postMessage (from inject.js) ↔ chrome.runtime (background/popup).

// ── Page world → extension ────────────────────────────────────────────────

window.addEventListener('message', (e) => {
  if (!e.data || e.data.source !== 'ffd-inject') return

  if (e.data.type === 'REQUEST_OVERRIDES') {
    chrome.storage.local.get('ffd:overrides', (result) => {
      window.postMessage({
        source: 'ffd-content',
        type: 'INIT_OVERRIDES',
        overrides: result['ffd:overrides'] || {},
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
    window.postMessage({ source: 'ffd-content', ...msg }, '*')
  }
})
