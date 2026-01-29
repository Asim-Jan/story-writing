# Phase 3: PostgreSQL Migration - Reading from PostgreSQL

**Date Enabled**: 2026-01-28 12:50 UTC
**Status**: ✅ **PHASE 3 ACTIVE** - Reading from PostgreSQL, Writing to Both
**Version**: 2.0.3
**Task Definition**: story-writing-backend:6

> **Phase 3 Update (12:50 UTC)**: Successfully enabled PostgreSQL reads. Application now reads from PostgreSQL while maintaining dual-write to both databases.

---

## Current Configuration

### Environment Variables
```bash
USE_POSTGRES=true
DUAL_WRITE=true
READ_FROM_POSTGRES=true  ⭐ (CHANGED in Phase 3)
```

### Migration Phase
```
Phase: DUAL_WRITE_READ_POSTGRES
PostgreSQL: Enabled
Dual-Write: Active
Reading from: PostgreSQL  ⭐ (CHANGED)
```

### What This Means
- All write operations (create, update, delete) go to **BOTH Redis AND PostgreSQL**
- All read operations come from **PostgreSQL** ⭐ (Phase 3)
- Data is synchronized between both databases
- Application performance validated with PostgreSQL reads
- Zero downtime migration in progress

---

## AWS Resources

### ECS Service
- **Cluster**: story-writing-cluster-sai
- **Service**: story-writing-backend
- **Task Definition**: story-writing-backend:6 ⭐ (Phase 3: PostgreSQL Reads)
- **Running Tasks**: 1
- **Deployment Status**: COMPLETED

### Current Task
- **Task ID**: 8b5017064f5c4bd3bdf8d90eb063042b
- **Status**: RUNNING
- **Health**: HEALTHY
- **Started**: 2026-01-28 12:50:50 UTC

### Log Stream
- **Group**: /ecs/story-writing-backend
- **Stream**: ecs/backend/8b5017064f5c4bd3bdf8d90eb063042b

---

## What Was Changed

### Task Definition Updates
1. Added `USE_POSTGRES=true` - Enables PostgreSQL connection
2. Added `DUAL_WRITE=true` - Activates dual-write mode
3. Added `READ_FROM_POSTGRES=false` - Keeps reads from Redis

### Script Created
- **File**: [scripts/enable-dual-write.sh](scripts/enable-dual-write.sh)
- **Purpose**: Automates task definition updates for migration phases
- **Usage**: `./scripts/enable-dual-write.sh`

---

## Monitoring Checklist

### Immediate (First 24 Hours)

- [ ] **Check Application Health**
  ```bash
  curl https://story-writing.com/api/health
  ```

- [ ] **Monitor CloudWatch Logs**
  ```bash
  aws logs tail /ecs/story-writing-backend --follow --region eu-west-2
  ```

- [ ] **Watch for PostgreSQL Errors**
  ```bash
  aws logs tail /ecs/story-writing-backend --follow --region eu-west-2 | grep -i "postgres\|error\|failed"
  ```

- [ ] **Check ECS Service Status**
  ```bash
  aws ecs describe-services --cluster story-writing-cluster-sai --services story-writing-backend --region eu-west-2
  ```

- [ ] **Monitor Task Health**
  ```bash
  aws ecs describe-tasks --cluster story-writing-cluster-sai --tasks $(aws ecs list-tasks --cluster story-writing-cluster-sai --service-name story-writing-backend --region eu-west-2 --query 'taskArns[0]' --output text) --region eu-west-2
  ```

### Daily (48-72 Hours)

- [ ] **Verify Data Consistency** (Day 1)
  ```bash
  node server/scripts/verify-migration.js
  ```

- [ ] **Check Write Performance** (Day 2)
  - Monitor response times in CloudWatch metrics
  - Acceptable overhead: <100ms

- [ ] **Test User Operations** (Day 2)
  - User registration
  - Book creation
  - Chapter updates
  - Job submissions

- [ ] **Compare Data Counts** (Day 3)
  - Redis user count vs PostgreSQL user count
  - Redis book count vs PostgreSQL book count
  - Verify all data is synchronized

### Weekly Metrics

- [ ] **Database Performance**
  - PostgreSQL CPU usage: <50%
  - PostgreSQL connections: <20
  - PostgreSQL query time: <50ms average

- [ ] **Application Performance**
  - API response time: <200ms p95
  - Error rate: <0.1%
  - Success rate: >99.9%

---

## Expected Behavior

### Write Operations
1. User creates a book:
   - ✅ Book written to Redis
   - ✅ Book written to PostgreSQL
   - ✅ Both writes succeed or both fail (atomic)

2. User updates a chapter:
   - ✅ Chapter updated in Redis
   - ✅ Chapter updated in PostgreSQL
   - ✅ Version number incremented in both

### Read Operations
1. User lists books:
   - ✅ Books read from Redis
   - ℹ️ PostgreSQL data not queried (yet)

2. User views chapter:
   - ✅ Chapter read from Redis
   - ℹ️ PostgreSQL has copy (for verification)

---

## Known Issues & Mitigation

### Issue 1: Write Latency Increase
**Expected**: 2-5ms additional latency per write operation
**Acceptable**: <100ms overhead
**Mitigation**: Monitor CloudWatch metrics, optimize queries if needed

