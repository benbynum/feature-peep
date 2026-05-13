"use strict";
(() => {
  // src/constants.ts
  var SOURCE_INJECT = "fc-inject";
  var SOURCE_CONTENT = "fc-content";
  var MSG_REQUEST_OVERRIDES = "REQUEST_OVERRIDES";
  var MSG_INIT_OVERRIDES = "INIT_OVERRIDES";
  var MSG_SET_OVERRIDE = "SET_OVERRIDE";
  var MSG_CLEAR_OVERRIDE = "CLEAR_OVERRIDE";
  var MSG_CLEAR_ALL_OVERRIDES = "CLEAR_ALL_OVERRIDES";
  var STORAGE_OVERRIDES_PREFIX = "fc:overrides:";

  // src/content.ts
  window.addEventListener("message", (e) => {
    if (!e.data || e.data.source !== SOURCE_INJECT) return;
    if (!chrome.runtime?.id) return;
    if (e.data.type === MSG_REQUEST_OVERRIDES) {
      const key = `${STORAGE_OVERRIDES_PREFIX}${e.data.origin || location.origin}`;
      chrome.storage.local.get(key, (result) => {
        window.postMessage({
          source: SOURCE_CONTENT,
          type: MSG_INIT_OVERRIDES,
          overrides: result[key] || {}
        }, "*");
      });
      return;
    }
    chrome.runtime.sendMessage(e.data).catch(() => {
    });
  });
  chrome.runtime.onMessage.addListener((msg) => {
    if ([MSG_SET_OVERRIDE, MSG_CLEAR_OVERRIDE, MSG_CLEAR_ALL_OVERRIDES].includes(msg.type)) {
      window.postMessage({ source: SOURCE_CONTENT, ...msg }, "*");
    }
  });
})();
