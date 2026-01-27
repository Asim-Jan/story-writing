# Phase 2 Implementation Guide - PostgreSQL Migration

**Status**: ✅ **READY FOR PRODUCTION MIGRATION**
**Date**: 2026-01-27
**Version**: 2.0.0

---

## 🎯 Executive Summary

All Phase 2 infrastructure is now in place and ready for the production migration from Redis to PostgreSQL. This guide provides step-by-step instructions for executing the migration safely with zero downtime.

---

## ✅ Completed Work

### 1. **AWS RDS PostgreSQL Database**
- **Instance**: [story-writing-postgres.cxsu2memgs31.eu-west-2.rds.amazonaws.com:5432](story-writing-postgres.cxsu2memgs31.eu-west-2.rds.amazonaws.com:5432)
- **Engine**: PostgreSQL 15.15
- **Instance Class**: db.t3.micro (free tier compatible)
- **Storage**: 20 GB gp3
- **Database**: `story_writing`
- **Application User**: `story_user`
- **Security**: Configured for ECS tasks + local access

### 2. **Database Schema** ([server/db/schema.sql](server/db/schema.sql))
- ✅ 12 tables with proper constraints and indexes
- ✅ 2 views for common queries
- ✅ 3 custom functions (quota check, version increment, timestamp update)
- ✅ Full-text search on books and chapters
- ✅ Optimistic locking via version columns
- ✅ Automatic triggers for timestamps and versions
- ✅ UUID generation with `uuid-ossp` extension

### 3. **Connection Pool** ([server/db/postgres.js](server/db/postgres.js))
- ✅ Configurable pool (max 20, min 2)
- ✅ Transaction support with automatic rollback
- ✅ Query performance logging (slow query detection)
- ✅ Health check endpoint
- ✅ Graceful shutdown handling

### 4. **Repository Classes** ([server/db/repositories/](server/db/repositories/))
- ✅ [UserRepository.js](server/db/repositories/UserRepository.js) - User CRUD, settings, quotas
- ✅ [BookRepository.js](server/db/repositories/BookRepository.js) - Book CRUD, collaborators, search, optimistic locking
- ✅ [ChapterRepository.js](server/db/repositories/ChapterRepository.js) - Chapter CRUD, version history, rollback
- ✅ [JobRepository.js](server/db/repositories/JobRepository.js) - Job tracking, status management

### 5. **Feature Flags** ([server/config/features.js](server/config/features.js))
- ✅ `USE_POSTGRES` - Enable/disable PostgreSQL
- ✅ `DUAL_WRITE` - Write to both Redis and PostgreSQL
- ✅ `READ_FROM_POSTGRES` - Switch read source
- ✅ Migration phase detection
- ✅ Validation of flag combinations

### 6. **Data Service Layer** ([server/db/dataService.js](server/db/dataService.js))
- ✅ Abstraction for dual-write
- ✅ Smart routing based on feature flags
- ✅ Services: User, Book, Chapter, Job

### 7. **Migration Script** ([server/scripts/migrate-to-postgres.js](server/scripts/migrate-to-postgres.js))
- ✅ Dry-run mode for safety
- ✅ Timestamp ID → UUID conversion
- ✅ API key encryption preservation
- ✅ Progress tracking and error reporting
- ✅ Data validation and verification

---

## 📋 Migration Plan (4 Phases)

### **Phase 1: Preparation** (Day 0)

#### Step 1.1: Run Migration (Dry Run First)
```bash
# Test migration without making changes
node server/scripts/migrate-to-postgres.js --dry-run

# Review output for any errors

# Run actual migration
node server/scripts/migrate-to-postgres.js

# Verify migration success
# Should see: "Migration successful! All data migrated correctly."
```

#### Step 1.2: Update Environment Variables
Update [.env](.env) file:
```bash
# Before (Redis only)
USE_POSTGRES=false
DUAL_WRITE=false
READ_FROM_POSTGRES=false

# After (Dual-write, read from Redis)
USE_POSTGRES=true
DUAL_WRITE=true
READ_FROM_POSTGRES=false
```

#### Step 1.3: Deploy to Production
```bash
# Bump version
./deploy.sh all patch

# This will:
# 1. Build Docker images
# 2. Push to ECR
# 3. Update ECS services
# 4. Application now writes to BOTH Redis and PostgreSQL
# 5. Application still reads from Redis
```

---

### **Phase 2: Dual-Write Monitoring** (Days 1-3)

**Duration**: 48-72 hours
**Goal**: Ensure PostgreSQL writes are working correctly

