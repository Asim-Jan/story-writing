---
name: complete-workflow
description: End-to-end workflow for implementing a feature from start to merged PR. Use this when starting a new feature from scratch or when you need a complete overview of the full development cycle.
allowed-tools: [Write, Terminal, Read, Grep]
---

# Complete Feature Workflow

End-to-end workflow for implementing a feature from start to merged PR. This is the master workflow that combines all other skills.

## When to Use This Skill

- Starting a new feature from scratch
- Need complete overview of development cycle
- Want to ensure following all best practices
- Uncertain about any step in the process

## The Complete Workflow

This workflow follows the **deploy-then-PR** approach, which is critical to maintaining code quality.

## Phase 1: Planning and Setup

### Step 1: Understand the Requirement

**Questions to answer:**
- What needs to be built or fixed?
- What files will be affected?
- Are there database changes needed?
- What's the expected behavior?

### Step 2: Create Feature Branch

**Use the `create-feature-branch` skill:**

```bash
git checkout main
git pull origin main
git checkout -b <prefix>/<descriptive-name>
```

**Branch naming:**
- `feature/` - New features or enhancements
- `bugfix/` - Bug fixes
- `refactor/` - Code refactoring
- `hotfix/` - Critical production fixes

**Examples:**
- `feature/add-metadata-field`
- `bugfix/chapter-persistence`
- `refactor/simplify-data-service`

## Phase 2: Implementation

### Step 3: Make Code Changes

**For database field additions:**
Use the `add-book-field` skill for complete workflow.

**For bug fixes:**
1. Identify root cause
2. Make minimal necessary changes
3. Add comments explaining the fix
4. Ensure no unintended side effects

**For features:**
1. Implement feature code
2. Update related components
3. Add proper error handling
4. Add logging if appropriate
5. Update any documentation

**Key files often affected:**
- `server/index.js` - API endpoints
- `server/db/repositories/` - Database operations
- `server/db/dataService.js` - Data layer
- `server/db/migrations/` - Database schema
- `src/components/` - Frontend components

### Step 4: Test Locally (if possible)

```bash
# If database migration, run locally first
node scripts/run-migration.js <migration-file>.sql

# Check database
node scripts/check-db-status.js

# Start local server if needed
cd server
npm run dev

# Test the feature locally
```

**Note:** Full local testing may not be possible due to AWS services. Production testing is the ultimate verification.

## Phase 3: Commit and Push

### Step 5: Commit Changes

**Use the `commit-changes` skill:**

```bash
# Review what changed
git status
git diff

# Stage changes
git add <specific-files>

# Commit with proper format
git commit -m "type: concise description

- Detailed point 1
- Detailed point 2
- Detailed point 3

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

**Commit types:**
- `feat:` - New feature
- `fix:` - Bug fix
- `refactor:` - Code refactoring
- `docs:` - Documentation
- `chore:` - Build/tooling changes

### Step 6: Push to Remote

```bash
# First push (creates remote branch)
git push -u origin <feature-branch-name>

# Subsequent pushes
git push
```

## Phase 4: Deploy to Production

**⚠️ CRITICAL: This happens BEFORE creating PR!**

### Step 7: Deploy from Feature Branch

**Use the `deploy-and-test` skill:**

```bash
# VERIFY you're on feature branch, NOT main!
git branch

# Ensure working directory is clean
git status

# Deploy
./deploy.sh backend patch  # or 'all patch' if frontend changed
```

**Version increment guide:**
- `patch` - Bug fixes (2.2.1 → 2.2.2)
- `minor` - New features (2.2.0 → 2.3.0)
- `major` - Breaking changes (2.0.0 → 3.0.0)

### Step 8: Wait for ECS Stabilization

**CRITICAL: Wait 60-90 seconds for ECS health checks!**

The deployment process:
1. Docker images are built with correct platform
2. Images pushed to ECR
3. ECS pulls new images
4. New tasks start
5. Health checks run
6. Old tasks stop

Don't test until this completes!

### Step 9: Monitor Deployment

```bash
# Check service status
aws ecs describe-services \
  --cluster story-writing-cluster-sai \
  --services story-writing-backend \
  --region eu-west-2 \
  --query 'services[0].deployments[*].{status:status,rolloutState:rolloutState,runningCount:runningCount}'

# Look for: rolloutState: "COMPLETED"

