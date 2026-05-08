// Runs in the page world — has direct access to window.EventSource
// Injected by content.js via a <script> tag

(function () {
  const OriginalEventSource = window.EventSource;

  window.EventSource = function (url, init) {
    const es = new OriginalEventSource(url, init);

    console.log('[LD-SPIKE] EventSource opened:', url);

    // S2: intercept raw payload
    const originalAddEventListener = es.addEventListener.bind(es);

    es.addEventListener = function (type, listener, options) {
      if (type === 'message' || type === 'put' || type === 'patch') {
        const wrappedListener = function (e) {
          console.log('[LD-SPIKE] SSE event:', type, e.data);

          // S3: try to proxy MessageEvent.data before SDK sees it
          try {
            const raw = JSON.parse(e.data);

            // LD client SDK put format: flat object of flag objects, each with a `version` and `value`
            // e.g. {"my-flag": {"version":1,"flagVersion":1,"value":true,"variation":0,...}}
            const isLDPut = type === 'put' &&
              raw !== null &&
              typeof raw === 'object' &&
              !Array.isArray(raw) &&
              Object.keys(raw).length > 0 &&
              typeof Object.values(raw)[0] === 'object' &&
              'version' in Object.values(raw)[0];

            if (isLDPut) {
              console.log('[LD-SPIKE] LD put detected. Flags:', Object.keys(raw));

              // --- OVERRIDE INJECTION TEST ---
              // Find the first boolean flag and flip it
              for (const key of Object.keys(raw)) {
                const flag = raw[key];
                if (typeof flag.value === 'boolean') {
                  const original = flag.value;
                  raw[key] = { ...flag, value: !original };
                  console.log('[LD-SPIKE] Flipped flag:', key, original, '->', !original);
                  break;
                }
              }

              const proxied = Object.create(e, {
                data: { value: JSON.stringify(raw) }
              });
              listener(proxied);
              return;
            }

            // LD patch format: {"path":"/flags/key","data":{...}} or just {"version":...,"value":...}
            if (type === 'patch' && raw !== null && typeof raw === 'object') {
              console.log('[LD-SPIKE] LD patch detected:', raw);
            }
          } catch (_) {
            // not JSON, not LD — pass through untouched
          }

          listener(e);
        };

        originalAddEventListener(type, wrappedListener, options);
      } else {
        originalAddEventListener(type, listener, options);
      }
    };

    return es;
  };

  // Copy static properties
  window.EventSource.prototype = OriginalEventSource.prototype;
  window.EventSource.CONNECTING = OriginalEventSource.CONNECTING;
  window.EventSource.OPEN = OriginalEventSource.OPEN;
  window.EventSource.CLOSED = OriginalEventSource.CLOSED;

  console.log('[LD-SPIKE] window.EventSource patched');
})();
