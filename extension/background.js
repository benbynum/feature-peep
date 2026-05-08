// Per-tab flag state — lost if service worker is terminated (MV3 limitation, acceptable for MVP)
const tabState = {}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  // ── FLAGS_UPDATE from content script ────────────────────────────────────
  if (msg.type === 'FLAGS_UPDATE' && sender.tab) {
    tabState[sender.tab.id] = { flags: msg.flags, overrides: msg.overrides }
    // Only push to popup if this is the currently active tab
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id === sender.tab.id) {
        chrome.runtime.sendMessage({ type: 'FLAGS_UPDATE', flags: msg.flags, overrides: msg.overrides })
          .catch(() => {})
      }
    })
    return
  }

  // ── GET_FLAGS from popup ─────────────────────────────────────────────────
  if (msg.type === 'GET_FLAGS') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const state = tabState[tabs[0]?.id] || { flags: {}, overrides: {} }
      sendResponse(state)
    })
    return true // keep channel open for async sendResponse
  }

  // ── Override commands from popup ─────────────────────────────────────────
  if (msg.type === 'SET_OVERRIDE') {
    chrome.storage.local.get('ffd:overrides', (result) => {
      const stored = result['ffd:overrides'] || {}
      stored[msg.key] = msg.value
      chrome.storage.local.set({ 'ffd:overrides': stored })
    })
    forwardToActiveTab(msg)
    return
  }

  if (msg.type === 'CLEAR_OVERRIDE') {
    chrome.storage.local.get('ffd:overrides', (result) => {
      const stored = result['ffd:overrides'] || {}
      delete stored[msg.key]
      chrome.storage.local.set({ 'ffd:overrides': stored })
    })
    forwardToActiveTab(msg)
    return
  }

  if (msg.type === 'CLEAR_ALL_OVERRIDES') {
    chrome.storage.local.set({ 'ffd:overrides': {} })
    forwardToActiveTab(msg)
    return
  }
})

function forwardToActiveTab(msg) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, msg).catch(() => {})
  })
}

chrome.tabs.onRemoved.addListener((tabId) => {
  delete tabState[tabId]
})
