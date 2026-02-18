# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.21.7] - 2026-02-18

### Fixed
- **Admin Dashboard Navigation** - Fixed tab navigation wrapping on mobile and smaller screens
  - Added `flex-wrap` to allow tabs to wrap instead of horizontal scroll
  - Made tab buttons responsive (smaller text/icons on mobile)
  - Reduced gap from 6 to 4 on mobile for better spacing
  - Added `whitespace-nowrap` to prevent text breaking within buttons
- **Notes Tab** - Fixed "+ New Note" button not showing the form
  - Added `isCreatingNew` state to track when creating new notes
  - Form now appears correctly when clicking the button

## [2.21.6] - 2026-02-18

### Fixed
- **Notes Tab** - Fixed "+ New Note" button functionality
  - Added explicit state tracking for new note creation
  - Detail panel now shows empty form when creating new note

## [2.21.5] - 2026-02-18

### Fixed
- **Timeline Tab Desktop Layout** - Fixed button overlap with heading
  - Separated timeline heading from action buttons
  - Changed button container to responsive grid (2 cols mobile, 3 tablet, 5 desktop)
  - Fixed multi-branch timeline to stack vertically on mobile, horizontal on desktop
  - Added proper padding on desktop (px-3 sm:px-4 lg:px-6)

## [2.21.4] - 2026-02-18

### Changed
- **Usage Toolbar** - Minimized by default to reduce UI clutter
  - QuotaBanner now starts collapsed on page load
  - Users can still expand to view full quota details

## [2.21.3] - 2026-02-18

### Fixed
- **Mobile Responsiveness** - Comprehensive mobile UI improvements
  - Characters, Locations, Plotlines, Notes, Timeline tabs now mobile-friendly
  - Added JavaScript-based viewport detection (useMediaQuery hook)
  - Full-screen detail views on mobile with back button navigation
  - Improved character detail view readability (larger text, better spacing)
  - Card-style layout for character appearance attributes

## [2.20.6] - 2026-02-18

### Fixed
- **Autosave Indicator** - Fixed "Unsaved changes" persisting after manual save
  - Updated useAutosave hook to handle server response updates gracefully
  - Prevents marking as unsaved when data updates from save response
  - Added saveStatus dependency to useEffect for proper state tracking

## [2.20.5] - 2026-02-18

### Fixed
- **Smart Version Creation** - Reduced excessive version creation from autosave
  - Only creates versions every 5 minutes OR when 100+ words changed
  - Prevents version spam from frequent autosaves (every 30 seconds)
  - Implemented intelligent thresholds in ChapterRepository.update()

## [2.20.4] - 2026-02-18

### Fixed
- **UUID Validation** - Added backward compatibility for Redis chapters
  - Old numeric chapter IDs now gracefully return empty versions
  - Prevents UUID validation errors when opening legacy chapters
  - Non-UUID chapters show "No versions saved yet" instead of crashing

## [2.20.3] - 2026-02-18

### Fixed
- **Version Creation Logic** - Implemented smart versioning to prevent excessive saves
  - Time-based threshold: 5+ minutes since last version
  - Change-based threshold: 100+ words changed (significant edit)
  - Always creates first version for new chapters

## [2.20.2] - 2026-02-18

### Fixed
- **Version Control Endpoints** - Fixed ChapterDataService.findById error
  - Replaced ChapterDataService with ChapterRepository in all endpoints
  - Fixed GET /versions endpoint crash
  - Fixed POST /restore endpoint crash

## [2.20.1] - 2026-02-18

### Fixed
- **PostgreSQL Migration** - Migrated version control from Redis to PostgreSQL
  - Updated GET /api/books/:bookId/chapters/:chapterId/versions
  - Updated POST /api/books/:bookId/chapters/:chapterId/versions/:versionId/restore
  - Added proper authentication and error handling

## [2.20.0] - 2026-02-17

### Added
- **Chapter Version Control** - Complete version history for chapters
  - View all past versions with timestamps and word counts
  - Restore any previous version with one click
  - Automatic version saving on every chapter edit
  - Version history UI integrated into ChaptersTabView
  - PostgreSQL-backed storage (migrated from Redis)
  - Up to 50 versions kept per chapter
  - Optimistic locking to prevent concurrent edit conflicts

### Changed
- Migrated version control endpoints from Redis to PostgreSQL
- Version history now uses `chapter_versions` table for persistent storage
- Added authentication headers to version control API calls
- Version History button added to chapter detail view toolbar

## [2.19.4] - 2026-02-17

### Fixed
- **CRITICAL**: Fixed double JSON parsing in stats endpoints
  - getStats() already returns parsed object, removed duplicate JSON.parse() calls
  - Fixes 500 errors when saving goals or loading statistics
  - Applied fix to GET /api/users/stats, POST /api/users/stats, and PUT /api/users/goals

## [2.19.2] - 2026-02-17