#### Monitoring Checklist:
- [ ] Check CloudWatch logs for PostgreSQL errors
- [ ] Verify both databases are in sync
- [ ] Monitor response times (should be <100ms additional latency)
- [ ] Check database connection pool stats

#### Verification Queries:
```sql
-- Connect to PostgreSQL
-- Count users
SELECT COUNT(*) FROM users WHERE deleted_at IS NULL;

-- Count books
SELECT COUNT(*) FROM books WHERE deleted_at IS NULL;

-- Count chapters
SELECT COUNT(*) FROM chapters WHERE deleted_at IS NULL;

-- Recent activity
SELECT * FROM books ORDER BY updated_at DESC LIMIT 10;
```

Compare with Redis:
```bash
# Connect to Redis
redis-cli -h <redis-host> -p 6380

# Count users
KEYS user:* | wc -l

# Count books
KEYS book:* | wc -l
```

#### Rollback Plan (if issues found):
```bash
# Update .env
USE_POSTGRES=false
DUAL_WRITE=false
READ_FROM_POSTGRES=false

# Redeploy
./deploy.sh all patch
```

---

### **Phase 3: Switch to PostgreSQL Reads** (Day 3-4)

**Prerequisites**:
- ✅ No PostgreSQL errors in logs for 48+ hours
- ✅ Data verification shows Redis and PostgreSQL match
- ✅ Performance metrics are acceptable

#### Step 3.1: Update Environment Variables
Update [.env](.env):
```bash
# Before (Dual-write, read from Redis)
USE_POSTGRES=true
DUAL_WRITE=true
READ_FROM_POSTGRES=false

# After (Dual-write, read from PostgreSQL)
USE_POSTGRES=true
DUAL_WRITE=true
READ_FROM_POSTGRES=true
```

#### Step 3.2: Deploy
```bash
./deploy.sh all patch
```

#### Step 3.3: Monitor (48-72 hours)
- [ ] Response times acceptable
- [ ] No errors reading from PostgreSQL
- [ ] All features working (AI generation, book creation, etc.)
- [ ] Collaborator access working
- [ ] Media file access working

#### Rollback Plan:
```bash
# Revert to reading from Redis
USE_POSTGRES=true
DUAL_WRITE=true
READ_FROM_POSTGRES=false

./deploy.sh all patch
```

---

### **Phase 4: PostgreSQL Only** (Day 6-7)

**Prerequisites**:
- ✅ PostgreSQL reads working perfectly for 48+ hours
- ✅ No data inconsistencies
- ✅ All features verified working

#### Step 4.1: Disable Dual-Write
Update [.env](.env):
```bash
# Before (Dual-write, read from PostgreSQL)
USE_POSTGRES=true
DUAL_WRITE=true
READ_FROM_POSTGRES=true

# After (PostgreSQL only - FINAL STATE)
USE_POSTGRES=true
DUAL_WRITE=false
READ_FROM_POSTGRES=true
```

#### Step 4.2: Deploy
```bash
./deploy.sh all patch
```

#### Step 4.3: Verify PostgreSQL-Only Mode
```bash
# Check feature flags in logs
# Should see: "Migration Phase: POSTGRES_ONLY"

# Monitor for 24 hours
# Verify Redis is no longer being written to
```

#### Step 4.4: Optional - Keep Redis as Backup
You can keep Redis running for 7-30 days as a backup before decommissioning:

```bash
# After 7-30 days of stable PostgreSQL operation:
# 1. Stop writing sessions to Redis (use PostgreSQL for sessions)
# 2. Shut down Redis cluster
# 3. Remove Redis from docker-compose.yml
```

---

## 🔧 Implementation Tasks

### Integrating with Existing Application

The current application ([server/index.js](server/index.js)) uses Redis directly. We need to update it to use the Data Service layer.

#### Example Migration:

**Before (Redis direct)**:
```javascript
// Get book from Redis
const data = await redisClient.get(getBookKey(bookId));
const book = JSON.parse(data);
```

**After (Data Service)**:
```javascript
import { BookDataService } from './db/dataService.js';

// Get book (automatically routes to Redis or PostgreSQL based on flags)
const book = await BookDataService.findById(bookId);
```

#### Files to Update:
1. [server/index.js](server/index.js) - Main API routes
2. [server/services/redis.js](server/services/redis.js) - Wrap Redis client
3. User registration/login routes
4. Book CRUD routes
5. Chapter CRUD routes
6. Job creation routes

---

## 📊 Monitoring & Alerts

### Key Metrics to Track:

