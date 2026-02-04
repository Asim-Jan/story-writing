# Claude Code Instructions for Story Writing Studio

This document contains important context and guidelines for working on this project. All Claude Code sessions should follow these instructions.

---

## 🏗️ Project Overview

**Project**: Story Writing Studio - A comprehensive fiction writing application
**Tech Stack**: React (frontend), Node.js/Express (backend), PostgreSQL (database), Redis (sessions/cache)
**Deployment**: AWS ECS with Docker containers
**Domain**: https://story-writing.com

---

## 📋 Git Workflow - IMPORTANT

### Branch Strategy

**ALWAYS use feature branches** - NEVER commit directly to `main` branch!

1. **Create a feature branch for each task**:
   ```bash
   git checkout -b feature/descriptive-name
   # Examples:
   # - feature/fix-chapter-persistence
   # - feature/add-user-settings-api
   # - bugfix/api-key-encryption
   ```

2. **Branch naming conventions**:
   - `feature/` - New features or enhancements
   - `bugfix/` - Bug fixes
   - `hotfix/` - Critical production fixes
   - `refactor/` - Code refactoring
   - `docs/` - Documentation updates

3. **Commit workflow**:
   ```bash
   # Make changes
   git add <files>
   git commit -m "type: concise description

   - Detailed point 1
   - Detailed point 2

   Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"

   # Push to remote
   git push -u origin feature/branch-name
   ```

4. **Commit message format**:
   - `feat:` - New feature
   - `fix:` - Bug fix
   - `refactor:` - Code refactoring
   - `docs:` - Documentation
   - `test:` - Tests
   - `chore:` - Build/tooling changes

5. **Pull Request workflow**:
   - **IMPORTANT**: Deploy and test in production BEFORE creating PR
   - User must confirm features work correctly in production
   - Only after user confirmation, create PR from feature branch to `main`
   - Include description of changes
   - Reference any related issues
   - Wait for user approval before merging

### Example Workflow

```bash
# 1. Create branch
git checkout -b feature/add-metadata-field

# 2. Make changes and commit
git add server/db/migrations/add_metadata.sql
git commit -m "feat: Add metadata field to books table

- Added JSONB metadata column
- Updated BookRepository create/update methods
- Added field mapping in dataService

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"

# 3. Push branch
git push -u origin feature/add-metadata-field

# 4. Create PR (using gh CLI)
gh pr create --title "feat: Add metadata field for book info" --body "
## Summary
Added metadata field to store book information (author, genre, tagline, etc.)

## Changes
- Database migration: add_metadata.sql
- Updated BookRepository
- Updated API endpoints
- Updated dataService mapping

## Testing
- [x] Migration runs successfully
- [x] Book metadata saves to PostgreSQL
- [x] Metadata persists across page refresh
"

# 5. After approval, merge (or let user merge)
# Then clean up
git checkout main
git pull origin main
git branch -d feature/add-metadata-field
```

---

## 🚀 Deploy-Then-PR Workflow - CRITICAL

### Why This Matters

**NEVER create a PR before testing in production!**

The proper workflow is:
1. ✅ Deploy changes to production on feature branch
2. ✅ User tests and confirms features work correctly
3. ✅ Only then create PR for code review
4. ✅ User merges PR after review

### The Complete Workflow

**Step 1: Develop on Feature Branch**
```bash
git checkout -b feature/add-new-feature
# Make changes
git add .
git commit -m "feat: Add new feature

Details...

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
git push -u origin feature/add-new-feature
```

**Step 2: Deploy to Production**
```bash
# Deploy from the feature branch (still on feature branch!)
./deploy.sh all patch
# Wait 60 seconds for ECS to stabilize
```

**Step 3: User Testing**
- User tests the features at https://story-writing.com
- User confirms everything works correctly
- **CRITICAL**: Do NOT proceed until user confirms!

