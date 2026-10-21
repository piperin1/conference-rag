"""
Repair: insert any sentences that failed to import (e.g. a timed-out batch).

Compares scripts/output/sentences_with_embeddings.json against what's
actually in the database (by talk_id + sentence_num) and inserts ONLY the
missing rows, so nothing gets duplicated.

Usage:  python scripts/fix_missing_rows.py
"""
import json
from supabase import create_client

with open('config.public.json') as f:
    public = json.load(f)
with open('config.secret.json') as f:
    secrets = json.load(f)
client = create_client(public['SUPABASE_URL'], secrets['SUPABASE_SERVICE_KEY'])

with open('scripts/output/sentences_with_embeddings.json', encoding='utf-8') as f:
    records = json.load(f)

# 1. Collect every (talk_id, sentence_num) already in the database, 1000 at a time.
existing = set()
start = 0
while True:
    rows = client.table('sentence_embeddings') \
        .select('talk_id, sentence_num') \
        .order('id') \
        .range(start, start + 999).execute().data
    existing.update((r['talk_id'], r['sentence_num']) for r in rows)
    if len(rows) < 1000:
        break
    start += 1000
print(f"Rows in database: {len(existing):,}")

# 2. Find what's missing and insert it in small batches.
missing = [r for r in records if (r['talk_id'], r['sentence_num']) not in existing]
print(f"Missing rows:     {len(missing):,}")
for i in range(0, len(missing), 25):
    client.table('sentence_embeddings').insert(missing[i:i + 25]).execute()

# 3. Verify.
total = client.table('sentence_embeddings').select('id', count='exact').limit(1).execute().count
with_emb = client.table('sentence_embeddings').select('id', count='exact') \
    .not_.is_('embedding', 'null').limit(1).execute().count
print(f"\nTotal rows:           {total:,}  (expected {len(records):,})")
print(f"Rows with embeddings: {with_emb:,}")
