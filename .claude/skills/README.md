# Claude Skills for Story Writing Studio

This directory contains reusable Claude skills for common development tasks in the Story Writing Studio project.

## What are Claude Skills?

Claude Skills are structured workflows that guide Claude through specific tasks. Each skill is in its own directory with a `SKILL.md` file that contains:
- YAML frontmatter (name, description, allowed-tools)
- Step-by-step instructions
- Examples and best practices
- Common pitfalls to avoid

## Available Skills

### 🌿 Git & Workflow

**[create-feature-branch](./create-feature-branch/)**
- Creates feature branches with proper naming
- **Use when:** Starting any new task, feature, or bug fix
- **Key rule:** NEVER commit directly to main!

**[commit-changes](./commit-changes/)**
- Commits with conventional commit format
- **Use when:** Code changes are ready to commit
- **Key rule:** Always include Claude co-author line

**[create-pull-request](./create-pull-request/)**
- Creates PRs for code review
- **Use when:** ONLY after deploy, test, and user confirmation
- **Key rule:** Deploy-then-PR workflow!

### 🚀 Deployment & Testing

**[deploy-and-test](./deploy-and-test/)**
- Deploys to production and guides testing
- **Use when:** Changes committed and ready for production
- **Key rule:** Deploy BEFORE creating PR!

**[debug-production](./debug-production/)**
- Systematic production debugging
- **Use when:** Something isn't working in production
- **Key rule:** Check logs first!

### 🔧 Implementation

**[add-book-field](./add-book-field/)**
- Complete workflow for adding JSONB fields to books table
- **Use when:** Adding new book component fields
- **Key rule:** Update all 5 files (migration, repository, endpoints, dataService)

**[complete-workflow](./complete-workflow/)**
- End-to-end feature development workflow
- **Use when:** Starting feature from scratch or need full overview
- **Key rule:** Combines all skills in correct order

## Quick Start

### For a New Feature

```bash
1. Use: create-feature-branch
2. Make your code changes
3. Use: commit-changes
4. Use: deploy-and-test
5. Wait for user: "it works!"
6. Use: create-pull-request
7. User reviews and merges
```

### For a Bug Fix

```bash
1. Use: create-feature-branch (with bugfix/ prefix)
2. Fix the bug
3. Use: commit-changes
4. Use: deploy-and-test
5. Verify fix works
6. Wait for user confirmation
7. Use: create-pull-request
```

### For Adding Database Field

```bash
Use: add-book-field
(Follows complete workflow including all steps above)
```

### For Debugging

```bash
Use: debug-production
(Systematic troubleshooting guide)
```

## The Deploy-Then-PR Workflow

**Most Important Rule:**

```
✅ CORRECT: Deploy → Test → User Confirms → Create PR → Merge
❌ WRONG:   Create PR → Deploy → Test
```

**Why?**
- Production is the real test
- Don't merge broken code to main
- Easy rollback if issues found
- Clean git history with only working code

## Critical Rules

### Always
- ✅ Use feature branches, NEVER commit to main
- ✅ Deploy BEFORE creating PR
- ✅ Wait for user confirmation before PR
- ✅ Test in production thoroughly
- ✅ Check logs for errors
- ✅ Include Claude co-author in commits
- ✅ Wait 60 seconds after deployment

### Never
- ❌ Commit directly to main branch
- ❌ Create PR before deploying and testing
- ❌ Skip user confirmation step
- ❌ Merge PR yourself (user must merge)
- ❌ Deploy without waiting for stabilization
- ❌ Forget to check production logs

## Skill Structure

Each skill follows this structure:

```
skill-name/
  SKILL.md              # Main skill file
```

The `SKILL.md` file has:

```yaml
---
name: skill-name
description: What the skill does and when to use it
allowed-tools: [Write, Terminal, Read, Grep]
---

# Skill Name

Detailed instructions...
```

## Environment

- **Production URL:** https://story-writing.com
- **AWS Region:** eu-west-2
- **Cluster:** story-writing-cluster-sai
- **Database:** PostgreSQL (POSTGRES_ONLY mode)
- **Services:** story-writing-backend, story-writing-frontend

## Common Tasks Reference

### Deploy Backend
```bash
./deploy.sh backend patch
```

### Check Logs
```bash
aws logs tail /ecs/story-writing-backend --since 5m --region eu-west-2
```

### Check Database
```bash
node scripts/check-db-status.js
```

### Create PR
```bash
gh pr create --title "type: description" --body "details"
```

### Git Branch
```bash
git checkout -b feature/name
git push -u origin feature/name
```

## When to Use Each Skill

| Situation | Skill to Use |
|-----------|-------------|
| Starting new work | `create-feature-branch` |
| Ready to commit | `commit-changes` |
| Need to deploy | `deploy-and-test` |
| User confirmed it works | `create-pull-request` |
| Something not working | `debug-production` |
| Adding database field | `add-book-field` |
| Need full overview | `complete-workflow` |

## Best Practices

### Code Quality
- Write clear, descriptive commit messages
- Add comments for complex logic
- Follow field naming conventions (camelCase ↔ snake_case)
- Encrypt API keys before storage
- Include proper error handling

### Testing
- Test locally when possible
- Always test in production before PR
- Check both UI and logs
- Verify data persistence
- Test edge cases

### Git Workflow
- Use descriptive branch names
- Commit logical units of work
- Include co-author attribution
- Write detailed PR descriptions
- Wait for user to review and merge

## Field Naming Reference

**Frontend → Backend Mapping:**
```
bookTitle → title
targetAudience → target_audience
worldBuilding → world_building
chapterNumber → chapter_number
audioFiles → audio_files
comicPages → comic_pages
characterRefs → character_refs
animationProjects → animation_projects
```

**Rule:** Frontend uses camelCase, backend uses snake_case. Always map in dataService.

## Getting Help

If you encounter issues:
1. Check the relevant skill guide
2. Use `debug-production` for troubleshooting
3. Review `.claude/instructions.md` for detailed context
4. Check CloudWatch logs
5. Verify database state

## Documentation

- **Main Instructions:** `../.claude/instructions.md`
- **Migration Details:** `../../MIGRATION_STATUS.md`
- **Database Schema:** `../../server/db/schema.sql`
- **Deployment Guide:** `../../DEPLOYMENT.md`

## Version History

- **v1.0** - Initial skill set created
  - Git workflow skills
  - Deployment skills
  - Implementation skills
  - Debugging skills
  - Master workflow

---

**Remember: Quality over speed. Follow the proper workflow!**
