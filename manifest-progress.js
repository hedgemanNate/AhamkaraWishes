// Ahamkara Wishes — how far the game-data download has got.
//
// The item data is about 200 MB and arrives once, on first run. This reads a
// download as a stream so the panel can show a real percentage instead of a
// spinner, and keeps a running total across the several tables being fetched.
//
//   readWithProgress(response, onProgress)   same bytes as response.arrayBuffer()
//   AWManifestProgress.report(table, got, total)   called as bytes arrive
//   AWManifestProgress.percent()                   0-100, or null when unknown
//
// Works in the panel and the service worker (no DOM needed; the event is only
// sent where there is a document). Tests: tests/manifest-progress-test.js.

(function (root) {
  'use strict';

  /** Totals per table. A table with no known size doesn't count, rather than guessing. */
  function createTracker() {
    const tables = new Map();
    let shown = null;
    return {
      update(name, received, total) {
        tables.set(name, { received: Math.max(0, received || 0), total: Number(total) > 0 ? Number(total) : null });
      },
      /** 0-100, never going backwards (a table that starts late must not make it dip), or null. */
      percent() {
        let got = 0, all = 0;
        tables.forEach((t) => { if (t.total) { got += Math.min(t.received, t.total); all += t.total; } });
        if (!all) return null;
        const p = Math.min(99, Math.floor((got / all) * 100));
        shown = shown === null ? p : Math.max(shown, p);
        return shown;
      },
      reset() { tables.clear(); shown = null; }
    };
  }

  /**
   * Reads a response body, reporting (received, total) as it goes. `total` is
   * the Content-Length, or null when the server didn't say. Falls back to a
   * plain arrayBuffer() when the body can't be streamed.
   */
  async function readWithProgress(response, onProgress) {
    const total = Number(response.headers && response.headers.get && response.headers.get('content-length')) || null;
    if (!response.body || !response.body.getReader) {
      const buf = await response.arrayBuffer();
      if (onProgress) onProgress(buf.byteLength, total || buf.byteLength);
      return buf;
    }
    const reader = response.body.getReader();
    const chunks = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      if (onProgress) onProgress(received, total);
    }
    const out = new Uint8Array(received);
    let at = 0;
    chunks.forEach((c) => { out.set(c, at); at += c.length; });
    return out.buffer;
  }

  const tracker = createTracker();
  let lastSent = -1;

  /** One call per chunk is plenty; the event goes out only when the whole number changes. */
  function report(table, received, total) {
    tracker.update(table, received, total);
    const p = tracker.percent();
    if (p === null || p === lastSent) return;
    lastSent = p;
    if (root.document && typeof root.CustomEvent === 'function') root.document.dispatchEvent(new root.CustomEvent('awManifestProgress', { detail: { percent: p } }));
  }

  root.AWManifestProgress = { createTracker, readWithProgress, report, percent: () => tracker.percent(), reset() { tracker.reset(); lastSent = -1; } };
})(typeof window !== 'undefined' ? window : globalThis);
