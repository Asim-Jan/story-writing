---
name: commit-changes
description: Commits code changes with properly formatted conventional commit messages. Use this when code changes are ready to be committed. Always includes Claude co-author attribution.
allowed-tools: [Write, Terminal]
---

# Commit Changes

Commits changes with properly formatted commit messages following conventional commits format.

## When to Use This Skill

- Code changes are complete and ready to commit
- On a feature branch (NOT main!)
- Changes have been tested locally (if applicable)

## Prerequisites

- ✅ On a feature branch (verify with `git branch`)
- ✅ Changes are complete and working
- ✅ Tested locally if possible

## Commit Message Format

### Type Prefixes

- `feat:` - New feature
- `fix:` - Bug fix
- `refactor:` - Code refactoring (no functional changes)
- `docs:` - Documentation only
- `test:` - Adding or updating tests
- `chore:` - Build/tooling changes

### Message Structure

```
type: concise description (max 50 chars)

- Detailed point 1
- Detailed point 2
- Detailed point 3

[Optional: Fixes #issue-number]

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>
```

## Steps

### 1. Review Changes

```bash
git status          # See what changed
git diff            # Review specific changes
git diff --cached   # Review staged changes
```

### 2. Stage Changes

```bash
# Stage specific files (preferred for clarity)
git add <file1> <file2> <file3>

# Or stage all changes
git add .
```

### 3. Commit with Proper Format

```bash
git commit -m "type: concise description

- Detailed change 1
- Detailed change 2
- Detailed change 3

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

### 4. Push to Remote

```bash
# First push (creates remote branch)
git push -u origin <branch-name>

# Subsequent pushes
git push
```

## Example Commits

### Feature Commit

```bash
git commit -m "feat: Add metadata field to books table

- Added JSONB metadata column to books table
- Updated BookRepository create/update methods
- Added field mapping in dataService
- Frontend can now save/load book metadata

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

### Bug Fix Commit

```bash
git commit -m "fix: Chapters not persisting to database

- Added chapters field to API endpoint bookData
- Updated syncChapters to handle empty arrays
- Fixed field mapping (number → chapter_number)

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

### Refactor Commit

```bash
git commit -m "refactor: Simplify user settings data flow

- Consolidated getUserSettings calls
- Removed redundant field mappings
- Improved error handling

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

## Verification

```bash
git log -1          # View your commit
git status          # Should show "nothing to commit, working tree clean"
git log --oneline -5 # View last 5 commits
```

## Common Mistakes to Avoid

- ❌ Committing to main branch
- ❌ Vague commit messages ("fix stuff", "updates")
- ❌ Forgetting co-author line
- ❌ Committing broken code
- ❌ Mixing unrelated changes in one commit

## Next Steps

After committing:
1. Use `deploy-and-test` skill to deploy to production
2. Test the changes
3. Wait for user confirmation
4. Use `create-pull-request` skill (only after user confirms)

## Critical Rules

- ✅ Always include co-author line
- ✅ Write clear, descriptive commit messages
- ✅ Commit only on feature branches
- ✅ One logical change per commit

