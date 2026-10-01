// Ahamkara Wishes — admin operations (creator management, moderation)
//
// The client-side Admin button is only rendered for one account, but that's
// cosmetic — real enforcement happens here. Every mutating action re-verifies
// the caller's Bungie token and checks the resulting membership ID against
// ADMIN_BUNGIE_MEMBERSHIP_ID (a Supabase secret, never shipped in the
// extension). Reads of wishlists/creators for the admin UI go through the
// public REST API directly (both tables are public-read); only writes route
// through here.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { verifyBungieUser } from "../_shared/bungie.ts";
import { getServiceClient } from "../_shared/supabaseAdmin.ts";

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const { action, bungie_access_token } = payload as { action?: string; bungie_access_token?: string };
  if (!bungie_access_token) return json({ error: "missing_bungie_access_token" }, 400);

  const adminId = Deno.env.get("ADMIN_BUNGIE_MEMBERSHIP_ID") ?? "";

  let identity;
  try {
    identity = await verifyBungieUser(bungie_access_token);
  } catch {
    // "check" is polled opportunistically after every sign-in — fail soft so
    // the extension just renders the non-admin UI instead of surfacing an error.
    if (action === "check") return json({ is_admin: false });
    return json({ error: "bungie_token_invalid" }, 401);
  }

  const isAdmin = !!adminId && identity.membershipId === adminId;

  if (action === "check") return json({ is_admin: isAdmin });

  if (!isAdmin) return json({ error: "not_admin" }, 403);

  const supabase = getServiceClient();

  if (action === "list_creators") {
    const { data, error } = await supabase.from("creators").select("*").order("display_name");
    if (error) return json({ error: "query_failed", detail: error.message }, 500);
    return json({ creators: data });
  }

  if (action === "add_creator" || action === "update_creator") {
    const { bungie_name, display_name, verified } = payload as {
      bungie_name?: string;
      display_name?: string;
      verified?: boolean;
    };
    if (!bungie_name || !display_name) return json({ error: "missing_fields" }, 400);

    const { data, error } = await supabase
      .from("creators")
      .upsert(
        {
          bungie_name: String(bungie_name).trim(),
          display_name: String(display_name).trim(),
          verified: verified !== false,
        },
        { onConflict: "bungie_name" }
      )
      .select()
      .single();
    if (error) return json({ error: "upsert_failed", detail: error.message }, 500);
    return json({ creator: data });
  }

  if (action === "remove_creator") {
    const { bungie_name } = payload as { bungie_name?: string };
    if (!bungie_name) return json({ error: "missing_bungie_name" }, 400);
    const { error } = await supabase.from("creators").delete().eq("bungie_name", bungie_name);
    if (error) return json({ error: "delete_failed", detail: error.message }, 500);
    return json({ success: true });
  }

  if (action === "feature_wishlist" || action === "unfeature_wishlist") {
    const { wishlist_id } = payload as { wishlist_id?: string };
    if (!wishlist_id) return json({ error: "missing_wishlist_id" }, 400);
    const { error } = await supabase
      .from("wishlists")
      .update({ featured: action === "feature_wishlist" })
      .eq("id", wishlist_id);
    if (error) return json({ error: "update_failed", detail: error.message }, 500);
    return json({ success: true });
  }

  if (action === "delete_wishlist") {
    const { wishlist_id } = payload as { wishlist_id?: string };
    if (!wishlist_id) return json({ error: "missing_wishlist_id" }, 400);
    const { error } = await supabase.from("wishlists").delete().eq("id", wishlist_id);
    if (error) return json({ error: "delete_failed", detail: error.message }, 500);
    return json({ success: true });
  }

  // Personal wishlist backup (admin-only, cross-browser sync). Keyed by the
  // caller's own Bungie membership ID — separate from the public `wishlists`
  // table above, which holds community submissions.
  if (action === "backup_get") {
    const { data, error } = await supabase
      .from("wishlist_backups")
      .select("dim_data, updated_at")
      .eq("membership_id", identity.membershipId)
      .maybeSingle();
    if (error) return json({ error: "query_failed", detail: error.message }, 500);
    return json({ dim_data: data?.dim_data ?? null, updated_at: data?.updated_at ?? null });
  }

  if (action === "backup_put") {
    const { dim_data } = payload as { dim_data?: unknown };
    if (!dim_data || typeof dim_data !== "object") return json({ error: "missing_dim_data" }, 400);
    const { data, error } = await supabase
      .from("wishlist_backups")
      .upsert(
        { membership_id: identity.membershipId, dim_data, updated_at: new Date().toISOString() },
        { onConflict: "membership_id" }
      )
      .select("updated_at")
      .single();
    if (error) return json({ error: "upsert_failed", detail: error.message }, 500);
    return json({ success: true, updated_at: data.updated_at });
  }

  return json({ error: "unsupported_action" }, 400);
});
