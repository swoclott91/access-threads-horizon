(function () {
  const ENABLE_PARAM = 'at_debug_nav';
  const ENABLED_KEY = 'at-debug-nav-enabled';
  const STORAGE_KEY = 'at-debug-nav-log';
  const MAX_ENTRIES = 250;

  const searchParams = new URLSearchParams(window.location.search);
  const disableRequested = searchParams.get(ENABLE_PARAM) === '0';
  if (disableRequested) {
    try {
      sessionStorage.removeItem(ENABLED_KEY);
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore storage errors in debug-only code.
    }
    return;
  }

  const enabled = searchParams.get(ENABLE_PARAM) === '1' || sessionStorage.getItem(ENABLED_KEY) === '1';
  if (!enabled) return;

  try {
    sessionStorage.setItem(ENABLED_KEY, '1');
  } catch {
    // Ignore storage errors in debug-only code.
  }

  /** @type {Array<{ts: string, pageId: string, event: string, path: string, data: unknown}>} */
  let entries = [];
  try {
    const parsed = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '[]');
    entries = Array.isArray(parsed) ? parsed : [];
  } catch {
    entries = [];
  }

  const pageId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  /** @type {HTMLPreElement | null} */
  let logPre = null;

  /**
   * @param {unknown} value
   * @param {number} [depth]
   * @returns {unknown}
   */
  function sanitize(value, depth = 0) {
    if (value == null) return value;
    if (depth > 2) return '[MaxDepth]';

    if (value instanceof Error) {
      return {
        name: value.name,
        message: value.message,
        stack: value.stack ? value.stack.split('\n').slice(0, 4).join(' | ') : undefined,
      };
    }

    if (value instanceof URL) {
      return value.toString();
    }

    if (Array.isArray(value)) {
      return value.slice(0, 10).map((item) => sanitize(item, depth + 1));
    }

    if (typeof value === 'object') {
      const result = {};
      for (const [key, currentValue] of Object.entries(value).slice(0, 20)) {
        if (typeof currentValue === 'function') continue;
        result[key] = sanitize(currentValue, depth + 1);
      }
      return result;
    }

    if (typeof value === 'string') {
      return value.length > 400 ? `${value.slice(0, 400)}...` : value;
    }

    return value;
  }

  function persist() {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)));
    } catch {
      // Ignore storage errors in debug-only code.
    }
  }

  function refreshOverlay() {
    if (!logPre) return;
    logPre.textContent = JSON.stringify(entries, null, 2);
  }

  /**
   * @param {string} eventName
   * @param {unknown} [data]
   */
  function addEntry(eventName, data) {
    entries.push({
      ts: new Date().toISOString(),
      pageId: pageId,
      event: eventName,
      path: `${window.location.pathname}${window.location.search}${window.location.hash}`,
      data: sanitize(data),
    });
    entries = entries.slice(-MAX_ENTRIES);
    persist();
    refreshOverlay();

    try {
      console.debug('[AT DEBUG NAV]', eventName, data);
    } catch {
      // Ignore console issues in debug-only code.
    }
  }

  function clearEntries() {
    entries = [];
    persist();
    refreshOverlay();
  }

  function topResources() {
    return performance
      .getEntriesByType('resource')
      .slice()
      .sort((a, b) => b.duration - a.duration)
      .slice(0, 8)
      .map((entry) => ({
        name: entry.name,
        type: entry.initiatorType,
        durationMs: Math.round(entry.duration),
        transferSize: 'transferSize' in entry ? entry.transferSize : undefined,
      }));
  }

  function renderOverlay() {
    if (document.getElementById('at-debug-nav-overlay')) return;

    const details = document.createElement('details');
    details.id = 'at-debug-nav-overlay';
    details.style.position = 'fixed';
    details.style.right = '12px';
    details.style.bottom = '12px';
    details.style.zIndex = '2147483647';
    details.style.maxWidth = 'min(92vw, 420px)';
    details.style.maxHeight = '70vh';
    details.style.border = '1px solid rgba(0, 0, 0, 0.18)';
    details.style.borderRadius = '10px';
    details.style.background = 'rgba(255, 255, 255, 0.98)';
    details.style.boxShadow = '0 8px 24px rgba(0, 0, 0, 0.18)';
    details.style.color = '#111';
    details.style.font = '12px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

    const summary = document.createElement('summary');
    summary.textContent = 'AT Debug Nav';
    summary.style.cursor = 'pointer';
    summary.style.padding = '10px 12px';
    summary.style.fontWeight = '600';

    const controls = document.createElement('div');
    controls.style.display = 'flex';
    controls.style.gap = '8px';
    controls.style.padding = '0 12px 8px';

    const copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.textContent = 'Copy';
    copyButton.style.cursor = 'pointer';

    const clearButton = document.createElement('button');
    clearButton.type = 'button';
    clearButton.textContent = 'Clear';
    clearButton.style.cursor = 'pointer';

    const disableButton = document.createElement('button');
    disableButton.type = 'button';
    disableButton.textContent = 'Disable';
    disableButton.style.cursor = 'pointer';

    controls.append(copyButton, clearButton, disableButton);

    logPre = document.createElement('pre');
    logPre.style.margin = '0';
    logPre.style.padding = '0 12px 12px';
    logPre.style.maxHeight = '52vh';
    logPre.style.overflow = 'auto';
    logPre.style.whiteSpace = 'pre-wrap';
    logPre.style.wordBreak = 'break-word';

    copyButton.addEventListener('click', async () => {
      const payload = JSON.stringify(entries, null, 2);
      try {
        await navigator.clipboard.writeText(payload);
        addEntry('debug:copied-log');
      } catch {
        addEntry('debug:copy-failed');
      }
    });

    clearButton.addEventListener('click', () => {
      clearEntries();
      addEntry('debug:cleared-log');
    });

    disableButton.addEventListener('click', () => {
      try {
        sessionStorage.removeItem(ENABLED_KEY);
        sessionStorage.removeItem(STORAGE_KEY);
      } catch {
        // Ignore storage errors in debug-only code.
      }
      details.remove();
    });

    details.append(summary, controls, logPre);
    document.body.append(details);
    refreshOverlay();
  }

  addEntry('boot', {
    href: window.location.href,
    referrer: document.referrer,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    devicePixelRatio: window.devicePixelRatio,
    userAgent: navigator.userAgent,
    historyLength: history.length,
    connection: {
      effectiveType: navigator.connection?.effectiveType,
      saveData: navigator.connection?.saveData,
    },
    mainContent: {
      pageTransitionEnabled: document.getElementById('MainContent')?.dataset.pageTransitionEnabled,
      productTransition: document.getElementById('MainContent')?.dataset.productTransition,
      template: document.getElementById('MainContent')?.dataset.template,
    },
  });

  window.addEventListener('pageshow', (event) => {
    addEntry('window:pageshow', { persisted: event.persisted });
  });

  window.addEventListener('pagehide', (event) => {
    addEntry('window:pagehide', { persisted: event.persisted });
  });

  window.addEventListener('beforeunload', () => {
    addEntry('window:beforeunload');
  });

  document.addEventListener('visibilitychange', () => {
    addEntry('document:visibilitychange', { visibilityState: document.visibilityState });
  });

  window.addEventListener('online', () => addEntry('window:online'));
  window.addEventListener('offline', () => addEntry('window:offline'));
  window.addEventListener('popstate', () => addEntry('window:popstate'));
  window.addEventListener('pageswap', () => addEntry('window:pageswap'));
  window.addEventListener('pagereveal', () => addEntry('window:pagereveal'));

  window.addEventListener('error', (event) => {
    addEntry('window:error', {
      message: event.message,
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    addEntry('window:unhandledrejection', { reason: event.reason });
  });

  document.addEventListener(
    'click',
    (event) => {
      if (!(event.target instanceof Element)) return;
      const link = event.target.closest('a[href]');
      if (!(link instanceof HTMLAnchorElement)) return;

      addEntry('document:click-link', {
        href: link.href,
        text: link.textContent?.trim(),
        target: link.target,
        defaultPrevented: event.defaultPrevented,
      });
    },
    true
  );

  document.addEventListener(
    'submit',
    (event) => {
      if (!(event.target instanceof HTMLFormElement)) return;
      addEntry('document:submit', {
        action: event.target.action,
        method: event.target.method,
        id: event.target.id,
      });
    },
    true
  );

  ['pushState', 'replaceState'].forEach((methodName) => {
    const originalMethod = history[methodName];
    history[methodName] = function patchedHistoryMethod(state, title, url) {
      addEntry(`history:${methodName}`, { url: url == null ? window.location.href : String(url) });
      return originalMethod.call(this, state, title, url);
    };
  });

  if (typeof window.fetch === 'function') {
    const originalFetch = window.fetch.bind(window);
    window.fetch = function patchedFetch(input, init) {
      const request = input instanceof Request ? input : null;
      const url = request ? request.url : String(input);
      const method = init?.method || request?.method || 'GET';
      const requestId = `fetch-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

      addEntry('fetch:start', { requestId, method, url });

      return originalFetch(input, init)
        .then((response) => {
          addEntry('fetch:end', {
            requestId,
            method,
            url,
            finalUrl: response.url,
            status: response.status,
            ok: response.ok,
            redirected: response.redirected,
          });
          return response;
        })
        .catch((error) => {
          addEntry('fetch:error', {
            requestId,
            method,
            url,
            error: error,
          });
          throw error;
        });
    };
  }

  window.addEventListener(
    'load',
    () => {
      setTimeout(() => {
        const navigationEntry = performance.getEntriesByType('navigation')[0];
        addEntry('window:load', {
          navigation: navigationEntry
            ? {
                type: navigationEntry.type,
                domContentLoadedMs: Math.round(navigationEntry.domContentLoadedEventEnd),
                loadMs: Math.round(navigationEntry.loadEventEnd),
                transferSize: navigationEntry.transferSize,
                encodedBodySize: navigationEntry.encodedBodySize,
                decodedBodySize: navigationEntry.decodedBodySize,
              }
            : null,
          topResources: topResources(),
        });

        renderOverlay();
      }, 0);
    },
    { once: true }
  );
})();