# Check logs for errors
aws logs tail /ecs/story-writing-backend --since 2m --region eu-west-2
```

## Phase 5: Testing in Production

### Step 10: Test the Feature

**Go to: https://story-writing.com**

**Comprehensive testing checklist:**

**Basic functionality:**
- [ ] Application loads without errors
- [ ] Can log in successfully
- [ ] Navigate to relevant feature

**Specific feature testing:**
- [ ] Test the specific feature/fix you deployed
- [ ] Try edge cases (empty values, max values, etc.)
- [ ] Test error handling

**Data persistence:**
- [ ] Verify data saves correctly
- [ ] Refresh the page
- [ ] Verify data persists after refresh
- [ ] Check data structure is correct

**Browser checks:**
- [ ] Open DevTools (F12)
- [ ] Check Console for errors (should be none)
- [ ] Check Network tab for failed requests
- [ ] Verify API responses are correct

**Related features:**
- [ ] Test related features to ensure nothing broke
- [ ] Verify existing functionality still works

### Step 11: Verify Database (if applicable)

```bash
# Check database status
node scripts/check-db-status.js

# Query specific data
node -e "
import { getBook } from './server/db/dataService.js';
const book = await getBook('<book-id>');
console.log(JSON.stringify(book, null, 2));
"
```

### Step 12: Check Production Logs

```bash
# Watch logs while testing
aws logs tail /ecs/story-writing-backend --follow --region eu-west-2

# Or check for errors after testing
aws logs tail /ecs/story-writing-backend --since 5m --region eu-west-2 | grep -i error
```

## Phase 6: Fix Issues (if any)

### Step 13: If Issues Found

**Use the `debug-production` skill for systematic debugging.**

**Fix workflow:**

```bash
# 1. Make fixes on the same feature branch
# Edit files as needed

# 2. Commit the fixes
git add <files>
git commit -m "fix: Address issue found in testing

- Description of what was fixed
- Why it was broken
- How it's now fixed

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"

# 3. Push
git push

# 4. Re-deploy
./deploy.sh backend patch

# 5. Wait 60 seconds

# 6. Test again
```

**Repeat until everything works correctly!**

There's no shame in multiple iterations. Production testing often reveals issues that can't be caught locally.

## Phase 7: User Confirmation

### Step 14: Wait for User Confirmation

**⚠️ DO NOT PROCEED WITHOUT USER CONFIRMATION!**

**What to do:**
1. Inform user that changes are deployed
2. Ask user to test the feature
3. Wait for explicit confirmation

**Example messages:**
- "I've deployed the changes to production. Can you please test and confirm everything works correctly?"
- "The feature is live at https://story-writing.com. Please test and let me know if it works as expected."

**Wait for user to respond with:**
- "It works"
- "Looks good"
- "Confirmed"
- Or similar affirmation

**If user reports issues:**
- Go back to Phase 6 (Fix Issues)
- Do NOT create PR until user confirms it works

## Phase 8: Create Pull Request

**🚨 ONLY AFTER USER CONFIRMS FEATURES WORK!**

### Step 15: Create PR

**Use the `create-pull-request` skill:**

```bash
gh pr create --title "<type>: <concise description>" --body "
## Summary
<Brief description of what was added/fixed>

## Testing
- [x] Deployed to production (version <version>)
- [x] User confirmed features work correctly
- [x] No errors in production logs
- [x] Data persists correctly (if applicable)
- [x] Tested on https://story-writing.com

## Changes
- <List major changes>
- <Each change on its own line>
- <Be specific and complete>

## Database Changes
- <List migrations or schema changes>
- <Or 'None' if no database changes>

## Related Issues
<Reference any GitHub issues if applicable>

## Screenshots
<Add screenshots if UI changed>
"
```

### Step 16: Verify PR Created

```bash
# List PRs to verify
gh pr list

# View PR in browser
gh pr view --web
```

## Phase 9: Code Review and Merge

### Step 17: User Reviews PR

**What happens:**
1. User receives PR notification
2. User reviews the code changes
3. User may request changes or approve
4. User merges when satisfied

**Your role:**
- Wait for user feedback
- Address any requested changes
- Answer any questions

### Step 18: If Changes Requested

```bash
# 1. Make requested changes on feature branch
# Edit files as needed

# 2. Commit and push
git add <files>
git commit -m "fix: Address PR feedback

- Change 1
- Change 2

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
git push

