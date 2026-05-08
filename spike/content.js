// Runs in the isolated content script world — cannot directly access window.EventSource
// Solution: inject inject.js as a <script> tag into the page DOM so it runs in the page world

const script = document.createElement('script');
script.src = chrome.runtime.getURL('inject.js');
script.onload = () => script.remove();
(document.head || document.documentElement).appendChild(script);