### Fixed
- **HOTFIX**: Writing Goals authentication - Added missing auth headers to API calls
  - Goals now persist correctly after saving
  - Statistics load properly with user authentication
  - Fixed "unsaved changes" indicator staying active after manual save
  - Book data now updates from server response to prevent data mismatches

## [2.19.0] - 2026-02-17

### Added
- **Writing Goals & Progress Tracking** - Motivational writing goals system
  - Writing Goals widget in Profile page with daily/weekly/monthly progress bars
  - Statistics Dashboard with time-range charts (week/month/year)
  - Writing streak counter to track consecutive writing days
  - Goal customization (set your own word count targets)
  - Automatic word count tracking when editing chapters
  - Real-time progress visualization with color-coded completion
  - Historical analytics with recharts integration
  - 365-day rolling window for writing statistics

### Changed
- Profile page now has "Writing Goals" tab with integrated goal tracker and analytics
- Book saves automatically track words written and update daily statistics
- Word count differences calculated on each chapter save to log progress

## [2.18.11] - 2026-02-17

### Added
- **Template Books Feature** - Sample books system for quick-start writing
  - Template gallery with browse, preview, and clone functionality
  - Three professional sample books (Fantasy, Romance, Sci-Fi)
  - Complete with chapters, characters, locations, and plotlines
  - Admin endpoints for template management and analytics
  - Clone count tracking per template

### Fixed
- Template cloning now properly handles JSONB vs TEXT[] column types
- Database connection issues in TemplateRepository resolved
- Seed endpoint now creates templates with complete chapter content

## [2.17.10] - 2026-02-15

### Added
- **Custom Focus Areas** - User-defined continuity analysis areas
  - Create book-specific focus areas beyond the 5 defaults
  - Examples: "magic system", "tech accuracy", "historical accuracy"
  - Stored in PostgreSQL with TEXT[] array type
  - GIN index for efficient querying
  - UI for adding/removing custom areas

## [2.17.9] - 2026-02-07

### Added
- **Continuity Analysis History** - Full tracking of past analyses
  - View all past continuity checks with scores and timestamps
  - Delete old analyses to clean up history
  - Compare current vs previous results
  - Filter by chapters and focus areas analyzed

## [2.17.7] - 2026-02-07

### Added
- **Incremental Chapter Analysis** - Selective continuity checking
  - Analyze specific chapters instead of entire book
  - Focus on specific areas (timeline, characters, plot, locations, style)
  - Save analysis parameters to database for tracking
  - More efficient for large books and targeted edits

### Changed
- Continuity checker now saves focus areas and chapter selection to history

## [2.17.6] - 2026-02-07

### Fixed
- **HOTFIX**: Fixed chapter deletion by importing `query` function in ChapterRepository
  - Chapters can now be properly deleted from books
  - Chapter counts update correctly after deletion

## [2.17.5] - 2026-02-07

### Fixed
- **HOTFIX**: Changed chapter deletion from soft delete to hard delete
  - Allows reusing chapter numbers after deletion
  - Prevents "duplicate key" errors when recreating chapters
- Fixed quota stats not updating after book/chapter operations
  - Added proper incrementers for book_count and chapter_count

## [2.17.4] - 2026-02-07

### Fixed
- **HOTFIX**: Fixed chapter synchronization issues
  - Deleted chapters no longer reappear after save
  - AI-generated chapters now persist correctly
  - Fixed duplicate key constraint errors on chapter numbers
  - Improved chapter matching logic to handle chapters without IDs

## [2.17.3] - 2026-02-07

### Fixed
- **HOTFIX**: Fixed token tracking database save
  - AI generation data now properly saves to `ai_generations` table
  - Fixed "pool is not defined" error
  - Cost tracking dashboards now show token usage data

## [2.17.2] - 2026-02-07

### Fixed
- **HOTFIX**: Fixed AI quota tracking
  - AI request counter now increments correctly (0/10 → 1/10, etc.)
  - Fixed admin dashboard "Top Users by Cost" query
  - Changed username column references to name/email

## [2.17.1] - 2026-02-07

### Fixed
- **HOTFIX**: Fixed database connection in cost tracking service
  - Replaced standalone pool with shared `getPool()` from postgres.js
  - AI generation endpoint now works correctly
  - Cost tracking can load pricing data without errors

## [2.17.0] - 2026-02-06

### Added
- **AI Cost Tracking System** (Phase 7)
  - Track token usage and costs for all AI generations
  - User dashboard showing personal AI costs
  - Admin dashboard with system-wide cost analytics
  - Daily/monthly cost trends and usage statistics
  - Top users by cost reporting
  - Detailed generation history with model/token data
- Database table: `ai_generations` for tracking all AI requests
- Cost calculation based on model pricing (GPT-4, Claude, Gemini, etc.)

### Changed
- All AI generation endpoints now record usage to database
- Enhanced `/api/generate` endpoint with cost tracking

## [2.0.3] - 2026-01-28

### Fixed
- **CRITICAL**: Fixed JSON parsing errors in login/registration endpoints
  - Added null checks before `JSON.parse()` in `UserDataService.findByEmail()`
  - Added try-catch blocks around all Redis data parsing in scanning loops
  - Added error logging for corrupted Redis data (continues processing instead of crashing)
