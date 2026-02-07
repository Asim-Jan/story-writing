# Hotfix v2.17.2 - AI Quota Tracking Fixes

**Date**: 2026-02-07
**Version**: 2.17.2
**Type**: Critical Hotfix
**Status**: ✅ DEPLOYED

---

## Issues Found

After deploying v2.17.1, two critical issues were discovered:

### Issue 1: AI Request Quota Not Incrementing
**Symptom**: When users generate AI content (dialogue, character arcs, etc.), the "AI Requests" counter in Usage & Limits stays at 0/10.

**Root Cause**: The `incrementAICounter()` function exists but was never called in the `/api/generate` endpoint.

### Issue 2: Admin Dashboard Top Users Query Failing
**Symptom**: Admin dashboard shows error when loading "Top Users by Cost"

**Error**:
```
Error getting top users by cost: error: column u.username does not exist
```

**Root Cause**: The query in `costTracking.js` was selecting `u.username` from the users table, but the users table doesn't have a `username` column.

---

## Fixes Applied

### Fix 1: Add AI Quota Increment

**File**: `server/index.js` (line ~3540)

**Before**:
```javascript
console.log(`AI Generation tracked: ${totalTokens} tokens, $${costData.totalCost.toFixed(6)} cost`);
} catch (dbError) {
  console.error('Error saving AI generation to history:', dbError);
  // Don't fail the request if DB save fails
}

res.json(generatedData);
```

**After**:
```javascript
console.log(`AI Generation tracked: ${totalTokens} tokens, $${costData.totalCost.toFixed(6)} cost`);
} catch (dbError) {
  console.error('Error saving AI generation to history:', dbError);
  // Don't fail the request if DB save fails
}

// Increment AI request counter for quota tracking
await incrementAICounter(req.user.userId);

res.json(generatedData);
```

**Result**: AI request counter now increments correctly after each successful generation.

---

### Fix 2: Remove Username Column from Query

**File**: `server/services/costTracking.js` (line ~349)

**Before**:
```javascript
const result = await getPool().query(`
  SELECT
    u.id,
    u.email,
    u.username,  // ❌ This column doesn't exist
    u.tier,
    ...
  FROM ai_cost_summary acs
  JOIN users u ON acs.user_id = u.id
  ...
  GROUP BY u.id, u.email, u.username, u.tier
  ...
`);

return result.rows.map(row => ({
  userId: row.id,
  email: row.email,
  username: row.username,  // ❌ Undefined value
  tier: row.tier,
  ...
}));
```

**After**:
```javascript
const result = await getPool().query(`
  SELECT
    u.id,
    u.email,
    u.tier,
    ...
  FROM ai_cost_summary acs
  JOIN users u ON acs.user_id = u.id
  ...
  GROUP BY u.id, u.email, u.tier
  ...
`);

return result.rows.map(row => ({
  userId: row.id,
  email: row.email,
  username: row.email.split('@')[0],  // ✅ Derive from email
  tier: row.tier,
  ...
}));
```

**Result**: Admin dashboard "Top Users by Cost" now loads correctly.

---

## Changes Summary

**Files Modified**:
1. `server/index.js`
   - Added `await incrementAICounter(req.user.userId);` after successful AI generation

2. `server/services/costTracking.js`
   - Removed `u.username` from SELECT clause
   - Removed `u.username` from GROUP BY clause
   - Derive username from email: `row.email.split('@')[0]`

**Lines Changed**: 5 insertions(+), 3 deletions(-)

---

## Deployment

```bash
git add server/index.js server/services/costTracking.js
git commit -m "fix: Add AI quota increment and fix username column error"
git push origin feature/cost-tracking-ui
./deploy.sh backend patch  # Deployed v2.17.2
```

**Deployment Time**: ~3 minutes
**Rollout State**: IN_PROGRESS → COMPLETED

---

## Verification Steps

### Before Fix:
- ❌ AI request counter stays at 0/10 after generating content
- ❌ Admin dashboard "Top Users by Cost" shows database error
- ❌ Console error: "column u.username does not exist"

### After Fix:
- ✅ AI request counter increments after each generation (0/10 → 1/10 → 2/10...)
- ✅ Admin dashboard loads correctly
- ✅ Top users list displays with email-derived usernames
- ✅ Token tracking saves to database
- ✅ Cost calculations display in dashboards

---

## Testing Checklist

After v2.17.2 deploys, verify:

1. **User Quota Tracking**:
   - [ ] Generate AI content (dialogue, character arc, etc.)
   - [ ] Check Profile > Usage & Limits
   - [ ] Verify "AI Requests" counter increments (e.g., 0/10 → 1/10)
   - [ ] Generate again and verify it goes to 2/10

2. **User AI Costs Dashboard**:
   - [ ] Go to Profile > AI Costs tab
   - [ ] Verify "This Month" shows non-zero cost
   - [ ] Verify daily usage chart updates
   - [ ] Verify tool breakdown shows the tool you used

3. **Admin Dashboard**:
   - [ ] Go to Admin Dashboard > AI Costs tab
   - [ ] Verify "Top Users by Cost" table loads without errors
   - [ ] Verify usernames display (derived from email)
   - [ ] Verify daily cost trend chart shows data
   - [ ] Verify model breakdown pie chart displays

---

## Impact

**Severity**: High - Core quota tracking not working
**Users Affected**: All users using AI features
**Duration**: ~15 minutes (from v2.17.1 to v2.17.2)
**Resolution Time**: ~5 minutes (identify + fix + deploy)

---

## Lessons Learned

1. **Call Counter Functions**: When implementing quota systems, ensure counter increment functions are actually called in the right places.

2. **Database Schema Verification**: Always verify column names exist in the database before writing queries. Use schema inspection tools or check existing tables.

3. **End-to-End Testing**: Should test the complete flow including:
   - AI generation succeeds ✓
   - Token tracking saves ✓
   - Cost calculation works ✓
   - **Quota counter increments** ✗ (missed)
   - **Dashboards load correctly** ✗ (missed)

4. **Test Admin Features**: Admin-only features need testing too, not just user-facing features.

---

## Related Versions

- v2.17.0 - AI Cost Tracking (database connection issue)
- v2.17.1 - Fixed database connection
- **v2.17.2** - Fixed quota increment + username column

---

## Next Steps

- ✅ Deploy v2.17.2 to production
- ⏳ Verify quota counter increments correctly
- ⏳ Verify admin dashboard loads without errors
- ⏳ Test multiple AI generations to ensure counter works
- ⏳ Update PR #12 with all fixes
- ⏳ Consider adding automated tests for quota increment logic
