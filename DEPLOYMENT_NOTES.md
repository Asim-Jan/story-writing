# Deployment Notes for v2.16.0

## Database Migrations Required

Before deploying this version, the following database migrations **MUST** be run on the production database:

### 1. Continuity Analyses Table
```bash
psql $DATABASE_URL -f server/db/migrations/add_continuity_analyses.sql
```

This creates:
- `continuity_analyses` table for storing analysis history
- Indexes on `book_id`, `user_id`, and `score`
- Foreign key constraints to `books` and `users` tables

### 2. AI Generations Table
```bash
psql $DATABASE_URL -f server/db/migrations/add_ai_generations.sql
```

This creates:
- `ai_generations` table for tracking all AI generations
- Indexes on `user_id` and `tool_type`
- Foreign key constraints to `users` table

## Migration Command (Production)

Connect to your production database and run:

```bash
# Set your production database URL
export DATABASE_URL="your-production-database-url"

# Run migrations
psql $DATABASE_URL -f server/db/migrations/add_continuity_analyses.sql
psql $DATABASE_URL -f server/db/migrations/add_ai_generations.sql

# Verify tables were created
psql $DATABASE_URL -c "\dt continuity_analyses"
psql $DATABASE_URL -c "\dt ai_generations"
```

## Deployment Steps

1. **Run Database Migrations** (see above)
2. **Deploy Application**:
   ```bash
   ./deploy.sh all patch
   ```
3. **Verify Deployment**:
   - Check quota banner displays on book pages
   - Test continuity analysis saves to history
   - Test AI generation saves to history
   - Verify template selector works
   - Test batch generation (2-5 variations)

## New Features Summary

### Quota Tracking
- Real-time quota banner with progress bars
- Warning toasts at 80/90/95/100% thresholds
- Daily digest modal on first login if quota >80%

### Continuity Checker
- History tracking with comparison
- Incremental chapter-by-chapter analysis
- Custom focus areas selection
- Quick-fix suggestions with apply functionality

### AI Tools
- Generation history with filters
- Compare mode (up to 3 results)
- 30+ prompt templates across 7 categories
- Batch generation mode (2-5 variations)

## API Endpoints Added

- `GET /api/books/:bookId/continuity-history`
- `DELETE /api/continuity-analyses/:id`
- `GET /api/ai-generations`
- `DELETE /api/ai-generations/:id`
- `POST /api/generate-batch`
- Modified: `POST /api/analyze-continuity` (now accepts focusAreas, chapterIds)
- Modified: `POST /api/generate` (now saves to history)

## Rollback Plan

If issues occur:

1. **Revert Application**: Deploy previous version (2.15.1)
2. **Database**: Tables can remain (they won't interfere with old code)
3. **If needed, drop tables**:
   ```sql
   DROP TABLE IF EXISTS continuity_analyses CASCADE;
   DROP TABLE IF EXISTS ai_generations CASCADE;
   ```

## Notes

- All new tables use `ON DELETE CASCADE` for data integrity
- JSONB columns allow flexible storage of analysis/generation results
- localStorage used for client-side warning deduplication
- Batch generation uses temperature variation (0.7-1.1) for diversity
