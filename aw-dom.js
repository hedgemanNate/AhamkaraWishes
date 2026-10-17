// Ahamkara Wishes — safe-rendering helpers shared by every view.
//
// Wishlist data is not trusted: Discover lists and .awwish files come from
// other people and are rendered as-is, so every string that reaches innerHTML
// must pass through escapeHtml(), and every icon URL through safeImageUrl().
// Loaded first in sidepanel.html so every other script can rely on the global.

(function (root) {
  'use strict';

  const BUNGIE_ORIGIN = 'https://www.bungie.net';

  const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  /** Escapes text for use in HTML content AND inside quoted attribute values. */
  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ESCAPES[c]);
  }

  /**
   * Returns an image URL that is safe to load, or '' when it isn't one of ours.
   * Only Bungie-hosted art is ever needed, so anything else — another host, a
   * data:/javascript: URL, a protocol-relative URL — is refused. Otherwise a
   * shared wishlist could make every viewer's panel fetch an image from a
   * server of the author's choosing and learn their IP address.
   * Bungie-relative paths ("/common/destiny2_content/...") get the origin added.
   */
  function safeImageUrl(value) {
    if (typeof value !== 'string') return '';
    const v = value.trim();
    if (!v || v.startsWith('//')) return '';
    if (v.startsWith('/')) {
      return /[\s"'<>\\]/.test(v) ? '' : BUNGIE_ORIGIN + v;
    }
    try {
      const u = new URL(v);
      if (u.protocol !== 'https:' || u.hostname !== 'www.bungie.net' || u.port || u.username || u.password) return '';
      return /[\s"'<>\\]/.test(u.href) ? '' : u.href;
    } catch (e) {
      return '';
    }
  }

  root.escapeHtml = escapeHtml;
  root.AWDom = { escapeHtml, safeImageUrl, BUNGIE_ORIGIN };
})(typeof window !== 'undefined' ? window : globalThis);
