# Story Writing Studio - Features & Role-Based Access

This document defines all features available in the application and the roles that can access them.

---

## Current Roles

1. **User** (default) - Standard user with full writing capabilities
2. **Admin** - System administrator with user management capabilities

---

## Feature Categories & Access Matrix

### 1. AUTHENTICATION & SECURITY

| Feature | User | Admin | Notes |
|---------|------|-------|-------|
| Register Account | ✅ | ✅ | Public |
| Login | ✅ | ✅ | Public |
| Logout | ✅ | ✅ | |
| Change Password | ✅ | ✅ | |
| Forgot/Reset Password | ✅ | ✅ | |
| View Own Profile | ✅ | ✅ | |
| Update Own Settings | ✅ | ✅ | |

---

### 2. ADMIN DASHBOARD (Admin Only)

| Feature | User | Admin | Notes |
|---------|------|-------|-------|
| View Admin Dashboard | ❌ | ✅ | Admin only |
| List All Users | ❌ | ✅ | Admin only |
| View User Details | ❌ | ✅ | Admin only |
| Change User Tier | ❌ | ✅ | free/basic/premium |
| Suspend/Ban Users | ❌ | ✅ | With reason logging |
| View System Statistics | ❌ | ✅ | Metrics & analytics |
| View Audit Log | ❌ | ✅ | Admin action history |
| Delete Users | ❌ | ✅ | Soft delete |

---

### 3. BOOK MANAGEMENT

| Feature | User | Admin | Notes |
|---------|------|-------|-------|
| Create Books | ✅ | ✅ | |
| View Own Books | ✅ | ✅ | |
| Edit Own Books | ✅ | ✅ | |
| Delete Own Books | ✅ | ✅ | |
| View All Users' Books | ❌ | ✅ | Admin can view any book |
| Manage Book Metadata | ✅ | ✅ | Title, author, genre, etc. |
| Upload Book Cover | ✅ | ✅ | |

---

### 4. BOOK COMPONENTS

| Feature | User | Admin | Notes |
|---------|------|-------|-------|
| Create/Edit Chapters | ✅ | ✅ | Rich text editor |
| Create/Edit Characters | ✅ | ✅ | Character profiles |
| Create/Edit Locations | ✅ | ✅ | World-building |
| Create/Edit Plotlines | ✅ | ✅ | Story arcs |
| Create/Edit Timeline | ✅ | ✅ | Chronological events |
| Create/Edit Notes | ✅ | ✅ | Annotations |
| World Building | ✅ | ✅ | Lore management |
| Chapter Versioning | ✅ | ✅ | Version control |

---

### 5. BOOK IMPORT & ANALYSIS

| Feature | User | Admin | Notes |
|---------|------|-------|-------|
| Import EPUB/PDF/DOCX/TXT | ✅ | ✅ | 50MB limit |
| Smart Chapter Detection | ✅ | ✅ | AI-powered |
| Extract Chapters | ✅ | ✅ | Parse imported files |
| Chapter Validation | ✅ | ✅ | Analyze chapters |
| Metadata Extraction | ✅ | ✅ | Auto-detect characters/locations |
| Import Status Tracking | ✅ | ✅ | Monitor progress |
| AI Import Analysis | ✅ | ✅ | **Requires user API key** |

---

### 6. AI TEXT GENERATION

**Note**: All AI text generation features require users to provide their own OpenAI API key.

| Feature | User | Admin | Notes |
|---------|------|-------|-------|
| Generate Characters | ✅ | ✅ | Requires API key |
| Generate Locations | ✅ | ✅ | Requires API key |
| Generate Plotlines | ✅ | ✅ | Requires API key |
| Generate Chapters | ✅ | ✅ | Requires API key |
| Generate Dialogue | ✅ | ✅ | Requires API key |
| Character Arc Development | ✅ | ✅ | Requires API key |
| Chapter Outline | ✅ | ✅ | Requires API key |
| Relationship Mapping | ✅ | ✅ | Requires API key |
| Plot Analysis | ✅ | ✅ | Requires API key |
| Timeline Generation | ✅ | ✅ | Requires API key |
| Content Improvement | ✅ | ✅ | Requires API key |
| Web Search Integration | ✅ | ✅ | Requires API key |

