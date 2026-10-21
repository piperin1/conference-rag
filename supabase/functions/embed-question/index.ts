import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import { requireAuth } from "../_shared/auth.ts";

// embed-question: turns a user's question into a 1,536-number vector using
// the SAME model we used for the talk sentences, so the vectors are comparable.
//
// CUSTOM FEATURE — embedding cache:
//   Embeddings are deterministic enough that the same question always maps to
//   (essentially) the same vector. So we look the question up in
//   question_embedding_cache first and only pay OpenAI on a cache miss.

// Service-role client: bypasses RLS so it can use the cache table, which
// normal users can't touch. SUPABASE_SERVICE_ROLE_KEY is provided to Edge
// Functions automatically and never leaves the server.
const admin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

// "What is Faith?" and "  what is faith " should share one cache entry.
function normalize(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, " ").replace(/[?.!]+$/, "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const auth = await requireAuth(req);
  if ("error" in auth) return auth.error;

  try {
    const { question } = await req.json();
    if (!question || typeof question !== "string") {
      return json({ error: "Body must be { question: string }" }, 400);
    }
    const key = normalize(question);

    // 1. Cache lookup. If anything goes wrong here we just fall through to
    //    OpenAI — the cache should make things faster, never break them.
    try {
      const { data: hit } = await admin
        .from("question_embedding_cache")
        .select("embedding, hit_count")
        .eq("question", key)
        .maybeSingle();

      if (hit) {
        await admin
          .from("question_embedding_cache")
          .update({ hit_count: hit.hit_count + 1, last_used_at: new Date().toISOString() })
          .eq("question", key);
        // pgvector columns come back from the API as a string "[0.01,...]"
        const embedding = typeof hit.embedding === "string"
          ? JSON.parse(hit.embedding)
          : hit.embedding;
        return json({ embedding, cached: true });
      }
    } catch (e) {
      console.warn("Cache lookup failed, using OpenAI:", e);
    }

    // 2. Cache miss: ask OpenAI. The key lives only here on the server.
    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) return json({ error: "OPENAI_API_KEY not configured" }, 500);

    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: "text-embedding-3-small", input: question }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return json({ error: err.error?.message ?? "OpenAI API error" }, res.status);
    }

    const embedding = (await res.json()).data[0].embedding;

    // 3. Save it for next time (ignore if another request saved it first).
    const { error: saveErr } = await admin
      .from("question_embedding_cache")
      .upsert({ question: key, embedding }, { onConflict: "question", ignoreDuplicates: true });
    if (saveErr) console.warn("Cache save failed:", saveErr.message);

    return json({ embedding, cached: false });
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