- Fixed similar JSON parsing issues in `BookDataService.findByUser()`

### Added
- PostgreSQL dual-write mode fully operational (Phase 2 of migration)
- Complete PostgreSQL connection configuration in ECS task definition
  - Added all required environment variables (host, port, database, user, max connections)
  - Added PostgreSQL password secret to AWS Secrets Manager
  - Updated IAM execution role with secret access permissions
- Deployment automation scripts:
  - `scripts/enable-dual-write.sh` - Enable dual-write mode
  - `scripts/enable-postgres-complete.sh` - Complete PostgreSQL configuration
  - `scripts/enable-postgres-reads.sh` - Ready for Phase 3

### Changed
- Migrated from Redis-only to dual-write mode (writes to both Redis and PostgreSQL)
- All write operations now persist to both databases simultaneously
- Read operations continue from Redis (Phase 2 behavior)

### Infrastructure
- AWS ECS Task Definition: story-writing-backend:5 (active)
- AWS Secrets Manager: Added `story-writing/postgres-password`
- IAM Role: Updated `ecsTaskExecutionRole` policy

### Documentation
- Added [AWS_DEPLOYMENT_REFERENCE.md](AWS_DEPLOYMENT_REFERENCE.md) - Complete AWS deployment guide
- Added [DUAL_WRITE_STATUS.md](DUAL_WRITE_STATUS.md) - Current migration status and monitoring

## [1.0.4] - 2026-01-26

### Fixed
- **CRITICAL SECURITY**: Fixed ALL remaining endpoints to require user API keys
- Fixed 13 vulnerable endpoints that were still using system API keys:
  - `/api/analyze-continuity` - AI continuity analysis
  - `/api/generate-audiobook` - Batch audiobook generation
  - `/api/parse-transcript-to-comic` - Comic transcript parsing
  - `/api/generate-character-reference` - Character reference images
  - `/api/generate-comic-panel` - Comic panel generation
  - 8 RPG endpoints (dialogue, NPC responses, encounters, plot twists, AI DM features)
- Updated background job processors to require user API keys:
  - `audioProcessor.js` - Now requires `openaiApiKey` in job data
  - `imageProcessor.js` - Now requires `geminiApiKey` in job data
- Updated AI service classes to accept user API clients:
  - `VideoSceneParser` - Accepts `openaiClient` parameter
  - `VideoGenerator` - Accepts `genaiClient` parameter
  - `AIImportAnalyzer` - Accepts `openaiClient` parameter
  - `AIChapterDetector` - Accepts `openaiClient` parameter

### Security
- **100% API Key Protection**: ALL AI features now require user-provided API keys
- No endpoints can use system API keys as fallback
- System credits are fully protected from unauthorized use
- All AI features return 403 errors with helpful messages when API keys are missing

## [1.0.3] - 2026-01-24

### Fixed
- **CRITICAL**: Fixed AI Book Generator to require user's OpenAI API key
- Updated `AIBookOrchestrator` to accept user's OpenAI client instead of using system key
- Prevents unauthorized use of system credits during book generation

## [1.0.2] - 2026-01-24

### Changed
- **IMPORTANT**: Users MUST now provide their own API keys to use AI features
- Removed fallback to system API keys - protects your credits!
- AI endpoints now return clear error messages when API keys are missing

### Added
- Helper functions `getUserOpenAI()` and `getUserGemini()` for API key validation
- User-friendly error messages directing users to Profile > API Keys

## [1.0.1] - 2026-01-24

### Fixed
- Fixed `/api/auth/me` endpoint to properly return user data for Profile page
- Added `createdAt` field to user response for "Member Since" display

## [1.0.0] - 2026-01-24

### Added
- **Profile Page** with comprehensive user settings
  - Account information (name, email, member since)
  - API Keys management (OpenAI, Google Gemini)
  - User preferences (default model, voice, auto-save, notifications)
- **User API Keys Feature** - Users can use their own API keys instead of system credits
- **Settings Modal** - Quick access to API keys from books list
- **HTTPS Support** - Secured with Cloudflare SSL at story-writing.com
- **User Profile Navigation** - Profile icon in header for easy access
- **Preferences Storage** - Backend stores user preferences with API keys

### Changed
- Updated frontend API_URL to use HTTPS domain (story-writing.com)
- Improved nginx configuration for proper MIME type handling
- Enhanced user settings endpoint to support preferences

### Fixed
- Fixed nginx MIME type errors for JavaScript module loading
- Fixed repository paths for ECR deployments
- Resolved blob URL HTTPS warnings

## [0.1.0] - Initial Release

### Added
- Book writing studio with rich text editor
- AI-powered content generation (text, images, audio)
- Character, location, and plotline management
- Chapter organization and versioning
- Import/Export functionality
- Background job processing
- User authentication
- Redis data storage
- MinIO media storage
- Deployed on AWS ECS with ALB
