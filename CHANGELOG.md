# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