---

### 7. MEDIA GENERATION

**Note**: Media generation requires users to provide their own API keys (OpenAI for audio, Gemini for images).

| Feature | User | Admin | Notes |
|---------|------|-------|-------|
| Generate Character Images | ✅ | ✅ | Gemini API key required |
| Generate General Images | ✅ | ✅ | Gemini API key required |
| Generate Comic Panels | ✅ | ✅ | Gemini API key required |
| Text-to-Speech (TTS) | ✅ | ✅ | OpenAI API key required |
| Audiobook Generation | ✅ | ✅ | OpenAI API key required |
| Animation Studio | ✅ | ✅ | Video generation |
| Video Scene Parsing | ✅ | ✅ | |
| Comic Book Creation | ✅ | ✅ | |
| Upload Media Files | ✅ | ✅ | Images, audio, video |
| Manage Media Library | ✅ | ✅ | |

---

### 8. EXPORT & PUBLISHING

| Feature | User | Admin | Notes |
|---------|------|-------|-------|
| Export to EPUB | ✅ | ✅ | eBook format |
| Export to PDF | ✅ | ✅ | Via EPUB conversion |
| Export to DOCX | ✅ | ✅ | Word document |
| Export to CBZ | ✅ | ✅ | Comic book archive |
| Export Audiobook | ✅ | ✅ | TTS audio |
| Export Animation Video | ✅ | ✅ | Video file |
| Export to Foundry VTT | ✅ | ✅ | RPG format |
| Export to Roll20 | ✅ | ✅ | RPG format |
| Export Campaign PDF | ✅ | ✅ | RPG format |
| Export HTML5 Campaign | ✅ | ✅ | Interactive web |

---

### 9. GRAMMAR & CONTINUITY

| Feature | User | Admin | Notes |
|---------|------|-------|-------|
| Grammar Check | ✅ | ✅ | Spell & style |
| Readability Statistics | ✅ | ✅ | Metrics |
| Continuity Analysis | ✅ | ✅ | **Requires API key** |
| Timeline Conflict Detection | ✅ | ✅ | **Requires API key** |
| Character Consistency Check | ✅ | ✅ | **Requires API key** |
| Plot Hole Detection | ✅ | ✅ | **Requires API key** |

---

### 10. RPG CAMPAIGN TOOLS

| Feature | User | Admin | Notes |
|---------|------|-------|-------|
| Convert Book to RPG | ✅ | ✅ | D&D-compatible |
| Character Sheets | ✅ | ✅ | D&D 5e stats |
| Quest Generation | ✅ | ✅ | **Requires API key** |
| Encounter Generation | ✅ | ✅ | **Requires API key** |
| NPC Management | ✅ | ✅ | |
| AI Dungeon Master | ✅ | ✅ | **Requires API key** |
| Campaign Tracking | ✅ | ✅ | |
| Dice Roller | ✅ | ✅ | |
| Combat Calculator | ✅ | ✅ | |
| World Map Builder | ✅ | ✅ | |

---

### 11. WRITING TOOLS & PRODUCTIVITY

| Feature | User | Admin | Notes |
|---------|------|-------|-------|
| Rich Text Editor | ✅ | ✅ | Full formatting |
| Autosave (30s) | ✅ | ✅ | |
| Find & Replace | ✅ | ✅ | With regex |
| Character Count | ✅ | ✅ | Real-time |
| Writing Goals | ✅ | ✅ | Daily/weekly/monthly |
| Writing Statistics | ✅ | ✅ | Words, time, history |
| Typewriter Mode | ✅ | ✅ | Focused writing |
| Version History | ✅ | ✅ | Chapter snapshots |