**Step 4: Create PR (Only After Confirmation)**
```bash
# Only after user says "it works!"
gh pr create --title "feat: Add new feature" --body "
## Summary
Description of what was added

## Testing
- [x] Deployed to production
- [x] User confirmed features work correctly
- [x] No errors in production logs

## Changes
- List of changes
"
```

**Step 5: User Reviews and Merges**
- User reviews the PR
- User merges when satisfied
- Feature branch is deleted

### Why This Workflow?

1. **Prevents broken code in main**: If feature doesn't work in production, we fix it on the feature branch before merging
2. **Real testing**: Production is the real test - staging can't catch everything
3. **Clean history**: Only working, tested code gets merged to main
4. **Easy rollback**: If something breaks, we just don't merge the PR

### Common Mistake to Avoid

**❌ WRONG WORKFLOW**:
```
Develop → Create PR → Deploy → Test → Fix → Update PR → Deploy → Test...
```

**✅ CORRECT WORKFLOW**:
```
Develop → Deploy → Test → Fix (if needed) → Deploy → Test → Confirm → Create PR → Merge
```

---

## 🗄️ Database Architecture

### Current State: PostgreSQL POSTGRES_ONLY Mode

**Feature Flags** (set in ECS task definition):
```bash
USE_POSTGRES=true
DUAL_WRITE=false
READ_FROM_POSTGRES=true
```

**This means**:
- ✅ All reads from PostgreSQL
- ✅ All writes to PostgreSQL
- ❌ Redis NOT used for book/user data (only sessions/cache)

### Database Schema

**PostgreSQL Tables**:
- `users` - User accounts and authentication
- `user_settings` - User preferences and encrypted API keys
- `api_keys` - API key storage (encrypted)
- `books` - Book metadata and components (JSONB)
- `chapters` - Book chapters (normalized, separate table)
- `chapter_versions` - Version history for chapters
- `collaborators` - Book collaboration permissions
- `jobs` - Background job queue

**Key Points**:
- Chapters are stored in separate `chapters` table, NOT as JSONB array in `books`
- Frontend sends `chapters` array, backend syncs to `chapters` table
- Field mapping: frontend camelCase → backend snake_case
- All JSONB fields must be JSON.stringify'd before database storage

### Field Name Mappings

**Frontend → Backend**:
```javascript
bookTitle → title
targetAudience → target_audience
worldBuilding → world_building
chapterNumber → chapter_number
audioFiles → audio_files
comicPages → comic_pages
characterRefs → character_refs
animationProjects → animation_projects
```

**Chapter Fields**:
- Frontend: `{ number, title, summary, content }`
- Backend: `{ chapter_number, title, notes, content }`
- Mapping: `number` → `chapter_number`, `summary` → `notes`

---

## 🔧 Common Tasks

### Adding a New Book Component Field

1. **Create migration**:
   ```sql
   ALTER TABLE books ADD COLUMN IF NOT EXISTS field_name JSONB DEFAULT '[]'::jsonb;
   ```

2. **Update BookRepository.create()**:
   - Add field to destructuring
   - Add to INSERT columns
   - Add JSON.stringify() in VALUES

3. **Update BookRepository.update()**:
   - Add to `allowedFields` array
   - Add to JSON stringify list

4. **Update server/index.js**:
   - Add to POST `/api/books` bookData object
   - Add to PUT `/api/books/:id` (both create and update branches)

5. **Update dataService.js**:
   - Add JSON.parse() if string
   - Add camelCase mapping
   - Add validation (ensure array/object exists)

6. **Deploy**:
   - Run migration locally: `node scripts/run-migration.js filename.sql`
   - Commit to feature branch
   - Deploy backend: `./deploy.sh backend patch`

### Fixing Chapter-Related Issues

**Remember**: Chapters are in a separate table!
- Frontend: `data.chapters` array
- Backend: `chapters` table with foreign key to `books.id`
- Sync happens in `BookDataService.syncChapters()`

**Chapter sync is triggered when**:
- `updates.chapters` exists in `BookDataService.update()`
- `bookData.chapters` exists in `BookDataService.create()`

