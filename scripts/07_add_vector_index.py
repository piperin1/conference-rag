"""
Fix: add a vector index so semantic search doesn't time out.
=============================================================
Without an index, match_sentences() compares the question against EVERY
sentence embedding (a full table scan) and hits the 8s statement timeout.

This script:
  1. Checks whether a vector index already exists, or is still being built
     (an earlier HNSW attempt can keep running after the web request times out).
  2. If not, builds an IVFFlat index, which builds in seconds instead of minutes.
  3. Sets match_sentences() to search 10 IVFFlat "lists" for better accuracy.

Both index types use vector_cosine_ops to match the <=> operator.

Usage:
    python scripts/07_add_vector_index.py
"""
import json
import sys
import time
import requests

with open('config.secret.json') as f:
    secrets = json.load(f)

URL = f"https://api.supabase.com/v1/projects/{secrets['SUPABASE_PROJECT_REF']}/database/query"
HEADERS = {"Authorization": f"Bearer {secrets['SUPABASE_ACCESS_TOKEN']}",
           "Content-Type": "application/json"}


def sql(query, timeout=95):
    r = requests.post(URL, headers=HEADERS, json={"query": query}, timeout=timeout)
    if r.status_code not in (200, 201):
        raise RuntimeError(f"{r.status_code}: {r.text[:300]}")
    return r.json()


def vector_indexes():
    return sql("""
        SELECT i.indexname, ix.indisvalid AS valid
        FROM pg_indexes i
        JOIN pg_class c ON c.relname = i.indexname
        JOIN pg_index ix ON ix.indexrelid = c.oid
        WHERE i.tablename = 'sentence_embeddings'
          AND (i.indexdef ILIKE '%hnsw%' OR i.indexdef ILIKE '%ivfflat%');
    """)


def build_in_progress():
    return sql("""
        SELECT phase, blocks_done, blocks_total
        FROM pg_stat_progress_create_index p
        JOIN pg_class c ON c.oid = p.relid
        WHERE c.relname = 'sentence_embeddings';
    """)


# 1. Wait out any build that's still running from the earlier attempt.
while True:
    progress = build_in_progress()
    if not progress:
        break
    p = progress[0]
    print(f"⏳ Earlier index build still running: {p['phase']} "
          f"({p['blocks_done']}/{p['blocks_total']} blocks). Checking again in 20s...")
    time.sleep(20)

existing = vector_indexes()
valid = [ix for ix in existing if ix['valid']]
if valid:
    print(f"✅ Vector index already exists: {valid[0]['indexname']}")
else:
    # Drop any half-built (invalid) leftovers, then build IVFFlat.
    for ix in existing:
        print(f"🧹 Dropping invalid index {ix['indexname']}")
        sql(f"DROP INDEX IF EXISTS {ix['indexname']};")

    # IVFFlat groups the vectors into `lists` clusters, then searches only the
    # clusters nearest the question. Rule of thumb: lists ≈ rows / 1000 → ~26;
    # we use 50 for a little extra speed.
    print("🔨 Building IVFFlat index (should take a few seconds)...")
    start = time.time()
    sql("""
        SET maintenance_work_mem = '128MB';
        CREATE INDEX sentence_embeddings_embedding_ivfflat_idx
        ON sentence_embeddings
        USING ivfflat (embedding vector_cosine_ops) WITH (lists = 50);
        ANALYZE sentence_embeddings;
    """)
    print(f"✅ IVFFlat index created in {time.time() - start:.0f}s")

    # By default IVFFlat only searches the 1 nearest cluster, which can miss
    # good matches. Searching 10 of the 50 clusters is still ~5x less work
    # than a full scan, with much better recall.
    sql("ALTER FUNCTION match_sentences(vector, int) SET ivfflat.probes = 10;")
    print("✅ match_sentences() now searches 10 clusters per query")

print("\n🎉 Done! Try a semantic search on your site.")
