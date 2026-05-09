const tabState = {}

let activeTabId = null
let activeWindowId = null
let focusSeq = 0  // Discard stale onFocusChanged callbacks when windows switch rapidly

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return
  // Skip popup/extension windows (e.g. the extension popup itself) so activeTabId
  // always points to a real browser tab, not a windowless popup context.
  chrome.windows.get(windowId, (win) => {
    if (chrome.runtime.lastError || win.type !== 'normal') return
    activeWindowId = windowId
    const seq = ++focusSeq
    chrome.tabs.query({ active: true, windowId }, (tabs) => {
      if (seq !== focusSeq) return
      if (tabs[0]) activeTabId = tabs[0].id
    })
  })
})

chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
  if (windowId === activeWindowId) activeTabId = tabId
})

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  // FLAGS_UPDATE from content script
  if (msg.type === 'FLAGS_UPDATE' && sender.tab) {
    tabState[sender.tab.id] = { flags: msg.flags, overrides: msg.overrides, provider: msg.provider, transport: msg.transport }
    if (sender.tab.id === activeTabId) {
      chrome.runtime.sendMessage({ type: 'FLAGS_UPDATE', flags: msg.flags, overrides: msg.overrides, provider: msg.provider, transport: msg.transport })
        .catch(() => {})
    }
    return
  }

  // GET_FLAGS — tab ID resolved by the popup itself via getLastFocused,
  // so background doesn't need to track window state at all.
  if (msg.type === 'GET_FLAGS') {
    if (msg.tabId) {
      activeTabId = msg.tabId
      if (msg.windowId) activeWindowId = msg.windowId
    }
    sendResponse(tabState[activeTabId] || { flags: {}, overrides: {}, provider: null, transport: null })
  }

  // Override commands from popup
  if (msg.type === 'SET_OVERRIDE') {
    chrome.storage.local.get('fc:overrides', (result) => {
      const stored = result['fc:overrides'] || {}
      stored[msg.key] = msg.value
      chrome.storage.local.set({ 'fc:overrides': stored })
    })
    forwardToActiveTab(msg)
    return
  }

  if (msg.type === 'CLEAR_OVERRIDE') {
    chrome.storage.local.get('fc:overrides', (result) => {
      const stored = result['fc:overrides'] || {}
      delete stored[msg.key]
      chrome.storage.local.set({ 'fc:overrides': stored })
    })
    forwardToActiveTab(msg)
    return
  }

  if (msg.type === 'CLEAR_ALL_OVERRIDES') {
    chrome.storage.local.set({ 'fc:overrides': {} })
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
