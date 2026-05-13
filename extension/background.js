"use strict";
(() => {
  // src/constants.ts
  var MSG_SET_OVERRIDE = "SET_OVERRIDE";
  var MSG_CLEAR_OVERRIDE = "CLEAR_OVERRIDE";
  var MSG_CLEAR_ALL_OVERRIDES = "CLEAR_ALL_OVERRIDES";
  var MSG_FLAGS_UPDATE = "FLAGS_UPDATE";
  var MSG_GET_FLAGS = "GET_FLAGS";
  var STORAGE_OVERRIDES_PREFIX = "fc:overrides:";

  // src/background.ts
  var tabState = {};
  var activeTabId = null;
  var activeWindowId = null;
  var focusSeq = 0;
  chrome.windows.onFocusChanged.addListener((windowId) => {
    if (windowId === chrome.windows.WINDOW_ID_NONE) return;
    chrome.windows.get(windowId, (win) => {
      if (chrome.runtime.lastError || win.type !== "normal") return;
      activeWindowId = windowId;
      const seq = ++focusSeq;
      chrome.tabs.query({ active: true, windowId }, (tabs) => {
        if (seq !== focusSeq) return;
        if (tabs[0]) activeTabId = tabs[0].id ?? null;
      });
    });
  });
  chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
    if (windowId === activeWindowId) activeTabId = tabId;
  });
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg["type"] === MSG_FLAGS_UPDATE && sender.tab) {
      const tabId = sender.tab.id;
      if (tabId != null) {
        tabState[tabId] = {
          flags: msg["flags"],
          overrides: msg["overrides"],
          provider: msg["provider"],
          transport: msg["transport"]
        };
        if (tabId === activeTabId) {
          chrome.runtime.sendMessage({
            type: MSG_FLAGS_UPDATE,
            flags: msg["flags"],
            overrides: msg["overrides"],
            provider: msg["provider"],
            transport: msg["transport"]
          }).catch(() => {
          });
        }
      }
      return;
    }
    if (msg["type"] === MSG_GET_FLAGS) {
      if (msg["tabId"]) {
        activeTabId = msg["tabId"];
        if (msg["windowId"]) activeWindowId = msg["windowId"];
      }
      sendResponse(
        activeTabId != null ? tabState[activeTabId] ?? { flags: {}, overrides: {}, provider: null, transport: null } : { flags: {}, overrides: {}, provider: null, transport: null }
      );
      return;
    }
    if (msg["type"] === MSG_SET_OVERRIDE) {
      withActiveTabOrigin((key) => {
        chrome.storage.local.get(key, (result) => {
          const stored = result[key] || {};
          stored[msg["key"]] = msg["value"];
          chrome.storage.local.set({ [key]: stored });
        });
      });
      forwardToActiveTab(msg);
      return;
    }
    if (msg["type"] === MSG_CLEAR_OVERRIDE) {
      withActiveTabOrigin((key) => {
        chrome.storage.local.get(key, (result) => {
          const stored = result[key] || {};
          delete stored[msg["key"]];
          chrome.storage.local.set({ [key]: stored });
        });
      });
      forwardToActiveTab(msg);
      return;
    }
    if (msg["type"] === MSG_CLEAR_ALL_OVERRIDES) {
      withActiveTabOrigin((key) => {
        chrome.storage.local.set({ [key]: {} });
      });
      forwardToActiveTab(msg);
      return;
    }
  });
  function forwardToActiveTab(msg) {
    if (activeTabId != null) {
      chrome.tabs.sendMessage(activeTabId, msg).catch(() => {
      });
    }
  }
  function withActiveTabOrigin(callback) {
    if (activeTabId == null) return;
    chrome.tabs.get(activeTabId, (tab) => {
      if (chrome.runtime.lastError || !tab?.url) return;
      try {
        const origin = new URL(tab.url).origin;
        callback(`${STORAGE_OVERRIDES_PREFIX}${origin}`);
      } catch (_) {
      }
    });
  }
  chrome.tabs.onRemoved.addListener((tabId) => {
    delete tabState[tabId];
    if (tabId === activeTabId) activeTabId = null;
  });
})();