1. **Database Performance**
   - Query response time (target: <50ms)
   - Connection pool usage
   - Slow queries (>1000ms)

2. **Data Consistency**
   - Redis vs PostgreSQL count differences
   - Failed writes (should be 0)

3. **Application Health**
   - API response times
   - Error rates
   - Active users

### CloudWatch Queries:
```
# PostgreSQL errors
fields @timestamp, @message
| filter @message like /PostgreSQL/
| filter @message like /error/
| sort @timestamp desc

# Slow queries
fields @timestamp, @message
| filter @message like /Slow query/
| sort @timestamp desc
```

---

## 🚨 Troubleshooting

### Issue: Migration script fails

**Solution**:
```bash
# Check PostgreSQL connection
node server/scripts/setup-database.js

# Check Redis connection
redis-cli -h localhost -p 6380 ping

# Check encryption key is set
echo $ENCRYPTION_KEY
```

### Issue: Dual-write causing high latency

**Solution**:
```bash
# Check PostgreSQL connection pool
# Increase max connections in server/db/postgres.js
max: 30  # from 20

# Check slow query log
# Optimize indexes if needed
```

### Issue: Data out of sync

**Solution**:
```bash
# Stop application
# Re-run migration
node server/scripts/migrate-to-postgres.js

# Verify counts match
# Restart application
```

---

## ✅ Pre-Migration Checklist

Before running the migration in production:

- [ ] Backup Redis data: `redis-cli --rdb dump.rdb`
- [ ] Backup PostgreSQL (though empty): `pg_dump story_writing > backup.sql`
- [ ] Verify encryption key is set in .env
- [ ] Test migration script in dry-run mode
- [ ] Review migration output for errors
- [ ] Verify AWS RDS instance is running
- [ ] Verify security groups allow ECS→RDS traffic
- [ ] Verify application user has correct permissions
- [ ] Test PostgreSQL connection from ECS task
- [ ] Review rollback procedures

---

## 📝 Post-Migration Checklist

After completing Phase 4:

- [ ] Remove Redis data (after 30 days backup period)
- [ ] Update documentation
- [ ] Remove Redis dependencies from package.json (optional)
- [ ] Update deployment scripts
- [ ] Update monitoring dashboards
- [ ] Archive Redis backup
- [ ] Update cost estimates (RDS vs Redis)

---

## 📞 Support

### Credentials Location
- RDS credentials: [RDS_CREDENTIALS.txt](RDS_CREDENTIALS.txt) (DO NOT COMMIT)
- Environment variables: [.env](.env) (DO NOT COMMIT)

### Useful Commands
```bash
# Check PostgreSQL connection
psql -h story-writing-postgres.cxsu2memgs31.eu-west-2.rds.amazonaws.com \
     -U story_user -d story_writing

# Check feature flags
node -e "import('./server/config/features.js').then(m => m.features.logState())"

# Run dry-run migration
node server/scripts/migrate-to-postgres.js --dry-run

# Verify schema
node server/scripts/run-schema.js
```

---

## 🎯 Success Criteria

Migration is considered successful when:

1. ✅ All Redis data migrated to PostgreSQL (100% match)
2. ✅ Application running in PostgreSQL-only mode for 7+ days
3. ✅ Zero data loss
4. ✅ Response times <100ms for common queries
5. ✅ No PostgreSQL-related errors in logs
6. ✅ All features working (AI generation, collaboration, media)
7. ✅ Optimistic locking preventing concurrent edit conflicts
8. ✅ Version history working for chapters

---

## 📈 Timeline Summary

| Phase | Duration | Feature Flags | Status |
|-------|----------|---------------|--------|
| 0. Preparation | 2 hours | Redis only | ✅ Complete |
| 1. Dual-write (Redis reads) | 48-72 hours | USE_POSTGRES=true, DUAL_WRITE=true, READ_FROM_POSTGRES=false | 🔜 Ready |
| 2. Dual-write (PostgreSQL reads) | 48-72 hours | USE_POSTGRES=true, DUAL_WRITE=true, READ_FROM_POSTGRES=true | ⏳ Pending |
| 3. PostgreSQL only | Ongoing | USE_POSTGRES=true, DUAL_WRITE=false, READ_FROM_POSTGRES=true | ⏳ Pending |

**Total Migration Time**: 5-7 days

---

## 🚀 Next Steps

1. ✅ **Review this guide**
2. **Run migration script** (dry-run first)
3. **Update .env** for Phase 1
4. **Deploy to production**
5. **Monitor for 48 hours**
6. **Proceed to Phase 2**

---

**END OF GUIDE**