**Make sure API endpoints include chapters**:
```javascript
const bookData = {
  // ... other fields
  chapters: req.body.chapters || [],  // ← MUST be included!
};
```

### Deploying Changes

**Version numbering** (Semantic Versioning):
- MAJOR: Breaking changes (e.g., 2.0.0 → 3.0.0)
- MINOR: New features (e.g., 2.1.0 → 2.2.0)
- PATCH: Bug fixes (e.g., 2.2.1 → 2.2.2)

**Deployment commands**:
```bash
# Backend only
./deploy.sh backend patch   # Auto-increments patch version
./deploy.sh backend minor   # Auto-increments minor version

# Frontend only
./deploy.sh frontend patch

# Both
./deploy.sh all patch
```

**Deployment checklist**:
1. ✅ Update VERSION file (or let deploy.sh do it)
2. ✅ Commit all changes to feature branch
3. ✅ Run deployment
4. ✅ Wait 45-60 seconds for ECS to stabilize
5. ✅ Test the changes in production
6. ✅ **WAIT for user confirmation that features work correctly**
7. ✅ Create PR only AFTER user confirms features work
8. ✅ Wait for user to review and merge PR

### Manual Build & Deploy Process

**IMPORTANT**: Always use the `--platform linux/amd64` flag and `--push` flag when building for AWS ECS!

**Quick Deploy (Recommended)**:
```bash
# Uses the deploy.sh script which handles everything automatically
./deploy.sh backend patch
```

**Manual Deploy Process** (if needed):
```bash
# 1. Login to ECR
aws ecr get-login-password --region eu-west-2 | \
  docker login --username AWS --password-stdin \
  220065406343.dkr.ecr.eu-west-2.amazonaws.com/story-writing

# 2. Build and push backend (MUST use --platform linux/amd64 and --push)
VERSION=$(cat VERSION)
docker buildx build --platform linux/amd64 \
  -t 220065406343.dkr.ecr.eu-west-2.amazonaws.com/story-writing/story-writing-backend:$VERSION \
  -t 220065406343.dkr.ecr.eu-west-2.amazonaws.com/story-writing/story-writing-backend:latest \
  -f Dockerfile.backend . --push

# 3. Build and push frontend (MUST use --build-arg for VITE_API_URL)
# IMPORTANT: Always set VITE_API_URL to production domain
VERSION=$(cat VERSION)
docker buildx build --platform linux/amd64 \
  --build-arg VITE_API_URL="https://story-writing.com" \
  -t 220065406343.dkr.ecr.eu-west-2.amazonaws.com/story-writing/story-writing-frontend:$VERSION \
  -t 220065406343.dkr.ecr.eu-west-2.amazonaws.com/story-writing/story-writing-frontend:latest \
  -f Dockerfile.frontend . --push

# 4. Force ECS to deploy new images
aws ecs update-service \
  --cluster story-writing-cluster-sai \
  --service story-writing-backend \
  --force-new-deployment \
  --region eu-west-2

aws ecs update-service \
  --cluster story-writing-cluster-sai \
  --service story-writing-frontend \
  --force-new-deployment \
  --region eu-west-2

# 5. Monitor deployment (wait 60-90 seconds for health checks)
aws ecs describe-services \
  --cluster story-writing-cluster-sai \
  --services story-writing-backend \
  --region eu-west-2 \
  --query 'services[0].deployments[*].{status:status,rolloutState:rolloutState,runningCount:runningCount}'
```

**Common Build Issues**:

1. **"Manifest does not contain descriptor matching platform 'linux/amd64'"**
   - ❌ WRONG: `docker build` or `docker buildx build` without `--platform`
   - ✅ RIGHT: `docker buildx build --platform linux/amd64 ... --push`

