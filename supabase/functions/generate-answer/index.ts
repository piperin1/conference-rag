import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, json } from "../_shared/cors.ts";
import { requireAuth } from "../_shared/auth.ts";

// generate-answer: the "G" in RAG.
// The browser has already done the "R" (retrieval): it embedded the question,
// found the closest sentences with match_sentences(), and pulled the full text
// of the top 3 talks. Here we "augment" GPT-4o's prompt with those talks and
// let it write an answer grounded in them.

type Talk = { title: string; speaker: string; text: string };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const auth = await requireAuth(req);
  if ("error" in auth) return auth.error;

  try {
    const { question, context_talks } = await req.json();
    if (!question || typeof question !== "string") {
      return json({ error: "Missing or invalid 'question'" }, 400);
    }
    if (!Array.isArray(context_talks) || context_talks.length === 0) {
      return json({ error: "'context_talks' must be a non-empty array" }, 400);
    }

    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) return json({ error: "OPENAI_API_KEY not configured" }, 500);

    // Number each talk so the model can cite it as [1], [2], [3].
    const context = (context_talks as Talk[])
      .map((t, i) => `[${i + 1}] "${t.title}" by ${t.speaker}\n${t.text}`)
      .join("\n\n---\n\n");

    // The system prompt sets the rules. "ONLY the provided talks" is what
    // keeps the model grounded instead of answering from its own memory.
    const systemPrompt =
      "You answer questions about General Conference talks of The Church of Jesus Christ " +
      "of Latter-day Saints. Use ONLY the talks provided. Cite the talks you draw from by " +
      "title and speaker (e.g. [1] \"Title\" by Speaker). If the talks don't answer the " +
      "question, say so plainly rather than guessing.";

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        temperature: 0.3, // low = stick closely to the sources
        max_tokens: 1000,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Talks:\n\n${context}\n\n---\n\nQuestion: ${question}` },
        ],
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return json({ error: err.error?.message ?? "OpenAI API error" }, res.status);
    }

    const data = await res.json();
    return json({ answer: data.choices[0].message.content });
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
