"""
Custom Feature: Question Embedding Cache
========================================
Creates the question_embedding_cache table. The embed-question Edge Function
checks this table before calling OpenAI, so a repeated question costs nothing
and returns faster.

Usage:
    python scripts/06_create_cache_table.py
"""
import json
import sys
import requests

with open('config.secret.json') as f:
    secrets = json.load(f)

SQL = """
CREATE TABLE IF NOT EXISTS question_embedding_cache (
    question      TEXT PRIMARY KEY,          -- normalized question text
    embedding     vector(1536) NOT NULL,     -- same model/dimensions as the talks
    hit_count     INTEGER NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    last_used_at  TIMESTAMPTZ DEFAULT NOW()
);

-- RLS ON with NO policies = the anon and authenticated roles can't read or
-- write anything here. Only the service_role (used inside our Edge Function)
-- bypasses RLS. This prevents "cache poisoning": a user writing a bogus
-- embedding for a common question that every other user would then get.
ALTER TABLE question_embedding_cache ENABLE ROW LEVEL SECURITY;
"""

url = f"https://api.supabase.com/v1/projects/{secrets['SUPABASE_PROJECT_REF']}/database/query"
resp = requests.post(
    url,
    headers={"Authorization": f"Bearer {secrets['SUPABASE_ACCESS_TOKEN']}",
             "Content-Type": "application/json"},
    json={"query": SQL},
)
if resp.status_code in (200, 201):
    print("✅ question_embedding_cache table created (RLS on, service-role only)")
else:
    print(f"❌ Failed: {resp.status_code}\n{resp.text[:500]}")
    sys.exit(1)
