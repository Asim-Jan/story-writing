# Update Changelog

Updates CHANGELOG.md after a feature has been deployed and tested. Use this after successful deployment to document the changes.

## When to Use This Skill

- Feature has been deployed to production
- Feature has been tested and confirmed working
- Pull request has been created (or is about to be created)
- Need to document the changes in CHANGELOG.md

## Prerequisites

- ✅ Feature deployed successfully
- ✅ Version number in VERSION file is correct
- ✅ Feature tested and working
- ✅ Know what type of change it is (Added/Changed/Fixed/Removed)

## Change Types

Use semantic versioning categories:

- **Added** - New features or capabilities
- **Changed** - Changes to existing functionality
- **Fixed** - Bug fixes
- **Removed** - Removed features or deprecations
- **Security** - Security-related changes
- **Deprecated** - Features marked for future removal

## Steps

### 1. Read Current Changelog

```bash
head -50 CHANGELOG.md
```

### 2. Identify Current Version

Check VERSION file to get the version number that was just deployed.

### 3. Determine Entry Type

Ask yourself:
- Is this a new feature? → **Added**
- Is this a bug fix? → **Fixed**
- Is this a change to existing behavior? → **Changed**
- Is this removing something? → **Removed**

### 4. Update CHANGELOG.md

Add a new section for the version if it doesn't exist, following the Keep a Changelog format:

```markdown
## [VERSION] - YYYY-MM-DD

### Added
- **Feature Name** - Brief description
  - Sub-detail 1
  - Sub-detail 2
  - Key benefit or technical detail

### Fixed
- **Issue Description** - What was fixed
  - Root cause
  - Solution applied
```

### 5. Format Guidelines

**Good Changelog Entries:**
```markdown
### Added
- **Chapter Version Control** - Complete version history for chapters
  - View all past versions with timestamps and word counts
  - Restore any previous version with one click
  - Smart version creation (5min intervals or 100+ word changes)
  - PostgreSQL-backed storage
  - Backward compatible with Redis chapters
```

**Bad Changelog Entries:**
```markdown
### Added
- Added version control
- Fixed a bug
- Updated some files
```

### 6. Include Technical Details

For complex features, include:
- Database changes (migrations, new tables)
- API endpoint changes
- Breaking changes (if major version)
- Migration notes (if needed)

### 7. Commit the Update

```bash
git add CHANGELOG.md
git commit -m "docs: Update CHANGELOG for v<VERSION>

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
git push
```

## Example Entry Template

```markdown
## [2.XX.X] - 2026-02-XX

### Added
- **[Feature Name]** - [One-line description]
  - [Key feature 1]
  - [Key feature 2]
  - [Key feature 3]
  - [Technical detail if important]

### Changed
- [What changed and why]
  - [Impact on users]
  - [Migration notes if needed]

### Fixed
- **[Issue Description]** - [What was broken]
  - [Root cause]
  - [Solution applied]
  - [Affected versions]
```

## Multi-Version Updates

If multiple patch versions were deployed for the same feature:

```markdown
## [2.20.6] - 2026-02-18

### Fixed
- **Autosave Indicator** - Fixed "Unsaved changes" persisting after manual save
  - Updated useAutosave hook to handle server response updates
  - Prevents marking as unsaved when data updates from save response

## [2.20.5] - 2026-02-18

### Fixed
- **Smart Version Creation** - Reduced excessive version creation
  - Only creates versions every 5 minutes or 100+ word changes
  - Prevents version spam from autosave (every 30 seconds)

## [2.20.4] - 2026-02-18

### Fixed
- **UUID Validation** - Added backward compatibility for Redis chapters
  - Old numeric chapter IDs now gracefully return empty versions
  - Prevents crashes when opening old chapters

## [2.20.0] - 2026-02-18

### Added
- **Chapter Version Control** - Complete version history for chapters
  - View all past versions with timestamps and word counts
  - Restore any previous version with one click
  - PostgreSQL-backed storage
```

## Best Practices

### DO:
- ✅ Use present tense ("Add feature" not "Added feature")
- ✅ Be specific about what changed
- ✅ Include user-facing benefits
- ✅ Mention breaking changes prominently
- ✅ Link to issues/PRs if applicable
- ✅ Group related changes together
- ✅ Use consistent formatting

### DON'T:
- ❌ Use vague descriptions ("Various improvements")
- ❌ Include implementation details users don't care about
- ❌ Forget to include the date
- ❌ Mix multiple feature versions in one entry
- ❌ Skip minor/patch versions
- ❌ Use past tense inconsistently

## Special Cases

### Hotfix Releases

```markdown
## [2.20.4] - 2026-02-18

### Fixed
- **HOTFIX**: [Critical issue description]
  - [What was broken]
  - [Impact severity]
  - [Immediate fix applied]
```

### Breaking Changes (Major Versions)

```markdown
## [3.0.0] - 2026-02-XX

### Changed
- **BREAKING**: [What changed]
  - [Why it was necessary]
  - [Migration guide]
  - [Affected APIs/features]

### Removed
- **BREAKING**: [What was removed]
  - [Deprecation period]
  - [Recommended alternatives]
```

### Security Updates

```markdown
### Security
- **CRITICAL**: Fixed [security vulnerability]
  - [Affected versions: x.x.x to y.y.y]
  - [What was vulnerable]
  - [Fix applied]
  - [Recommended action for users]
```

## Verification

Before committing:
- [ ] Version number matches VERSION file
- [ ] Date is correct (YYYY-MM-DD)
- [ ] Change type is appropriate (Added/Fixed/Changed)
- [ ] Description is clear and user-focused
- [ ] Technical details are included where helpful
- [ ] No typos or formatting issues
- [ ] Follows Keep a Changelog format

## Integration with Other Skills

**Typical Workflow:**
1. ✅ Use `create-feature-branch` to start work
2. ✅ Make changes and commit
3. ✅ Use `deploy-and-test` to deploy to production
4. ✅ User confirms feature works
5. ✅ **Use `update-changelog`** ← You are here
6. ✅ Use `create-pull-request` to create PR
7. ✅ User reviews and merges

## Quick Reference

```bash
# Current workflow
git status                    # Verify on feature branch
cat VERSION                   # Get current version
head -50 CHANGELOG.md        # See recent entries

# Edit CHANGELOG.md
# Add your entry at the top (after ## Changelog header)

# Commit and push
git add CHANGELOG.md
git commit -m "docs: Update CHANGELOG for v<VERSION>"
git push
```

## Notes

- CHANGELOG should be updated AFTER deployment, not before
- One version can have multiple entries if it had multiple fixes
- Group related changes under the same version number
- Always use the version from the VERSION file
- Keep entries focused on user impact, not implementation details
