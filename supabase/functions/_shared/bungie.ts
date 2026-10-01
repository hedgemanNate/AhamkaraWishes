// Verifies a Bungie OAuth access token by calling GetMembershipsForCurrentUser
// directly against Bungie's API. This is the only source of truth for "who is
// making this request" — a membership ID or display name sent by the client
// is never trusted on its own.

export interface BungieIdentity {
  membershipId: string;
  bungieName: string;
}

export async function verifyBungieUser(accessToken: string): Promise<BungieIdentity> {
  const apiKey = Deno.env.get("BUNGIE_API_KEY") ?? "";
  const resp = await fetch("https://www.bungie.net/Platform/User/GetMembershipsForCurrentUser/", {
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "X-API-Key": apiKey,
    },
  });
  if (!resp.ok) throw new Error("invalid_bungie_token");

  const parsed = await resp.json().catch(() => null);
  const r = parsed?.Response;
  const memberships = r?.destinyMemberships;
  if (!Array.isArray(memberships) || memberships.length === 0) throw new Error("no_destiny_membership");

  // Bungie does not guarantee destinyMemberships[0] is the account the
  // player actually plays on — cross-save or multiple linked platforms can
  // reorder the array. primaryMembershipId (when present) is authoritative
  // and must be preferred; falling back to index 0 only when it's absent
  // (e.g. accounts with a single linked platform never set it).
  const primaryId = r?.primaryMembershipId;
  const membership =
    (primaryId && memberships.find((m: { membershipId?: string }) => m.membershipId === primaryId)) ||
    memberships[0];
  const membershipId = membership?.membershipId;
  if (!membershipId) throw new Error("no_destiny_membership");

  const user = r?.bungieNetUser || {};
  const bungieName =
    user.cachedBungieGlobalDisplayName ||
    user.uniqueName ||
    user.displayName ||
    membership.displayName ||
    "Unknown Guardian";

  return { membershipId: String(membershipId), bungieName: String(bungieName) };
}
