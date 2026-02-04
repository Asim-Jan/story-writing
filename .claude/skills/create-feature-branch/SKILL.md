---
name: create-feature-branch
description: Creates a new feature branch following project branching conventions. Use this when starting any new task, feature, or bug fix. NEVER commit directly to main branch!
allowed-tools: [Write, Terminal]
---

# Create Feature Branch

Creates a new feature branch following the project's branching strategy. **NEVER commit directly to main!**

## When to Use This Skill

- Starting any new feature or enhancement
- Beginning bug fix work
- Starting refactoring work
- Any time you need to make code changes

## Branch Naming Conventions

- `feature/` - New features or enhancements
- `bugfix/` - Bug fixes
- `hotfix/` - Critical production fixes
- `refactor/` - Code refactoring
- `docs/` - Documentation updates

## Steps

### 1. Check Current Status and Pull Latest

```bash
git status
git branch  # Verify current branch

# Switch to main and pull latest
git checkout main
git pull origin main
```

### 2. Create Feature Branch

```bash
git checkout -b <prefix>/<descriptive-name>
```

**Examples:**
- `git checkout -b feature/add-metadata-field`
- `git checkout -b feature/chapter-persistence`
- `git checkout -b bugfix/api-key-encryption`
- `git checkout -b refactor/cleanup-data-service`
- `git checkout -b hotfix/critical-auth-fix`

### 3. Verify New Branch

```bash
git branch  # Should show * next to new branch name
```

## Best Practices

- **Descriptive names**: Use clear, specific names that describe the work
- **Lowercase with hyphens**: `feature/add-user-settings` not `feature/AddUserSettings`
- **Short but clear**: Aim for 3-5 words maximum
- **Based on main**: Always branch from latest main

## Verification

- ✅ Run `git branch` to confirm you're on the new branch
- ✅ New branch should be based on latest main
- ✅ Working directory should be clean

## Next Steps

After creating the feature branch:
1. Make your code changes
2. Use the `commit-changes` skill to commit
3. Use the `deploy-and-test` skill to deploy to production
4. Wait for user confirmation
5. Use the `create-pull-request` skill to create PR

## Critical Rule

**NEVER commit directly to main!** All work must go through feature branches and PRs.

