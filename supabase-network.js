// Ahamkara Wishes — Supabase network helper.
//
// fetch() throws a generic `TypeError: Failed to fetch` for DNS failures,
// refused connections, CORS blocks, etc. — the browser's actual net::ERR_*
// reason (visible in devtools) never reaches JS. In practice the most likely
// cause here is a paused or deleted Supabase project (free-tier projects
// auto-pause after ~1 week with no traffic), so every fetch aimed at
// Supabase routes through this wrapper to surface that possibility directly
// instead of a bare "Failed to fetch".
//
// Used from both window contexts (sidepanel.html scripts) and the
// background.js service worker (via importScripts) — hence `self` below
// rather than `window`.
(function () {
  const SUPABASE_HOST = 'tqgewrylrjqfqzqlmmag.supabase.co';
  const SUPABASE_PROJECT_REF = 'tqgewrylrjqfqzqlmmag';

  async function supabaseFetch(url, options) {
    try {
      return await fetch(url, options);
    } catch (e) {
      if (String(url).includes(SUPABASE_HOST)) {
        const helpfulError = new Error(
          `Cannot reach Supabase (${SUPABASE_HOST}). This almost always means the ` +
          `project is paused or was deleted — free-tier Supabase projects auto-pause ` +
          `after about a week of no traffic. Check ` +
          `https://supabase.com/dashboard/project/${SUPABASE_PROJECT_REF} and resume it ` +
          `if it shows as paused. If the project IS active, this is more likely a local ` +
          `DNS/network/VPN issue blocking *.supabase.co. Original error: ${e.message}`
        );
        helpfulError.cause = e;
        helpfulError.isSupabaseUnreachable = true;
        throw helpfulError;
      }
      throw e;
    }
  }

  self.supabaseFetch = supabaseFetch;
})();
