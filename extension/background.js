// Per-tab flag state — lost if service worker is terminated (MV3 limitation, acceptable for MVP)
const tabState = {}

// Track focused window + its active tab — onActivated fires across all windows so we must
// gate updates on whether the tab's window is the focused one
let activeTabId = null
let activeWindowId = null

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return
  activeWindowId = windowId
  chrome.tabs.query({ active: true, windowId }, (tabs) => {
    if (tabs[0]) activeTabId = tabs[0].id
  })
})

chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
  if (windowId === activeWindowId) activeTabId = tabId
})

// Initialize on startup in case the service worker starts mid-session
chrome.windows.getLastFocused({ populate: true }, (win) => {
  if (!win) return
  activeWindowId = win.id
  const active = win.tabs?.find(t => t.active)
  if (active) activeTabId = active.id
})

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  // FLAGS_UPDATE from content script
  if (msg.type === 'FLAGS_UPDATE' && sender.tab) {
    tabState[sender.tab.id] = { flags: msg.flags, overrides: msg.overrides }
    if (sender.tab.id === activeTabId) {
      chrome.runtime.sendMessage({ type: 'FLAGS_UPDATE', flags: msg.flags, overrides: msg.overrides })
        .catch(() => {})
    }
    return
  }

  // GET_FLAGS from popup
  if (msg.type === 'GET_FLAGS') {
    const state = tabState[activeTabId] || { flags: {}, overrides: {} }
    sendResponse(state)
    return
  }

  // Override commands from popup
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
  if (activeTabId) {
    chrome.tabs.sendMessage(activeTabId, msg).catch(() => {})
  }
}

chrome.tabs.onRemoved.addListener((tabId) => {
  delete tabState[tabId]
  if (tabId === activeTabId) activeTabId = null
})
