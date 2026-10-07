-- One structure everywhere: a database built from scratch now ends up exactly
-- like prod (verified by diffing pg_dump -s of both, 2026-10-07).
--
-- On an EMPTY database index.js's inline "Phase" migrations run before
-- schema.sql creates books, so their changes were silently lost. Prod got
-- them, plus a hand-applied system_stats. Re-assert all of it here, after
-- schema.sql and the numbered files. Idempotent; on prod it changes nothing.

-- Template books have no owner (Phase 8 / 12_add_template_books). Without this
-- a fresh database refuses to seed the template gallery.
ALTER TABLE books ALTER COLUMN owner_id DROP NOT NULL;

-- A view's b.* is expanded when the view is CREATED. schema.sql creates
-- active_books before the migrations add 17 book columns, so a fresh build's
-- view lacked them. Recreate it now that every column exists.
DROP VIEW IF EXISTS active_books;
CREATE VIEW active_books AS
SELECT
  b.*,
  u.name as owner_name,
  u.email as owner_email,
  u.tier as owner_tier
FROM books b
JOIN users u ON b.owner_id = u.id
WHERE b.deleted_at IS NULL AND u.deleted_at IS NULL;

-- The admin dashboard's counts. Prod's (hand-applied) version leaves deleted
-- chapters out of total_chapters; 06's counted them.
CREATE OR REPLACE VIEW system_stats AS
 SELECT ( SELECT count(*) AS count
           FROM public.users
          WHERE (users.deleted_at IS NULL)) AS total_users,
    ( SELECT count(*) AS count
           FROM public.users
          WHERE ((users.deleted_at IS NULL) AND ((users.tier)::text = 'free'::text))) AS free_users,
    ( SELECT count(*) AS count
           FROM public.users
          WHERE ((users.deleted_at IS NULL) AND ((users.tier)::text = 'basic'::text))) AS basic_users,
    ( SELECT count(*) AS count
           FROM public.users
          WHERE ((users.deleted_at IS NULL) AND ((users.tier)::text = 'premium'::text))) AS premium_users,
    ( SELECT count(*) AS count
           FROM public.users
          WHERE ((users.deleted_at IS NULL) AND ((users.status)::text = 'suspended'::text))) AS suspended_users,
    ( SELECT count(*) AS count
           FROM public.users
          WHERE ((users.deleted_at IS NULL) AND ((users.status)::text = 'banned'::text))) AS banned_users,
    ( SELECT count(*) AS count
           FROM public.books
          WHERE (books.deleted_at IS NULL)) AS total_books,
    ( SELECT COALESCE(sum(books.word_count), (0)::bigint) AS "coalesce"
           FROM public.books
          WHERE (books.deleted_at IS NULL)) AS total_words,
    ( SELECT count(*) AS count
           FROM public.chapters
          WHERE (chapters.deleted_at IS NULL)) AS total_chapters,
    ( SELECT count(*) AS count
           FROM public.jobs
          WHERE (jobs.created_at > (now() - '24:00:00'::interval))) AS jobs_last_24h,
    ( SELECT count(*) AS count
           FROM public.users
          WHERE ((users.created_at > (now() - '7 days'::interval)) AND (users.deleted_at IS NULL))) AS new_users_last_week;

COMMENT ON VIEW system_stats IS 'Real-time statistics for admin dashboard';

-- z103 restored these columns on prod without 09's comments
COMMENT ON COLUMN ai_generations.tokens_used IS 'DEPRECATED: Use total_tokens instead';
COMMENT ON COLUMN ai_generations.prompt_tokens IS 'Number of tokens in the prompt (input)';
COMMENT ON COLUMN ai_generations.completion_tokens IS 'Number of tokens in the completion (output)';
COMMENT ON COLUMN ai_generations.total_tokens IS 'Total tokens used (prompt + completion)';
COMMENT ON COLUMN ai_generations.estimated_cost_usd IS 'Estimated cost in USD based on model pricing';
