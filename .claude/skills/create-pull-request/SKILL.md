---
name: create-pull-request
description: Creates a pull request for code review. Use this ONLY AFTER deploying to production, testing, and receiving user confirmation that features work. This is the final step in the deploy-then-PR workflow.
allowed-tools: [Write, Terminal]
---

# Create Pull Request

Creates a pull request for code review. **CRITICAL: Only use AFTER deploying and testing in production!**

## When to Use This Skill

**ONLY use this skill when ALL of these are true:**
- ✅ Changes deployed to production (on feature branch)
- ✅ Tested thoroughly in production
- ✅ **User has explicitly confirmed features work correctly**
- ✅ No errors in production logs
- ✅ All data persists correctly

## ⚠️ Deploy-Then-PR Workflow

**NEVER create a PR before testing in production!**

The proper workflow is:
1. ✅ Deploy changes to production (on feature branch)
2. ✅ User tests and confirms features work correctly
3. ✅ **WAIT FOR USER CONFIRMATION** ← You are here
4. ✅ Create PR for code review
5. ✅ User reviews and merges PR

## Prerequisites

- ✅ Deployed to production
- ✅ Tested in production
- ✅ **User has confirmed "it works" / "looks good"**
- ✅ No errors in production logs
- ✅ On feature branch with all changes committed and pushed
- ✅ GitHub CLI (`gh`) installed and authenticated

## Steps

### 1. Verify Deployment Success

```bash
# Verify you're on feature branch
git branch

# Verify all changes are pushed
git status  # Should show "Your branch is up to date"

# Verify last commit
git log -1
```

### 2. Confirm User Has Tested

**Before proceeding, ensure:**
- User has tested the feature at https://story-writing.com
- User has explicitly said it works (e.g., "it works", "looks good", "confirmed")
- No outstanding issues reported by user

### 3. Create PR Using GitHub CLI

```bash
gh pr create --title "<type>: <concise description>" --body "
## Summary
<Brief description of what was added/fixed>

## Testing
- [x] Deployed to production (version <version>)
- [x] User confirmed features work correctly
- [x] No errors in production logs
- [x] Data persists correctly (if applicable)

## Changes
- <List major changes>
- <Each on its own line>

## Database Changes
- <List any migrations or schema changes>
- <Or write 'None' if no database changes>

## Related Issues
<Reference any GitHub issues if applicable, e.g., Fixes #123>
"
```

## PR Template Examples

### Feature PR

```bash
gh pr create --title "feat: Add metadata field for book info" --body "
## Summary
Added metadata field to books table to store author, genre, tagline, and other book information.

## Testing
- [x] Deployed to production (v2.2.5)
- [x] User confirmed metadata saves and loads correctly
- [x] No errors in production logs
- [x] Metadata persists across page refresh

## Changes
- Created migration: add_metadata_field.sql
- Updated BookRepository create/update methods
- Updated server/index.js API endpoints
- Added metadata field mapping in dataService
- Added JSON.stringify/parse for metadata field

## Database Changes
- Added metadata JSONB column to books table
- Migration tested on production database

## Related Issues
None
"
```

### Bugfix PR

```bash
gh pr create --title "fix: Chapters not persisting to database" --body "
## Summary
Fixed issue where book chapters were not saving to PostgreSQL database.

## Testing
- [x] Deployed to production (v2.2.4)
- [x] User confirmed chapters now persist correctly
- [x] No errors in production logs
- [x] Chapters survive page refresh

## Changes
- Added chapters field to API endpoint bookData object
- Fixed chapter sync in POST /api/books
- Fixed chapter sync in PUT /api/books/:id
- Verified field mapping in BookDataService

## Database Changes
None (used existing chapters table)

## Related Issues
Fixes #142
"
```

### Refactor PR

```bash
gh pr create --title "refactor: Simplify data service layer" --body "
## Summary
Refactored data service to reduce complexity and improve maintainability.

## Testing
- [x] Deployed to production (v2.2.6)
- [x] User confirmed all features still work
- [x] No errors in production logs
- [x] No functional changes, only code organization

## Changes
- Consolidated redundant field mapping functions
- Improved error handling consistency
- Added inline documentation
- Removed dead code

## Database Changes
None

## Related Issues
None
"
```

### 4. Verify PR Created

```bash
# List PRs to verify
gh pr list

# View PR in browser
gh pr view --web
```

## PR Review Process

### What Happens Next

1. User receives PR notification
2. User reviews the code changes
3. User may request changes or approve
4. User merges the PR when satisfied
5. Feature branch is deleted after merge

### If User Requests Changes

1. Make changes on the same feature branch
2. Commit and push changes
3. PR will automatically update
4. May need to re-deploy and test again
5. Update PR description if needed

## After PR is Merged

### Cleanup Local Branch

```bash
# Switch back to main
git checkout main

# Pull merged changes
git pull origin main

# Delete local feature branch
git branch -d <feature-branch-name>

# Verify branch is deleted
git branch
```

The remote branch is usually auto-deleted by GitHub after merge.

## Common Mistakes to Avoid

### ❌ WRONG Workflows

- Create PR → Deploy → Test
- Deploy → Create PR → Wait for user to test
- Create PR while user is still testing

### ✅ CORRECT Workflow

- Deploy → Test → User Confirms → Create PR → User Merges

### Other Mistakes

- ❌ Creating PR before user confirms it works
- ❌ Creating PR with unresolved issues
- ❌ Merging PR yourself (wait for user)
- ❌ Not including testing checklist in PR
- ❌ Vague PR descriptions

## PR Description Best Practices

### Include These Sections

- **Summary**: What was done and why
- **Testing**: Comprehensive checklist of what was tested
- **Changes**: Detailed list of code changes
- **Database Changes**: Any schema or data changes
- **Related Issues**: Link to GitHub issues if applicable

### Writing Good Summaries

- Be concise but complete
- Explain the "why" not just the "what"
- Include context for future reference
- Mention any tradeoffs or decisions made

## Verification Checklist

Before creating PR:
- [ ] Deployed to production
- [ ] User has tested
- [ ] User has confirmed it works
- [ ] No errors in logs
- [ ] All changes committed and pushed
- [ ] On feature branch (not main)

After creating PR:
- [ ] PR appears in GitHub
- [ ] PR description is complete
- [ ] Testing checklist is accurate
- [ ] All tests are marked complete
- [ ] User confirmation is documented

## GitHub CLI Reference

```bash
# Create PR
gh pr create

# Create PR with title and body
gh pr create --title "title" --body "body"

# List all PRs
gh pr list

# View PR details
gh pr view <number>

# View PR in browser
gh pr view --web

# Check PR status
gh pr status
```

## Critical Rules

- 🚨 **NEVER create PR before user confirmation**
- 🚨 **NEVER merge PR yourself** - wait for user
- ✅ **ALWAYS document testing in PR**
- ✅ **ALWAYS include version number in testing section**
- ✅ **ALWAYS wait for deployment to stabilize before testing**

