import {
  MSG_FLAGS_UPDATE, MSG_GET_FLAGS,
  MSG_SET_OVERRIDE, MSG_CLEAR_OVERRIDE, MSG_CLEAR_ALL_OVERRIDES,
  STORAGE_OVERRIDES_PREFIX,
} from './constants.js'

interface TabState {
  flags: Record<string, unknown>
  overrides: Record<string, unknown>
  provider: string | null
  transport: string | null
}

const tabState: Record<number, TabState> = {}

let activeTabId: number | null = null
let activeWindowId: number | null = null
let focusSeq = 0

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return
  chrome.windows.get(windowId, (win) => {
    if (chrome.runtime.lastError || win.type !== 'normal') return
    activeWindowId = windowId
    const seq = ++focusSeq
    chrome.tabs.query({ active: true, windowId }, (tabs) => {
      if (seq !== focusSeq) return
      if (tabs[0]) activeTabId = tabs[0].id ?? null
    })
  })
})

chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
  if (windowId === activeWindowId) activeTabId = tabId
})

chrome.runtime.onMessage.addListener((msg: Record<string, unknown>, sender, sendResponse) => {

  if (msg['type'] === MSG_FLAGS_UPDATE && sender.tab) {
    const tabId = sender.tab.id
    if (tabId != null) {
      tabState[tabId] = {
        flags: msg['flags'] as Record<string, unknown>,
        overrides: msg['overrides'] as Record<string, unknown>,
        provider: msg['provider'] as string | null,
        transport: msg['transport'] as string | null,
      }
      if (tabId === activeTabId) {
        chrome.runtime.sendMessage({
          type: MSG_FLAGS_UPDATE,
          flags: msg['flags'],
          overrides: msg['overrides'],
          provider: msg['provider'],
          transport: msg['transport'],
        }).catch(() => {})
      }
    }
    return
  }

  if (msg['type'] === MSG_GET_FLAGS) {
    if (msg['tabId']) {
      activeTabId = msg['tabId'] as number
      if (msg['windowId']) activeWindowId = msg['windowId'] as number
    }
    sendResponse(activeTabId != null
      ? (tabState[activeTabId] ?? { flags: {}, overrides: {}, provider: null, transport: null })
      : { flags: {}, overrides: {}, provider: null, transport: null }
    )
    return
  }

  if (msg['type'] === MSG_SET_OVERRIDE) {
    withActiveTabOrigin((key) => {
      chrome.storage.local.get(key, (result) => {
        const stored = (result[key] as Record<string, unknown>) || {}
        stored[msg['key'] as string] = msg['value']
        chrome.storage.local.set({ [key]: stored })
      })
    })
    forwardToActiveTab(msg)
    return
  }

  if (msg['type'] === MSG_CLEAR_OVERRIDE) {
    withActiveTabOrigin((key) => {
      chrome.storage.local.get(key, (result) => {
        const stored = (result[key] as Record<string, unknown>) || {}
        delete stored[msg['key'] as string]
        chrome.storage.local.set({ [key]: stored })
      })
    })
    forwardToActiveTab(msg)
    return
  }

  if (msg['type'] === MSG_CLEAR_ALL_OVERRIDES) {
    withActiveTabOrigin((key) => {
      chrome.storage.local.set({ [key]: {} })
    })
    forwardToActiveTab(msg)
    return
  }

})

function forwardToActiveTab(msg: Record<string, unknown>): void {
  if (activeTabId != null) {
    chrome.tabs.sendMessage(activeTabId, msg).catch(() => {})
  }
}

function withActiveTabOrigin(callback: (key: string) => void): void {
  if (activeTabId == null) return
  chrome.tabs.get(activeTabId, (tab) => {
    if (chrome.runtime.lastError || !tab?.url) return
    try {
      const origin = new URL(tab.url).origin
      callback(`${STORAGE_OVERRIDES_PREFIX}${origin}`)
    } catch (_) {}
  })
}

chrome.tabs.onRemoved.addListener((tabId) => {
  delete tabState[tabId]
  if (tabId === activeTabId) activeTabId = null
})
