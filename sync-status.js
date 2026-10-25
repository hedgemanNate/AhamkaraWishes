// Ahamkara Wishes — sync status model (D11).
//
// One pure function turns "what's going on" into exactly what the sync chip,
// the sync sheet and the banner should say, so every screen describes sync the
// same way and the wording is testable. No DOM, no storage, no clock: callers
// pass `now`.
//
//   const s = AWSync.describe({ signedIn: true, online: true, manifest: 'ready',
//                               syncing: false, lastSyncAt, now: Date.now() });
//   s.key      'ok' | 'syncing' | 'downloading' | 'nodata' | 'offline' |
//              'expired' | 'signedout' | 'paused' | 'error'
//   s.chip     { label, tone }          small status in the app bar
//   s.title / s.body                     the sync sheet
//   s.action   { kind, label } | null   the one thing to do about it
//   s.banner   { tone, text, action } | null   shown under the app bar, if any
//
// States are checked in priority order: a missing download explains more than
// "offline", offline explains more than a failed sync, and so on.

(function (root) {
  'use strict';

  const AUTO_SYNC_VISIBLE_MS = 30 * 1000; // matches manager.js VISIBLE_REFRESH_INTERVAL_MS

  /** "Just now", "45s", "3m", "2h", "4d". */
  function formatAgo(ms) {
    if (!(ms >= 0)) return '';
    const s = Math.floor(ms / 1000);
    if (s < 10) return 'Just now';
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 48) return `${h}h`;
    return `${Math.floor(h / 24)}d`;
  }

  /**
   * Sorts a failed sync into something we can explain.
   * @returns {'auth'|'maintenance'|'network'|'other'}
   */
  function classifyError(err) {
    if (!err) return 'other';
    const name = err.name || '', msg = String(err.message || err), code = err.code || err.ErrorCode || err.errorCode;
    // AuthError codes (bungie-auth-core.js): TRANSIENT means the sign-in server
    // couldn't be reached, which is a network problem, not a signed-out user.
    if (name === 'AuthError' && code === 'TRANSIENT') return 'network';
    if (name === 'AuthError' && code === 'CONFIG') return 'other';
    if (name === 'AuthError' || code === 'invalid_grant' || /not signed in|session (has )?expired|sign in again/i.test(msg)) return 'auth';
    // Bungie ErrorCode 5 is SystemDisabled: the API is down for maintenance.
    if (code === 5 || code === 'SystemDisabled' || /maintenance|SystemDisabled|ErrorCode[: ]+5\b/i.test(msg)) return 'maintenance';
    if (name === 'TypeError' && /fetch|network/i.test(msg)) return 'network';
    if (/failed to fetch|networkerror|network request failed|offline/i.test(msg)) return 'network';
    return 'other';
  }

  /**
   * @param {{signedIn:boolean, sessionExpired?:boolean, online?:boolean,
   *          manifest?:'ready'|'downloading'|'missing', manifestProgress?:number,
   *          syncing?:boolean, lastSyncAt?:number, lastError?:Error|object|null, now:number}} s
   */
  function describe(s) {
    const online = s.online !== false;
    const manifest = s.manifest || 'ready';
    const errKind = s.lastError ? classifyError(s.lastError) : null;
    const ago = s.lastSyncAt ? formatAgo(s.now - s.lastSyncAt) : '';
    const lastLine = s.lastSyncAt ? `Last synced ${ago === 'Just now' ? 'just now' : `${ago} ago`}.` : '';

    if (manifest === 'downloading') {
      // Without a progress figure (the download isn't measured yet) say so
      // plainly instead of showing a misleading 0%.
      const known = typeof s.manifestProgress === 'number';
      const pct = known ? Math.max(0, Math.min(100, Math.round(s.manifestProgress))) : null;
      return state('downloading', { label: known ? `${pct}%` : 'Loading', tone: 'busy' },
        'Getting game data…',
        'A one-time download of Bungie’s item data (about 200 MB). Your lists work now; search and the builders unlock when it’s done.',
        null,
        { tone: 'info', text: known ? `Getting game data · ${pct}%` : 'Getting game data…', action: null });
    }
    if (manifest === 'missing') {
      return state('nodata', { label: 'No game data', tone: 'danger' },
        'Game data isn’t downloaded',
        'Bungie’s item data (about 200 MB, one time) is needed to show perks and match rolls.',
        { kind: 'download', label: 'Download game data' },
        { tone: 'danger', text: 'Game data is missing, so perks can’t be shown.', action: { kind: 'download', label: 'Download' } });
    }
    if (!online) {
      return state('offline', { label: 'Offline', tone: 'danger' },
        'You’re offline',
        `Your wishes still work. Matching and Drops pick up again as soon as you’re back online.${lastLine ? ' ' + lastLine : ''}`,
        { kind: 'retry', label: 'Try again' },
        { tone: 'danger', text: 'You’re offline. Your wishes still work.', action: { kind: 'retry', label: 'Retry' } });
    }
    if (s.sessionExpired || (s.signedIn && errKind === 'auth')) {
      return state('expired', { label: 'Sign in', tone: 'danger' },
        'Your Bungie session ended',
        'Bungie sign-ins expire after a while. Sign in again to keep matching your inventory. Your wishes are untouched.',
        { kind: 'signin', label: 'Sign in again' },
        { tone: 'danger', text: 'Your Bungie session ended. Your wishes are safe.', action: { kind: 'signin', label: 'Sign in again' } });
    }
    if (!s.signedIn) {
      return state('signedout', { label: 'Sign in', tone: 'warning' },
        'Not signed in',
        'You can build and save wishes without signing in. Sign in with Bungie to see which ones you already own and to get Drops.',
        { kind: 'signin', label: 'Sign in with Bungie' },
        { tone: 'warning', text: 'Sign in with Bungie to see which of these you already own.', action: { kind: 'signin', label: 'Sign in' } });
    }
    if (s.syncing) {
      return state('syncing', { label: 'Syncing', tone: 'busy' },
        'Syncing your inventory…',
        'Asking Bungie for your characters and vault. This usually takes a few seconds.',
        null, null);
    }
    if (errKind === 'maintenance') {
      return state('paused', { label: 'Paused', tone: 'warning' },
        'Bungie is down for maintenance',
        `Bungie’s servers aren’t answering right now, which usually means maintenance. Nothing is wrong on your end; the panel keeps trying.${lastLine ? ' ' + lastLine : ''}`,
        { kind: 'retry', label: 'Try again' },
        { tone: 'warning', text: 'Bungie is down for maintenance. Matching picks up on its own.', action: null });
    }
    if (errKind) {
      return state('error', { label: 'Sync failed', tone: 'danger' },
        'Couldn’t sync your inventory',
        `Something went wrong talking to Bungie. It usually clears up on its own; try again in a moment.${lastLine ? ' ' + lastLine : ''}`,
        { kind: 'retry', label: 'Try again' }, null);
    }
    return state('ok', { label: ago || 'Synced', tone: 'ok' },
      'Synced',
      `${lastLine || 'Your inventory is up to date.'} While the panel is open it checks again every ${AUTO_SYNC_VISIBLE_MS / 1000} seconds.`,
      { kind: 'sync', label: 'Sync now' }, null);
  }

  function state(key, chip, title, body, action, banner) {
    return { key, chip, title, body, action, banner };
  }

  /**
   * Whether an automatic sync should run at all. Signed-out or expired users
   * are never retried against Bungie (it can only fail), and nothing runs
   * without game data or a connection.
   */
  function shouldAutoSync(s) {
    return !!s.signedIn && !s.sessionExpired && s.online !== false && (s.manifest || 'ready') === 'ready';
  }

  const AUTO_SYNC_MAX_BACKOFF_MS = 15 * 60 * 1000;

  /**
   * When the next automatic sync should run (ms timestamp), or null for "not
   * until something changes" (signing in, Sync now).
   *   lastAttemptAt  when the last sync finished, ok or not
   *   intervalMs     the normal cadence (30s visible, 5m hidden)
   *   failures       failed syncs in a row
   *   errorKind      classifyError() of the last failure
   * A signed-out or expired user is never retried: it can only fail. Other
   * failures back off, doubling the wait each time up to 15 minutes, so a
   * Bungie outage isn't hammered every 30 seconds.
   */
  function nextAutoSyncAt({ lastAttemptAt = 0, intervalMs, failures = 0, errorKind = null }) {
    if (failures > 0 && errorKind === 'auth') return null;
    const wait = failures > 0 ? Math.min(intervalMs * 2 ** failures, Math.max(intervalMs, AUTO_SYNC_MAX_BACKOFF_MS)) : intervalMs;
    return (lastAttemptAt || 0) + wait;
  }

  root.AWSync = { describe, shouldAutoSync, nextAutoSyncAt, classifyError, formatAgo, AUTO_SYNC_VISIBLE_MS, AUTO_SYNC_MAX_BACKOFF_MS };
})(typeof window !== 'undefined' ? window : globalThis);