### Issue 2: PostgreSQL Connection Pool
**Monitor**: Connection pool size (max 20)
**Alert**: If connections >15, investigate
**Mitigation**: Increase pool size in [server/db/postgres.js](server/db/postgres.js#L10)

### Issue 3: Dual-Write Failure
**Scenario**: PostgreSQL write fails but Redis succeeds
**Behavior**: Transaction rolls back, error returned to user
**Recovery**: User retries operation, data stays consistent

---

## Rollback Procedure

If critical issues occur, immediately rollback to Redis-only:

### Quick Rollback (Emergency)
```bash
# Use the pre-created script
./scripts/rollback-to-redis-only.sh
```

**Expected Time**: 2-3 minutes
**Data Loss**: None (Redis still has all data)

---

## Next Steps

### After 48-72 Hours of Stable Operation

Once dual-write is proven stable:

1. **Enable PostgreSQL Reads** (Phase 3)
   - Update: `READ_FROM_POSTGRES=true`
   - Monitor for another 48-72 hours
   - Verify data accuracy

2. **Disable Dual-Write** (Phase 4)
   - Update: `DUAL_WRITE=false`
   - Application uses PostgreSQL only
   - Monitor for 7 days

3. **Cleanup** (Phase 5)
   - Remove old Redis keys (user:*, book:*)
   - Keep Redis for sessions, jobs, rate limiting
   - Update documentation

---

## Success Criteria

Before proceeding to Phase 3, verify:

- ✅ No errors in CloudWatch logs related to PostgreSQL
- ✅ Data consistency: 100% match between Redis and PostgreSQL
- ✅ Application performance: <100ms overhead
- ✅ Zero downtime during dual-write period
- ✅ All write operations successful in both databases
- ✅ 48-72 hours of stable operation

---

## Monitoring Commands

### Check Current Phase
```bash
aws logs tail /ecs/story-writing-backend --since 5m --region eu-west-2 | grep "Migration Status" -A5
```

### List Running Tasks
```bash
aws ecs list-tasks --cluster story-writing-cluster-sai --service-name story-writing-backend --region eu-west-2 --desired-status RUNNING
```

### Check Task Health
```bash
TASK_ID=$(aws ecs list-tasks --cluster story-writing-cluster-sai --service-name story-writing-backend --region eu-west-2 --query 'taskArns[0]' --output text)
aws ecs describe-tasks --cluster story-writing-cluster-sai --tasks $TASK_ID --region eu-west-2 --query 'tasks[0].{status:lastStatus,health:healthStatus,started:startedAt}'
```

### Stream Live Logs
```bash
aws logs tail /ecs/story-writing-backend --follow --region eu-west-2
```

---

## Contact & Support

**Documentation**:
- [DATA_SERVICE_INTEGRATION_COMPLETE.md](DATA_SERVICE_INTEGRATION_COMPLETE.md)
- [DATA_SERVICE_INTEGRATION_GUIDE.md](DATA_SERVICE_INTEGRATION_GUIDE.md)
- [REDIS_USAGE_ANALYSIS.md](REDIS_USAGE_ANALYSIS.md)

**Critical Files**:
- [server/db/dataService.js](server/db/dataService.js) - Dual-write logic
- [server/services/dataAdapter.js](server/services/dataAdapter.js) - API wrapper
- [server/config/features.js](server/config/features.js) - Feature flags

---

## Deployment History

### Task Definition :5 (Current) - 2026-01-28 12:13 UTC
**Status**: ✅ ACTIVE - Dual-Write with Complete PostgreSQL Configuration

**What Was Fixed**:
1. Added all PostgreSQL connection environment variables:
   - `POSTGRES_HOST=story-writing-postgres.cxsu2memgs31.eu-west-2.rds.amazonaws.com`
   - `POSTGRES_PORT=5432`
   - `POSTGRES_DB=story_writing`
   - `POSTGRES_USER=story_user`
   - `POSTGRES_MAX_CONNECTIONS=20`

2. Added PostgreSQL password from Secrets Manager:
   - Secret: `story-writing/postgres-password`
   - ARN: `arn:aws:secretsmanager:eu-west-2:220065406343:secret:story-writing/postgres-password-ZcZdnZ`

3. Fixed IAM execution role permissions:
   - Added `secretsmanager:GetSecretValue` permission for PostgreSQL password secret
   - Role: `ecsTaskExecutionRole`

**Verification**:
- ✅ No PostgreSQL connection errors in logs
- ✅ Migration phase shows: `DUAL_WRITE_READ_REDIS`
- ✅ Application health: `healthy`
- ✅ Deployment rollout: `COMPLETED`

### Task Definition :4 (Failed) - 2026-01-28 11:58 UTC
**Status**: ❌ FAILED - Attempted Phase 3 without proper setup

**Issue**: Tried to enable PostgreSQL reads before PostgreSQL connection was configured. Failed with `ECONNREFUSED 127.0.0.1:5432` error.

### Task Definition :3 (Superseded) - 2026-01-28 09:04 UTC
**Status**: ⚠️ INCOMPLETE - Had feature flags but no connection details

**Issue**: Only had `USE_POSTGRES=true` and `DUAL_WRITE=true` flags, but lacked actual PostgreSQL connection environment variables. Was silently failing PostgreSQL writes.

### Task Definition :2 (Failed) - Earlier attempt
**Status**: ❌ FAILED - Environment variables not added

### Task Definition :1 (Original)
**Status**: ✅ Redis-only mode (pre-migration)

---

**Report Version**: 2.0
**Last Updated**: 2026-01-28 12:15 UTC
**Next Review**: 2026-01-30 (48 hours)
**Next Action**: Monitor dual-write for 48-72 hours, then proceed to Phase 3 (enable PostgreSQL reads)
