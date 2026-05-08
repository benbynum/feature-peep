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

            // If this looks like an LD put payload, mutate one flag for testing
            if (raw && raw.flags) {
              console.log('[LD-SPIKE] LD put detected. Flags:', Object.keys(raw.flags));

              // --- OVERRIDE INJECTION TEST ---
              // Find the first boolean flag and flip it
              for (const key of Object.keys(raw.flags)) {
                const flag = raw.flags[key];
                if (typeof flag.value === 'boolean') {
                  const original = flag.value;
                  raw.flags[key] = { ...flag, value: !original };
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

            // patch event
            if (raw && raw.data && raw.data.value !== undefined) {
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