2. **Frontend API calls going to localhost instead of production**
   - ❌ WRONG: Building frontend without `--build-arg VITE_API_URL`
   - ✅ RIGHT: Always use `--build-arg VITE_API_URL="https://story-writing.com"`
   - **CRITICAL**: VITE environment variables are baked in at build time, not runtime!
   - The fallback in code (`import.meta.env.VITE_API_URL || 'https://story-writing.com'`) is for safety, but build arg should always be set

3. **Image not updating in ECS**
   - Make sure to use `--push` flag to push directly to ECR
   - Wait 60-90 seconds for ECS health checks to pass
   - Check deployment status with `aws ecs describe-services`

4. **Task failing to start**
   - Check ECS service events: `aws ecs describe-services ... --query 'services[0].events[0:5]'`
   - Check CloudWatch logs: `aws logs tail /ecs/story-writing-backend --since 5m`
   - Verify environment variables in task definition

---

## 🔐 Security Guidelines

### API Keys and Secrets

**ALWAYS encrypt API keys before storing**:
```javascript
const encryptedKey = encrypt(apiKey);  // Use the encrypt() function
```

**Never commit secrets**:
- API keys go in AWS Secrets Manager
- Update task definition to reference secrets:
  ```json
  "secrets": [
    {
      "name": "SECRET_NAME",
      "valueFrom": "arn:aws:secretsmanager:..."
    }
  ]
  ```

### User Settings

**Use the proper data service**:
```javascript
// ✅ CORRECT
await updateUserSettings(userId, settings);

// ❌ WRONG - doesn't work with PostgreSQL
await setRedisValue(key, value);
```

---

## 🧪 Testing

### Database Testing

**Check database status**:
```bash
node scripts/check-db-status.js
```

**Run migrations**:
```bash
node scripts/run-migration.js filename.sql
```

**Check PostgreSQL directly**:
```bash
node -e "
import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const pool = new pg.Pool({
  host: process.env.POSTGRES_HOST,
  port: parseInt(process.env.POSTGRES_PORT),
  database: process.env.POSTGRES_DB,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  ssl: { rejectUnauthorized: false }
});

// Your query here
const result = await pool.query('SELECT * FROM books LIMIT 1');
console.log(result.rows);
await pool.end();
"
```

### Testing Checklist

Before marking a fix complete:
1. ✅ Test locally if possible
2. ✅ Deploy to production
3. ✅ Test in production UI
4. ✅ Check backend logs: `aws logs tail /ecs/story-writing-backend --since 2m`
5. ✅ Verify database: `node scripts/check-db-status.js`
6. ✅ Test browser refresh to verify persistence

---

## 📝 Code Style

### Commits

**Always include co-author**:
```
Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>
```

**Write clear commit messages**:
```
feat: Add chapter persistence to PostgreSQL

- Created syncChapters() method in BookDataService
- Updated API endpoints to include chapters field
- Added field mapping (number → chapter_number, summary → notes)
- Chapters now persist to normalized chapters table

Fixes #123

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>
```

### Code Comments

**Add comments for**:
- Complex business logic
- Security-critical operations
- Migration phase logic
- Field mappings

**Example**:
```javascript
// SECURITY: Encrypt API keys before storing in database
const encryptedKey = encrypt(apiKey);

// Map frontend camelCase to backend snake_case
const updates = {
  target_audience: req.body.targetAudience,
  // ...
};
```

---

## 🚨 Common Pitfalls

### 1. Committing Directly to Main
**❌ WRONG**: `git commit -am "fix" && git push`
**✅ RIGHT**: Create feature branch, commit, PR

### 2. Forgetting to Include Chapters in API Endpoints
**❌ WRONG**:
```javascript
const updates = {
  title: req.body.title,
  // Missing chapters!
};
```
**✅ RIGHT**:
```javascript
const updates = {
  title: req.body.title,
  chapters: req.body.chapters,  // ← Include this!
};
```

### 3. Using Wrong Data Service Methods
**❌ WRONG**: `await setRedisValue(key, object)`
**✅ RIGHT**: `await updateUserSettings(userId, settings)`

