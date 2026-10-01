import { createClient } from "jsr:@supabase/supabase-js@2";

// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically into
// every Edge Function's environment by the Supabase platform. The service
// role key bypasses RLS — intentional, since these functions are the only
// place writes to wishlists/creators are allowed to happen.
export function getServiceClient() {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, key);
}
