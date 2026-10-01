// Ahamkara Wishes — community wishlist submissions
//
// Every action verifies the caller's Bungie identity server-side (see
// _shared/bungie.ts) — the client never gets to assert its own membership ID
// or display name. Regular users cap at 5 published wishlists; anyone with a
// row in `creators` caps at 50.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { verifyBungieUser } from "../_shared/bungie.ts";
import { getServiceClient } from "../_shared/supabaseAdmin.ts";

const USER_CAP = 5;
const CREATOR_CAP = 50;

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

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

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
    const { title, game_mode, payload: listPayload } = payload as {
      title?: string;
      game_mode?: string;
      payload?: { name?: string; items?: Record<string, unknown> };
    };
    if (!title || !String(title).trim()) return json({ error: "missing_title" }, 400);
    if (!["pve", "pvp", "mixed"].includes(String(game_mode))) {
      return json({ error: "invalid_game_mode" }, 400);
    }
    if (!listPayload || typeof listPayload !== "object" || !listPayload.items) {
      return json({ error: "missing_payload" }, 400);
    }

    const cap = await getCapFor(identity.bungieName);
    const { count } = await supabase
      .from("wishlists")
      .select("id", { count: "exact", head: true })
      .eq("submitter_membership_id", identity.membershipId);
    if ((count ?? 0) >= cap) {
      return json({ error: "submission_cap_reached", cap, submittedCount: count }, 403);
    }

    const items = listPayload.items as Record<string, { static?: { type?: string } }>;
    const itemList = Object.values(items || {});
    const itemCount = itemList.length;
    const hasWeapons = itemList.some((it) => it?.static?.type === "weapon");
    const hasArmor = itemList.some((it) => it?.static?.type === "armor");

    const { data, error } = await supabase
      .from("wishlists")
      .insert({
        title: String(title).trim().slice(0, 120),
        game_mode,
        has_weapons: hasWeapons,
        has_armor: hasArmor,
        payload: listPayload,
        item_count: itemCount,
        submitter_membership_id: identity.membershipId,
        submitter_bungie_name: identity.bungieName,
      })
      .select()
      .single();

    if (error) return json({ error: "insert_failed", detail: error.message }, 500);
    return json({ wishlist: data });
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
