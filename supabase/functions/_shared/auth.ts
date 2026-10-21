import { createClient } from "jsr:@supabase/supabase-js@2";
import { json } from "./cors.ts";

// We deploy with --no-verify-jwt, so Supabase's gateway does NOT check
// who's calling. That means this function is the bouncer: it takes the
// user's login token (JWT) from the Authorization header and asks
// Supabase Auth "is this a real, unexpired session?"
//
// Without this check, anyone on the internet could call our function and
// spend YOUR OpenAI credits.
export async function requireAuth(
  req: Request,
): Promise<{ userId: string } | { error: Response }> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return { error: json({ error: "Missing Authorization header" }, 401) };
  }

  // SUPABASE_URL and SUPABASE_ANON_KEY are provided to every Edge Function
  // automatically — you don't set these yourself.
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    return { error: json({ error: "Invalid or expired session" }, 401) };
  }
  return { userId: user.id };
}
