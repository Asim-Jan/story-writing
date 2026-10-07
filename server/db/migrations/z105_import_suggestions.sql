-- Outline review (sai-chat-fast) suggestions for a book import:
-- {status: 'checking'|'done'|'failed'|'skipped', items: [{id, type, key, nextKey?, value, reason}], dismissed: [id]}.
-- Items point at a section's key (chapters[].key), so they survive the user's edits.
ALTER TABLE book_imports ADD COLUMN IF NOT EXISTS suggestions JSONB;
