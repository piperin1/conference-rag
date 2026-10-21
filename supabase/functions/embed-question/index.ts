import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, json } from "../_shared/cors.ts";
import { requireAuth } from "../_shared/auth.ts";

// embed-question: turns a user's question into a 1,536-number vector
// using the SAME model we used for the talk sentences. Same model = same
// "coordinate system for meaning", so the vectors can be compared.
Deno.serve(async (req) => {
  // 1. Browsers send an OPTIONS "preflight" before the real POST to ask
  //    whether cross-origin requests are allowed. Just say yes.
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // 2. Only logged-in users get past this line.
  const auth = await requireAuth(req);
  if ("error" in auth) return auth.error;

  try {
    // 3. Validate input.
    const { question } = await req.json();
    if (!question || typeof question !== "string") {
      return json({ error: "Body must be { question: string }" }, 400);
    }

    // 4. The OpenAI key lives ONLY here on the server, set with
    //    `supabase secrets set`. The browser never sees it.
    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) return json({ error: "OPENAI_API_KEY not configured" }, 500);

    // 5. Ask OpenAI for the embedding.
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

    const data = await res.json();
    // 6. Send back just the vector: { embedding: [0.012, -0.034, ...] }
    return json({ embedding: data.data[0].embedding });
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