---

### 12. BACKGROUND JOBS

| Feature | User | Admin | Notes |
|---------|------|-------|-------|
| Queue Jobs | ✅ | ✅ | Image, audio, video, analysis |
| View Own Jobs | ✅ | ✅ | Status & progress |
| View All Jobs | ❌ | ✅ | Admin can see all |
| Cancel Own Jobs | ✅ | ✅ | |
| Retry Failed Jobs | ✅ | ✅ | |
| Job Rate Limiting | ✅ | ✅ | Tier-based limits |

---

### 13. EXTERNAL API ACCESS

| Feature | User | Admin | Notes |
|---------|------|-------|-------|
| Generate API Keys | ✅ | ✅ | For 3rd party apps |
| Access Books via API | ✅ | ✅ | External integration |
| Access Chapters via API | ✅ | ✅ | External integration |
| Access Plotlines via API | ✅ | ✅ | External integration |

---

### 14. SETTINGS & PREFERENCES

| Feature | User | Admin | Notes |
|---------|------|-------|-------|
| Manage API Keys | ✅ | ✅ | OpenAI, Gemini |
| Theme Preferences | ✅ | ✅ | Dark/light mode |
| Notification Settings | ✅ | ✅ | |
| Export Preferences | ✅ | ✅ | Default formats |
| Profile Settings | ✅ | ✅ | Name, email |

---

## Tier-Based Limitations (Future Implementation)

### Free Tier (Proposed)
- Limited books: 3
- Limited chapters per book: 20
- Job queue limit: 2 concurrent
- Basic AI features
- Standard export formats

### Basic Tier (Proposed)
- Limited books: 10
- Limited chapters per book: 50
- Job queue limit: 5 concurrent
- All AI features
- All export formats
- Priority processing

### Premium Tier (Proposed)
- Unlimited books
- Unlimited chapters
- Job queue limit: 10 concurrent
- All AI features
- All export formats
- Priority processing
- Advanced analytics
- Collaboration features

---

## Rate Limits

| Action | Limit | Window | Notes |
|--------|-------|--------|-------|
| Login Attempts | 5 | 15 min | IP-based |
| AI Requests | 50 | 15 min | Per user |
| Admin Requests | 100 | 15 min | Per admin |
| File Upload Size | 50 MB | Per file | |

---

## Permission Notes

1. **API Key Requirement**: Many AI features require users to provide their own OpenAI or Google Gemini API keys. The system does not provide default API keys.

2. **Admin Access**: Admins can view all users' data but should respect user privacy. Admin actions are logged in the audit trail.

3. **Self-Modification Prevention**: Admins cannot modify their own role, tier, or status to prevent accidental lockout.

4. **Account Status**: Suspended or banned users cannot access any features except viewing their suspension notice.

5. **Soft Deletes**: Deleted users and books are soft-deleted (marked as deleted but not removed from database) for data recovery.

---

## Future Role Considerations

### Potential New Roles:

**Moderator** (Content Reviewer)
- Review flagged content
- View user reports
- Limited user management (warnings, temporary suspensions)
- Cannot delete users or modify tiers

**Collaborator** (Guest Writer)
- View specific shared books
- Edit specific chapters (if granted permission)
- Cannot delete or export books
- Limited to assigned books only

**Publisher** (Organization Admin)
- Manage organization's users
- View organization's books
- Cannot modify system-level settings
- Organization-scoped permissions

---

## Next Steps

1. **Define tier-based quotas** for free/basic/premium users
2. **Implement feature flags** for gradual rollout of new features
3. **Create permission middleware** to enforce role-based access on API endpoints
4. **Add UI role checks** to show/hide features based on user role
5. **Implement quota enforcement** for books, chapters, jobs, storage, etc.
6. **Add collaboration features** with granular permissions (owner/editor/viewer)