### 4. Not Encrypting API Keys
**❌ WRONG**: Store plain API key
**✅ RIGHT**: `encrypt(apiKey)` before storage

### 5. Forgetting Field Name Mapping
**❌ WRONG**: Use frontend field names in backend
**✅ RIGHT**: Map camelCase → snake_case

### 6. Not Testing After Deployment
**❌ WRONG**: Deploy and assume it works
**✅ RIGHT**: Test in production, check logs, verify database

---

## 🔄 Migration Context

### Historical Context

**Timeline**:
- v2.0.0 - Added PostgreSQL schema
- v2.0.21 - Added notes, timelines, visuals
- v2.0.23 - Added audio, comics, character refs, animations
- v2.0.24 - Added metadata field
- v2.0.26 - Added chapter sync logic
- v2.2.0 - Enabled POSTGRES_ONLY mode
- v2.2.4 - Fixed chapters field in API endpoints
- v2.2.8 - Fixed user settings API

**Current State**: Phase 4 - POSTGRES_ONLY
- All data in PostgreSQL
- Redis only for sessions/cache
- Migration complete ✅

---

## 📚 Useful Commands

### Git
```bash
# Create feature branch
git checkout -b feature/name

# Check current branch
git branch

# Push feature branch
git push -u origin feature/name

# Create PR
gh pr create --title "Title" --body "Description"

# List PRs
gh pr list

# Merge PR
gh pr merge <number>
```

### AWS
```bash
# Check logs
aws logs tail /ecs/story-writing-backend --since 5m

# Check service status
aws ecs describe-services --cluster story-writing-cluster-sai --services story-writing-backend --region eu-west-2

# Check task definition
aws ecs describe-task-definition --task-definition story-writing-backend --region eu-west-2
```

### Database
```bash
# Check database status
node scripts/check-db-status.js

# Run migration
node scripts/run-migration.js filename.sql

# Clear PostgreSQL data (DANGEROUS!)
node scripts/clear-postgres-data.js
```

### Deployment
```bash
# Deploy backend patch
./deploy.sh backend patch

# Deploy with specific version
# Edit VERSION file first, then:
./deploy.sh backend
```

---

## 🎯 Quick Reference

### When Starting a New Task

1. Create feature branch: `git checkout -b feature/task-name`
2. Make changes
3. Test locally if possible
4. Commit: `git commit -m "type: description\n\ndetails\n\nCo-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"`
5. Push: `git push -u origin feature/task-name`
6. Deploy: `./deploy.sh backend patch` (or `all patch` if frontend changed)
7. Test in production
8. **WAIT for user to confirm features work correctly**
9. Create PR only after user confirmation: `gh pr create`
10. User will review and merge the PR

### When Debugging

1. Check logs: `aws logs tail /ecs/story-writing-backend --since 5m`
2. Check database: `node scripts/check-db-status.js`
3. Check feature flags in task definition
4. Verify API endpoint includes all fields
5. Check field name mappings

---

## 📞 Getting Help

**If you encounter issues**:
1. Check backend logs first
2. Verify database state
3. Check if field names are mapped correctly
4. Ensure PostgreSQL mode is enabled
5. Review this document for common pitfalls

**Documentation locations**:
- `/Users/asim.solutionsai/Projects/story-writing/MIGRATION_STATUS.md` - Migration details
- `/Users/asim.solutionsai/Projects/story-writing/.claude/instructions.md` - This file
- `/Users/asim.solutionsai/Projects/story-writing/server/db/schema.sql` - Database schema

---

## ✅ Success Criteria

**A task is complete when**:
1. ✅ Code committed to feature branch (NOT main)
2. ✅ Tests pass locally (if applicable)
3. ✅ Deployed to production
4. ✅ Tested in production UI
5. ✅ Database verified (if applicable)
6. ✅ **User confirms features work correctly in production**
7. ✅ PR created for user review (only after user confirmation)
8. ✅ No errors in logs
9. ✅ User approves and merges PR

**Remember**: Quality over speed. Take time to follow the proper workflow!
