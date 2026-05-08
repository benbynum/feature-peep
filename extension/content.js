// Inject inject.js into the page world so it can access window.EventSource
const script = document.createElement('script')
script.src = chrome.runtime.getURL('inject.js')
script.onload = () => script.remove()
;(document.head || document.documentElement).appendChild(script)

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
