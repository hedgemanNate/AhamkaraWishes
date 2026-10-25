// Ahamkara Wishes — community wishlist submissions
//
// Every action verifies the caller's Bungie identity server-side (see
// _shared/bungie.ts) — the client never gets to assert its own membership ID
// or display name. Regular users cap at 5 published wishlists; anyone with a
// row in `creators` caps at 50. Submitted lists are cleaned with the
// extension's import rules before they are stored (_shared/submission.js).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { verifyBungieUser } from "../_shared/bungie.ts";
import { getServiceClient } from "../_shared/supabaseAdmin.ts";
// The extension's own import rules, so the server stores only what the
// extension would accept. Copies kept identical by tools/sync-edge-shared.js.
import "../_shared/client/aw-dom.js";
import "../_shared/client/wishlist-validate.js";
import "../_shared/submission.js";

type Submission =
  | { ok: true; row: Record<string, unknown>; dropped: number }
  | { ok: false; status: number; error: string };
const { checkSubmission } = (globalThis as unknown as {
  AWSubmission: { checkSubmission: (body: unknown) => Submission };
}).AWSubmission;

const USER_CAP = 5;
const CREATOR_CAP = 50;
// Raw request ceiling, checked before parsing. The stored list is capped
// separately (after cleaning) in _shared/submission.js.
const MAX_REQUEST_BYTES = 4 * 1024 * 1024;

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function getCapFor(bungieName: string): Promise<number> {
  const supabase = getServiceClient();
  const { data } = await supabase
    .from("creators")
    .select("bungie_name")
    .eq("bungie_name", bungieName)
    .maybeSingle();
  return data ? CREATOR_CAP : USER_CAP;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  if (Number(req.headers.get("content-length") || 0) > MAX_REQUEST_BYTES) {
    return json({ error: "payload_too_large" }, 413);
  }
  let payload: Record<string, unknown>;
  try {
    const body = await req.text();
    if (body.length > MAX_REQUEST_BYTES) return json({ error: "payload_too_large" }, 413);
    payload = JSON.parse(body);
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  if (!payload || typeof payload !== "object") return json({ error: "invalid_json" }, 400);

  const { action, bungie_access_token } = payload as { action?: string; bungie_access_token?: string };
  if (!bungie_access_token) return json({ error: "missing_bungie_access_token" }, 400);

  let identity;
  try {
    identity = await verifyBungieUser(bungie_access_token);
  } catch (e) {
    return json({ error: "bungie_token_invalid", detail: (e as Error).message }, 401);
  }

  const supabase = getServiceClient();

  if (action === "whoami") {
    const cap = await getCapFor(identity.bungieName);
    const { count } = await supabase
      .from("wishlists")
      .select("id", { count: "exact", head: true })
      .eq("submitter_membership_id", identity.membershipId);
    return json({ ...identity, cap, submittedCount: count ?? 0 });
  }

  if (action === "submit") {
    // Validate before touching the database: a bad list costs no queries.
    const checked = checkSubmission(payload);
    if (!checked.ok) return json({ error: checked.error }, checked.status);

    const cap = await getCapFor(identity.bungieName);
    const { count } = await supabase
      .from("wishlists")
      .select("id", { count: "exact", head: true })
      .eq("submitter_membership_id", identity.membershipId);
    if ((count ?? 0) >= cap) {
      return json({ error: "submission_cap_reached", cap, submittedCount: count }, 403);
    }

    const { data, error } = await supabase
      .from("wishlists")
      .insert({
        ...checked.row,
        submitter_membership_id: identity.membershipId,
        submitter_bungie_name: identity.bungieName,
      })
      .select()
      .single();

    if (error) return json({ error: "insert_failed", detail: error.message }, 500);
    return json({ wishlist: data, dropped: checked.dropped });
  }

  if (action === "delete") {
    const { wishlist_id } = payload as { wishlist_id?: string };
    if (!wishlist_id) return json({ error: "missing_wishlist_id" }, 400);

    const { data: existing } = await supabase
      .from("wishlists")
      .select("id, submitter_membership_id")
      .eq("id", wishlist_id)
      .maybeSingle();

    if (!existing) return json({ error: "not_found" }, 404);
    if (existing.submitter_membership_id !== identity.membershipId) {
      return json({ error: "not_owner" }, 403);
    }

    const { error } = await supabase.from("wishlists").delete().eq("id", wishlist_id);
    if (error) return json({ error: "delete_failed", detail: error.message }, 500);
    return json({ success: true });
  }

  return json({ error: "unsupported_action" }, 400);
});
