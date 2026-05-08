const tabState = {}

let activeTabId = null
let activeWindowId = null
let focusSeq = 0  // Discard stale onFocusChanged callbacks when windows switch rapidly

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return
  activeWindowId = windowId
  const seq = ++focusSeq
  chrome.tabs.query({ active: true, windowId }, (tabs) => {
    if (seq !== focusSeq) return  // A newer focus change came in — discard
    if (tabs[0]) activeTabId = tabs[0].id
  })
})

chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
  if (windowId === activeWindowId) activeTabId = tabId
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

  // GET_FLAGS from popup — always query fresh so popup open authoritatively resets activeTabId
  if (msg.type === 'GET_FLAGS') {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      if (tabs[0]) {
        activeTabId = tabs[0].id
        activeWindowId = tabs[0].windowId
      }
      sendResponse(tabState[activeTabId] || { flags: {}, overrides: {} })
    })
    return true  // Keep channel open for async sendResponse
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