# 3. PR automatically updates

# 4. May need to re-deploy and test if changes are significant
./deploy.sh backend patch
```

### Step 19: User Merges PR

**Wait for user to merge!**
- User will merge when satisfied
- Don't merge the PR yourself
- Feature branch will be deleted by GitHub (usually)

## Phase 10: Cleanup

### Step 20: Clean Up Local Branch

```bash
# After PR is merged by user
git checkout main
git pull origin main

# Delete local feature branch
git branch -d <feature-branch-name>

# Verify it's gone
git branch
```

Remote branch is usually auto-deleted by GitHub after merge.

## Complete Workflow Checklist

### Pre-Implementation
- [ ] Understand the requirement completely
- [ ] Create feature branch from latest main
- [ ] Verify NOT on main branch

### Implementation
- [ ] Make code changes
- [ ] Test locally if possible
- [ ] Code is clean and well-commented
- [ ] No debug code or console.logs left

### Commit
- [ ] Changes staged
- [ ] Commit message follows format
- [ ] Includes co-author line
- [ ] Pushed to remote

### Deployment (BEFORE PR!)
- [ ] Verify on feature branch
- [ ] Deploy to production
- [ ] Wait 60-90 seconds
- [ ] Monitor deployment status
- [ ] Check logs for errors

### Testing
- [ ] Test feature in production UI
- [ ] Verify data persistence
- [ ] Check browser console (no errors)
- [ ] Check backend logs (no errors)
- [ ] Test related features
- [ ] Verify database if applicable
- [ ] **User has confirmed it works**

### Pull Request (AFTER testing!)
- [ ] User has tested and confirmed
- [ ] Create PR with detailed description
- [ ] Include testing checklist
- [ ] Document all changes
- [ ] Wait for user review

### Merge & Cleanup
- [ ] User has reviewed PR
- [ ] User has merged PR
- [ ] Switch back to main
- [ ] Pull latest changes
- [ ] Delete feature branch

## Workflow Comparison

### ❌ WRONG Workflow

```
Create branch → Code → Commit → Create PR → Deploy → Test → Fix → Update PR
```

**Problems:**
- Broken code might get merged
- PR has to be updated multiple times
- Messy git history
- Hard to rollback

### ✅ CORRECT Workflow

```
Create branch → Code → Commit → Deploy → Test → Fix (if needed) → User Confirms → Create PR → Merge
```

**Benefits:**
- Only working code gets merged
- Clean git history
- Easy rollback (don't merge PR)
- Real production testing before code review

## Success Criteria

A feature is complete when ALL of these are true:
- ✅ Code committed to feature branch (NOT main)
- ✅ Deployed to production successfully
- ✅ Tested thoroughly in production UI
- ✅ **User confirms features work correctly**
- ✅ No errors in production logs
- ✅ Data persists correctly (if applicable)
- ✅ PR created with complete description
- ✅ User has reviewed and approved PR
- ✅ User has merged PR
- ✅ Feature branch cleaned up

## Common Mistakes to Avoid

### Critical Mistakes

- ❌ **Committing directly to main** - Always use feature branches!
- ❌ **Creating PR before deploying** - Deploy and test first!
- ❌ **Not waiting for user confirmation** - Must have explicit OK!
- ❌ **Merging PR yourself** - User must review and merge!

### Implementation Mistakes

- ❌ Forgetting to include field in API endpoint
- ❌ Not encrypting API keys before storage
- ❌ Using wrong data service methods
- ❌ Forgetting field name mappings (camelCase ↔ snake_case)
- ❌ Not adding JSON.stringify/parse for JSONB fields

### Workflow Mistakes

- ❌ Not testing in production before PR
- ❌ Skipping the 60-second wait after deploy
- ❌ Not checking production logs
- ❌ Not verifying database state
- ❌ Assuming it works without testing

## Remember

**Quality over speed!**

- Take time to test properly
- Wait for deployment to stabilize
- Get user confirmation before PR
- Follow the proper workflow
- Don't skip steps to save time

**A feature that works correctly is more valuable than a feature delivered quickly that has bugs.**

## Related Skills

- `create-feature-branch` - Detailed branch creation
- `commit-changes` - Detailed commit guidelines
- `deploy-and-test` - Detailed deployment process
- `debug-production` - Systematic debugging
- `add-book-field` - Adding database fields
- `create-pull-request` - Detailed PR creation

