// CORS = Cross-Origin Resource Sharing.
// Your site lives on piperin1.github.io, but this function lives on
// xxxxx.supabase.co — a different "origin". Browsers block cross-origin
// requests unless the server replies with these headers saying it's allowed.
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Small helper so every response is JSON and carries the CORS headers.
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
