# Background Job System

This directory contains the background job processing system using **Bull** (Redis-backed queue).

## Architecture

```
┌─────────────┐      ┌──────────────┐      ┌────────────┐
│   Frontend  │─────▶│  API Server  │─────▶│  Job Queue │
└─────────────┘      └──────────────┘      │   (Redis)  │
                                            └─────┬──────┘
                                                  │
                                                  ▼
                                            ┌────────────┐
                                            │  Workers   │
                                            │ (Separate  │
                                            │  Process)  │
                                            └────────────┘
```

## Components

### 1. **queue.js**
- Defines job queues (image, audio, content, import, video)
- Job metadata storage in Redis
- Status tracking functions

### 2. **jobHelper.js**
- High-level functions to queue jobs
- Job limit enforcement (10 concurrent jobs per user)
- Input validation

### 3. **workers.js**
- Separate process that processes queued jobs
- Runs 5 different workers concurrently
- Handles job completion/failure events

### 4. **processors/**
- `imageProcessor.js` - Generates images with Gemini
- `audioProcessor.js` - Generates audio with OpenAI TTS
- `contentProcessor.js` - Generates content with AI Orchestrator
- `importProcessor.js` - Analyzes imported book chapters
- `videoProcessor.js` - Generates videos with Veo 3

## Job Types

| Type | Concurrency | Description |
|------|-------------|-------------|
| `image` | 2 | Image generation with Gemini |
| `audio` | 2 | Audio generation with OpenAI TTS |
| `content` | 1 | Content generation (expensive) |
| `import` | 2 | Import chapter analysis |
| `video` | 1 | Video generation (very expensive) |

## Job Lifecycle

1. **Queued** - Job added to queue
2. **Active** - Worker picked up the job
3. **Completed** - Job finished successfully
4. **Failed** - Job encountered an error

## API Endpoints

### Queue Jobs
- `POST /api/jobs/queue/image` - Queue image generation
- `POST /api/jobs/queue/audio` - Queue audio generation
- `POST /api/jobs/queue/content` - Queue content generation
- `POST /api/jobs/queue/import` - Queue import analysis
- `POST /api/jobs/queue/video` - Queue video generation

### Monitor Jobs
- `GET /api/jobs` - Get user's jobs
- `GET /api/jobs/:jobId` - Get job status
- `GET /api/jobs/can-queue` - Check if user can queue more jobs
- `DELETE /api/jobs/:jobId` - Delete completed/failed job
- `POST /api/jobs/:jobId/retry` - Retry failed job

## Running

The system requires **3 processes**:

```bash
npm run dev
```

This runs:
1. **Server** (API endpoints) - `npm run server`
2. **Worker** (Job processor) - `npm run worker`
3. **Client** (Frontend) - `npm run client`

## Features

✅ **Non-blocking** - Users can navigate away while jobs run
✅ **Progress tracking** - Real-time progress updates
✅ **Auto-retry** - Retry failed jobs with one click
✅ **Job limits** - Max 10 concurrent jobs per user
✅ **Persistent** - Jobs survive server restarts (stored in Redis)
✅ **Auto-refresh** - Jobs tab auto-refreshes every 3 seconds
✅ **Job history** - 24-hour retention of completed jobs

## Usage Example

### Frontend (using job queue)
```javascript
const response = await fetch('/api/jobs/queue/image', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  credentials: 'include',
  body: JSON.stringify({
    bookId: 'book-123',
    imageType: 'character',
    itemId: 'char-456',
    prompt: 'A brave knight in shining armor',
    context: { genre: 'Fantasy' }
  })
});

const { jobId } = await response.json();
console.log('Job queued:', jobId);

// User can navigate away - job continues in background
// Monitor progress in Jobs tab
```

### Legacy (blocking, not recommended)
```javascript
// Old synchronous endpoint - blocks until complete
const response = await fetch('/api/generate-image', {
  method: 'POST',
  body: JSON.stringify({ prompt: '...' })
});
// User must wait here
```

## Monitoring

### Via Jobs Tab
- Navigate to **Jobs** tab in the app
- See all active/completed/failed jobs
- Auto-refreshes when jobs are active
- Delete old jobs
- Retry failed jobs

### Via Logs
```bash
# Worker logs
npm run worker

# Output:
# 🚀 Job workers started
# 📸 Processing image job 12345
# ✅ Image job 12345 completed
```

## Troubleshooting

### Jobs not processing
1. Check worker is running: `npm run worker`
2. Check Redis is running: `docker-compose ps`
3. Check worker logs for errors

### Jobs stuck in "active"
- Worker probably crashed
- Restart worker: `npm run worker`
- Jobs will be retried automatically

### "Too many active jobs" error
- User has 10+ jobs running
- Wait for some to complete or delete queued jobs

## Configuration

Edit concurrency in `workers.js`:
```javascript
const CONCURRENCY = {
  image: 2,    // Increase for more parallel image generation
  audio: 2,    // Increase for more parallel audio generation
  content: 1,  // Keep low (expensive)
  import: 2,   // Can increase for faster imports
  video: 1,    // Keep at 1 (very expensive)
};
```

Edit job limit in `jobHelper.js`:
```javascript
const MAX_CONCURRENT_JOBS = 10; // Change user job limit
```

## Redis Keys

- `job:{jobId}` - Job metadata (24h TTL)
- `user:{userId}:jobs` - Set of user's job IDs
- Bull also stores its own keys in Redis

## Future Improvements

- [ ] Email notifications on job completion
- [ ] Job priority levels
- [ ] Job scheduling (run at specific time)
- [ ] Job dependencies (chain jobs)
- [ ] Better error recovery
- [ ] Job analytics dashboard
