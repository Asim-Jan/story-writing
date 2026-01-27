# Redis Usage Analysis - Do We Still Need It?

**Date**: 2026-01-27
**Context**: After PostgreSQL migration completion

---

## Current Redis Usage in Application

After analyzing the codebase, Redis is currently used for **3 critical purposes**:

### 1. Session Management (✅ **KEEP REDIS**)

**Location**: [server/index.js:223-226](server/index.js#L223-L226)

```javascript
import RedisStore from 'connect-redis';

const redisStore = new RedisStore({
  client: redisClient,
  prefix: 'sess:',
});

app.use(session({
  store: redisStore,
  // ... session config
}));
```

**Why Keep Redis**:
- Sessions need fast, in-memory access (<1ms latency)
- High read/write frequency (every HTTP request)
- Built-in TTL expiration (auto-cleanup)
- Session data is ephemeral (acceptable to lose on restart)
- PostgreSQL would be overkill and slower for this use case

**Alternative**: Could use PostgreSQL with `connect-pg-simple`, but Redis is better suited for this.

---

### 2. Job Queue (Bull) (✅ **KEEP REDIS**)

**Location**: [server/jobs/queue.js:12-16](server/jobs/queue.js#L12-L16)

```javascript
import Queue from 'bull';

export const imageQueue = new Queue('image-generation', { redis: redisConfig });
export const audioQueue = new Queue('audio-generation', { redis: redisConfig });
export const contentQueue = new Queue('content-generation', { redis: redisConfig });
export const importQueue = new Queue('import-analysis', { redis: redisConfig });
export const videoQueue = new Queue('video-generation', { redis: redisConfig });
```

**Why Keep Redis**:
- Bull library **requires Redis** (no alternative supported)
- Handles job queuing, retries, concurrency, scheduling
- Real-time job status updates need fast access
- Job state transitions are frequent and need atomic operations
- Redis pub/sub used for worker coordination

**Job Types Using Queue**:
- Image generation (AI visuals)
- Audio generation (text-to-speech)
- Content generation (AI writing)
- Book import analysis
- Video generation

**Alternative**: Would require rewriting entire job system to use `pg-boss` or similar PostgreSQL-based queue (major refactor, not recommended).

---

### 3. Application Data Storage (❌ **MIGRATE TO POSTGRESQL**)

**Current Usage**: [server/index.js](server/index.js) - Direct Redis calls throughout
- User data (`user:*` keys)
- Book data (`book:*` keys)
- Chapter data (embedded in books)

**Status**: ✅ **Already migrated to PostgreSQL**
- Migration script completed successfully
- Data Service layer created
- Feature flags in place for dual-write

**Action Required**: Replace direct Redis calls with Data Service layer calls.

---

## Temporary Redis Usage During Migration (⚠️ **TEMPORARY**)

### 4. Job Metadata Storage

**Location**: [server/jobs/queue.js:34-49](server/jobs/queue.js#L34-L49)

```javascript
export async function storeJobMetadata(jobId, userId, bookId, type, data) {
  await redisClient.set(`job:${jobId}`, JSON.stringify(metadata), { EX: 86400 });
}
```

**Current**: Stores job metadata in Redis with 24-hour TTL
**Future**: Should use PostgreSQL `jobs` table instead
**Migration**: Already created JobRepository for this purpose

---

## Recommendation: YES, Keep Redis (But With Reduced Scope)

### Redis Should Be Used For:

1. ✅ **Sessions** (connect-redis)
   - Fast, ephemeral data
   - High frequency access
   - Built-in TTL

2. ✅ **Job Queue** (Bull)
   - Required by library
   - Real-time coordination
   - Atomic operations

3. ✅ **Rate Limiting** (express-rate-limit)
   - Fast counters
   - Automatic expiration

4. ✅ **Temporary Caching** (optional, future enhancement)
   - API response caching
   - Computed results
   - Hot data

### PostgreSQL Should Be Used For:

1. ✅ **User accounts** (users, user_settings, quotas)
2. ✅ **Books** (books, collaborators)
3. ✅ **Chapters** (chapters, chapter_versions)
4. ✅ **Job metadata** (jobs table - for history/queries)
5. ✅ **Media tracking** (media table)
6. ✅ **Imports** (imports table)

---

## Migration Strategy

### Phase 1: Dual-Write Application Data (Current Phase)

**Action**: Update application to use Data Service layer instead of direct Redis

**Files to Modify**:
- [server/index.js](server/index.js) - Replace all `redisClient.get/set` for users/books with DataService calls
- Keep Redis for sessions and job queue unchanged

**Example Change**:

**Before**:
```javascript
// Get book from Redis
const data = await redisClient.get(`book:${bookId}`);
const book = JSON.parse(data);
```

**After**:
```javascript
// Get book from Data Service (routes to Redis or PostgreSQL based on flags)
import { BookDataService } from './db/dataService.js';
const book = await BookDataService.findById(bookId);
```

---

### Phase 2: Final State (After Migration Complete)

**Redis** (permanent, downsized):
- Sessions (sess:*)
- Job queue (bull:*)
- Rate limiting (rate-limit:*)
- Optional: API response cache

**PostgreSQL** (primary data store):
- All user data
- All book data
- All chapter data
- Job metadata (for history)
- Media tracking

---

## Cost Comparison

### Current (Redis Only)
- AWS ElastiCache Redis: ~$15-30/month (t3.micro)
- Stores: Sessions + Job Queue + Application Data

### After Migration (Redis + PostgreSQL)
- AWS ElastiCache Redis: ~$15-30/month (same size, less data)
  - Only sessions + job queue (smaller footprint)
- AWS RDS PostgreSQL: **FREE** (db.t3.micro free tier)
  - First year free, then ~$15-30/month

**Total**: ~$15-30/month (Year 1), ~$30-60/month (after)

### Benefits of Keeping Redis
- Proven session management
- Bull queue working well
- Fast caching layer
- No need to rewrite job system
- Better separation of concerns (hot vs cold data)

---

## What Gets Deleted from Redis

After Phase 4 (PostgreSQL-only mode for application data):

**Delete** (via KEYS command or let TTL expire):
- `user:*` keys (except `user:undefined:*` which are invalid)
- `book:*` keys
- Any other application data keys

**Keep**:
- `sess:*` keys (sessions)
- `bull:*` keys (job queue)
- `rate-limit:*` keys (rate limiting)

**Command to cleanup** (AFTER migration complete and verified):
```bash
redis-cli -h localhost -p 6380
> SCAN 0 MATCH user:* COUNT 100
# Review keys
> DEL user:1759707763542-owpiux
> SCAN 0 MATCH book:* COUNT 100
> DEL book:1759684106874
```

---

## Alternative: Could We Remove Redis Entirely?

**Technically possible**, but requires:

1. **Sessions**: Switch to `connect-pg-simple` (PostgreSQL session store)
   - Pros: One less service
   - Cons: Slower, more DB load, no TTL

2. **Job Queue**: Rewrite to use `pg-boss` or similar
   - Pros: One less service
   - Cons: Major refactor, loss of Bull features, risky

3. **Rate Limiting**: Use PostgreSQL or in-memory
   - Pros: Simpler
   - Cons: Less accurate, no distributed support

**Verdict**: ❌ **NOT RECOMMENDED**
- Cost savings: ~$15-30/month
- Risk: High (major refactor, potential bugs)
- Performance: Degraded (PostgreSQL not optimized for hot data)
- Effort: 2-3 weeks of work

**Better approach**: Keep Redis for what it's good at (hot, ephemeral data).

---

## Action Items

### Immediate (Before Enabling Dual-Write)

1. ✅ Migration complete
2. 🔜 **Update [server/index.js](server/index.js)** to use DataService for users/books
3. 🔜 **Update job queue** to use PostgreSQL for job metadata (optional)
4. 🔜 **Test** that sessions and queues still work
5. 🔜 **Enable dual-write mode**

### After Migration Complete (Phase 4+)

6. Clean up old Redis keys (user:*, book:*)
7. Monitor Redis memory usage (should drop significantly)
8. Consider downsizing Redis instance if memory usage is low
9. Document final architecture

---

## Final Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Application Server                       │
│  ┌────────────┐  ┌──────────────┐  ┌────────────────────┐ │
│  │ Express    │  │ Data Service │  │ Bull Job Queues    │ │
│  │ Routes     │  │ Layer        │  │ (Image/Audio/etc)  │ │
│  └────────────┘  └──────────────┘  └────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
         │                  │                      │
         │                  │                      │
    ┌────▼────┐      ┌─────▼──────┐        ┌─────▼─────┐
    │ Redis   │      │ PostgreSQL │        │  Redis    │
    │         │      │            │        │           │
    │ sess:*  │      │ - users    │        │ bull:*    │
    │         │      │ - books    │        │           │
    │ rate-   │      │ - chapters │        │ (Queue)   │
    │ limit:* │      │ - jobs     │        │           │
    └─────────┘      └────────────┘        └───────────┘
     (Hot Data)      (Primary Store)      (Job Coordination)
```

---

## Summary

**Question**: Do we need Redis now?

**Answer**: **YES**, but for different reasons:
- ✅ **Sessions** - Redis is perfect for this (fast, ephemeral)
- ✅ **Job Queue** - Bull requires Redis (no alternative)
- ✅ **Rate Limiting** - Redis is ideal (fast counters)
- ❌ **Application Data** - Migrating to PostgreSQL (better for relational data)

**Next Step**: Update application code to use Data Service layer for users/books while keeping Redis for sessions and job queue.

---

**Document Version**: 1.0
**Status**: Analysis Complete
**Recommendation**: Keep Redis (reduced scope) + PostgreSQL (primary data)

