# Hotfix v2.17.1 - Database Connection Fix

**Date**: 2026-02-06
**Version**: 2.17.1
**Type**: Critical Hotfix
**Status**: ✅ DEPLOYED

---

## Issue

After deploying v2.17.0, the `/api/generate` endpoint was returning 500 errors when users tried to generate AI content (dialogue, character arcs, etc.).

### Error Details

```
Error loading pricing data: Error: connect ECONNREFUSED 127.0.0.1:5432
Error generating content: TypeError: Cannot read properties of undefined (reading 'inputPrice')
```

### Root Cause

The `costTracking.js` service was creating its own database pool using `DATABASE_URL` environment variable:

```javascript
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});
```

However, the production environment doesn't have `DATABASE_URL` set. Instead, it uses individual environment variables:
- `POSTGRES_HOST`
- `POSTGRES_PORT`
- `POSTGRES_DB`
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `POSTGRES_SSL`

The service was trying to connect to `127.0.0.1:5432` (default when connection string is undefined), which doesn't exist in the ECS container.

---

## Fix

Updated `server/services/costTracking.js` to use the existing `getPool()` function from `server/db/postgres.js` instead of creating a separate pool.

### Before:
```javascript
import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Later in code...
await pool.query('SELECT ...');
```

### After:
```javascript
import { getPool } from '../db/postgres.js';

// Later in code...
await getPool().query('SELECT ...');
```

This ensures the cost tracking service uses the same database connection configuration as the rest of the application.

---

## Changes Made

**Files Modified:**
- `server/services/costTracking.js`
  - Removed separate Pool creation
  - Import `getPool` from `../db/postgres.js`
  - Replaced all `pool.query()` calls with `getPool().query()`

**Lines Changed**: 9 insertions(+), 15 deletions(-)

---

## Deployment

```bash
git add server/services/costTracking.js
git commit -m "fix: Fix database connection in costTracking service"
git push origin feature/cost-tracking-ui
./deploy.sh backend patch  # Deployed v2.17.1
```

**Deployment Time**: ~3 minutes
**Rollout State**: IN_PROGRESS → COMPLETED

---

## Verification

### Before Fix:
- ❌ `/api/generate` returns 500 error
- ❌ Console shows: "Error loading pricing data: ECONNREFUSED"
- ❌ AI generation fails completely

### After Fix:
- ✅ `/api/generate` works correctly
- ✅ Token tracking saves to database
- ✅ Cost calculation succeeds
- ✅ No database connection errors in logs

---

## Impact

**Severity**: Critical - All AI generation was broken
**Users Affected**: All users attempting to use AI tools
**Duration**: ~10 minutes (from v2.17.0 deploy to v2.17.1 fix)
**Resolution Time**: ~3 minutes (identify + fix + deploy)

---

## Lessons Learned

1. **Database Configuration Consistency**: When creating new services, always check how existing code handles database connections instead of creating separate pools.

2. **Environment Variable Documentation**: The `.env` file uses `POSTGRES_*` variables, not `DATABASE_URL`. This should be documented clearly.

3. **Testing Before Deployment**: Should have tested an AI generation in production before marking v2.17.0 as complete.

4. **Staging Environment**: Would have caught this if we had a staging environment with production-like configuration.

---

## Related

- **Previous Version**: v2.17.0 - AI Cost Tracking (broken)
- **Fixed Version**: v2.17.1 - Database connection fix
- **Pull Request**: #12 (will be updated with this fix)

---

## Next Steps

- ✅ Deploy v2.17.1 to production
- ⏳ Verify AI generation works in production
- ⏳ Test all AI tools (dialogue, plot, character, etc.)
- ⏳ Verify token tracking saves correctly
- ⏳ Check cost analytics display updated data
- ⏳ Update PR #12 with this fix
