// Ahamkara Wishes — Bungie OAuth token proxy
//
// Bungie only issues refresh tokens to *confidential* OAuth clients (those that
// present a client secret). A browser extension can't safely hold that secret,
// so this Edge Function holds it server-side and proxies the two token
// operations the extension needs:
//
//   POST { grant_type: "authorization_code", code, code_verifier, redirect_uri }
//   POST { grant_type: "refresh_token", refresh_token }
//
// The function injects the client secret via HTTP Basic auth, so Bungie treats
// the request as a confidential client and returns a 90-day refresh token.
//
// Required Supabase secrets (set via dashboard or `supabase secrets set`):
//   BUNGIE_CLIENT_ID       — e.g. 51511
//   BUNGIE_CLIENT_SECRET   — from the Bungie Developer Portal (Confidential app)
//   BUNGIE_API_KEY         — the app's API key
//
// Auth: verify_jwt is enabled, so callers must send the project's anon key as
// `Authorization: Bearer <ANON_KEY>` (public, safe to embed in the extension).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const BUNGIE_TOKEN_ENDPOINT = "https://www.bungie.net/platform/app/oauth/token/";

const CLIENT_ID = Deno.env.get("BUNGIE_CLIENT_ID") ?? "";
const CLIENT_SECRET = Deno.env.get("BUNGIE_CLIENT_SECRET") ?? "";
const API_KEY = Deno.env.get("BUNGIE_API_KEY") ?? "";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }
  if (!CLIENT_ID || !CLIENT_SECRET || !API_KEY) {
    return json({ error: "server_misconfigured", detail: "Missing Bungie secrets" }, 500);
  }

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const grantType = payload.grant_type;
  const body = new URLSearchParams();
  body.set("client_id", CLIENT_ID);

  if (grantType === "authorization_code") {
    const { code, code_verifier, redirect_uri } = payload as Record<string, string>;
    if (!code || !code_verifier || !redirect_uri) {
      return json({ error: "missing_params" }, 400);
    }
    body.set("grant_type", "authorization_code");
    body.set("code", code);
    body.set("code_verifier", code_verifier);
    body.set("redirect_uri", redirect_uri);
  } else if (grantType === "refresh_token") {
    const refresh = (payload as Record<string, string>).refresh_token;
    if (!refresh) {
      return json({ error: "missing_refresh_token" }, 400);
    }
    body.set("grant_type", "refresh_token");
    body.set("refresh_token", refresh);
  } else {
    return json({ error: "unsupported_grant_type" }, 400);
  }

  // Confidential-client auth: HTTP Basic base64(client_id:client_secret).
  const basic = btoa(`${CLIENT_ID}:${CLIENT_SECRET}`);

  const bungieResp = await fetch(BUNGIE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": `Basic ${basic}`,
      "X-API-Key": API_KEY,
    },
    body: body.toString(),
  });

  // Pass Bungie's response straight through (status + JSON body) so the
  // extension's existing error handling keeps working unchanged.
  const text = await bungieResp.text();
  return new Response(text, {
    status: bungieResp.status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
});
