# AWS Deployment Reference Guide

**Project**: Story Writing Studio
**Last Updated**: 2026-01-28
**Current Version**: 2.0.3
**Current Phase**: Phase 3 - Reading from PostgreSQL

---

## AWS Resource Names and IDs

### ECS Configuration
```bash
REGION="eu-west-2"
CLUSTER_NAME="story-writing-cluster-sai"
SERVICE_NAME="story-writing-backend"
TASK_FAMILY="story-writing-backend"
```

### Current Task Definitions
- **story-writing-backend:1** - Original Redis-only deployment
- **story-writing-backend:2** - Failed dual-write attempt (env vars not added)
- **story-writing-backend:3** - Incomplete (missing PostgreSQL connection details)
- **story-writing-backend:4** - Failed (attempted Phase 3 prematurely)
- **story-writing-backend:5** - Phase 2 (dual-write, read from Redis)
- **story-writing-backend:6** - ✅ Current active (Phase 3: dual-write, read from PostgreSQL)

### Task Definitions Available
```
story-writing-backend:1
story-writing-backend:2
story-writing-backend:3
story-writing-worker:1
story-writing-frontend:1
```

### CloudWatch Logs
```bash
LOG_GROUP="/ecs/story-writing-backend"
LOG_STREAM_PREFIX="ecs/backend/"
```

### Current Running Task
```bash
TASK_ID="7fae2f7fb0d64b85a87eaba41a7439c9"
STATUS="RUNNING"
HEALTH="HEALTHY"
STARTED="2026-01-28 09:04:57 UTC"
```

---

## Docker & ECR Configuration

### ECR Repository
```bash
AWS_REGION="eu-west-2"
AWS_ACCOUNT_ID="220065406343"
ECR_REPO="story-writing-backend"
ECR_URI="220065406343.dkr.ecr.eu-west-2.amazonaws.com/story-writing-backend"
```

### Build and Push Docker Image

```bash
# 1. Authenticate Docker to ECR
aws ecr get-login-password --region eu-west-2 | \
  docker login --username AWS --password-stdin \
  220065406343.dkr.ecr.eu-west-2.amazonaws.com

# 2. Build the image
docker build -t story-writing-backend:latest .

# 3. Tag the image
docker tag story-writing-backend:latest \
  220065406343.dkr.ecr.eu-west-2.amazonaws.com/story-writing-backend:latest

# 4. Push to ECR
docker push 220065406343.dkr.ecr.eu-west-2.amazonaws.com/story-writing-backend:latest
```

### Version Tagging Strategy
```bash
# Tag with semantic version
docker tag story-writing-backend:latest \
  220065406343.dkr.ecr.eu-west-2.amazonaws.com/story-writing-backend:2.0.2

# Push versioned tag
docker push 220065406343.dkr.ecr.eu-west-2.amazonaws.com/story-writing-backend:2.0.2
```

---

## ECS Task Definition Management

### Get Current Task Definition
```bash
aws ecs describe-task-definition \
  --task-definition story-writing-backend \
  --region eu-west-2 \
  --query 'taskDefinition' \
  --output json
```

### Register New Task Definition

**Method 1: Using Script** (Recommended for migration phases)
```bash
# Use the automated script for dual-write enablement
./scripts/enable-dual-write.sh
```

**Method 2: Manual Registration**
```bash
# 1. Get current task definition and save to file
aws ecs describe-task-definition \
  --task-definition story-writing-backend \
  --region eu-west-2 \
  --query 'taskDefinition' > task-def.json

# 2. Edit task-def.json (remove revision, status, etc.)
# 3. Register new version
aws ecs register-task-definition \
  --cli-input-json file://task-def.json \
  --region eu-west-2
```

### Update Environment Variables in Task Definition

**Using jq to add/update environment variables**:
```bash
# Extract current container definitions
CONTAINER_DEFS=$(aws ecs describe-task-definition \
  --task-definition story-writing-backend \
  --region eu-west-2 \
  --query 'taskDefinition.containerDefinitions' \
  --output json)

# Add or update environment variables
UPDATED_DEFS=$(echo $CONTAINER_DEFS | jq '
  .[0].environment |=
    # Remove any existing vars you want to replace
    map(select(.name != "USE_POSTGRES" and .name != "DUAL_WRITE" and .name != "READ_FROM_POSTGRES")) +
    # Add new values
    [
      {"name": "USE_POSTGRES", "value": "true"},
      {"name": "DUAL_WRITE", "value": "true"},
      {"name": "READ_FROM_POSTGRES", "value": "false"}
    ]
')

# Register new task definition with updated container definitions
aws ecs register-task-definition \
  --family story-writing-backend \
  --task-role-arn "arn:aws:iam::220065406343:role/ecsTaskExecutionRole" \
  --execution-role-arn "arn:aws:iam::220065406343:role/ecsTaskExecutionRole" \
  --network-mode awsvpc \
  --requires-compatibilities FARGATE \
  --cpu "256" \
  --memory "512" \
  --container-definitions "$UPDATED_DEFS" \
  --region eu-west-2
```

### Check Environment Variables in Task Definition
```bash
aws ecs describe-task-definition \
  --task-definition story-writing-backend:3 \
  --region eu-west-2 \
  --query 'taskDefinition.containerDefinitions[0].environment[?name==`USE_POSTGRES` || name==`DUAL_WRITE` || name==`READ_FROM_POSTGRES`]'
```

---

## ECS Service Deployment

### Update Service to Use New Task Definition
```bash
aws ecs update-service \
  --cluster story-writing-cluster-sai \
  --service story-writing-backend \
  --task-definition story-writing-backend \
  --force-new-deployment \
  --region eu-west-2
```

### Check Service Status
```bash
aws ecs describe-services \
  --cluster story-writing-cluster-sai \
  --services story-writing-backend \
  --region eu-west-2 \
  --query 'services[0].{serviceName:serviceName,taskDefinition:taskDefinition,runningCount:runningCount,desiredCount:desiredCount,deployments:deployments}' \
  --output json
```

### List Running Tasks
```bash
aws ecs list-tasks \
  --cluster story-writing-cluster-sai \
  --service-name story-writing-backend \
  --region eu-west-2 \
  --desired-status RUNNING
```

### Describe Running Task
```bash
# Get task ARN first
TASK_ARN=$(aws ecs list-tasks \
  --cluster story-writing-cluster-sai \
  --service-name story-writing-backend \
  --region eu-west-2 \
  --desired-status RUNNING \
  --query 'taskArns[0]' \
  --output text)

# Describe the task
aws ecs describe-tasks \
  --cluster story-writing-cluster-sai \
  --tasks $TASK_ARN \
  --region eu-west-2 \
  --query 'tasks[0].{taskArn:taskArn,lastStatus:lastStatus,healthStatus:healthStatus,taskDefinitionArn:taskDefinitionArn,startedAt:startedAt}'
```

---

## CloudWatch Logs Monitoring

### Stream Live Logs
```bash
aws logs tail /ecs/story-writing-backend --follow --region eu-west-2
```

### Get Recent Logs
```bash
aws logs tail /ecs/story-writing-backend --since 5m --region eu-west-2
```

### Get Logs from Specific Task
```bash
aws logs get-log-events \
  --log-group-name /ecs/story-writing-backend \
  --log-stream-name "ecs/backend/7fae2f7fb0d64b85a87eaba41a7439c9" \
  --region eu-west-2 \
  --limit 50
```

### Search for Migration Status
```bash
aws logs tail /ecs/story-writing-backend --since 5m --region eu-west-2 | grep "Migration Status" -A5
```

### Monitor for Errors
```bash
aws logs tail /ecs/story-writing-backend --follow --region eu-west-2 | grep -i "error\|failed\|postgres"
```

---

## Application Health & Verification

### Check Application Health Endpoint
```bash
curl -s https://story-writing.com/api/health | jq
```

**Expected Response**:
```json
{
  "status": "healthy",
  "timestamp": "2026-01-28T09:40:54.623Z",
  "uptime": 2126.955619521,
  "services": {
    "redis": {
      "status": "connected",
      "host": "book-writing-redis-v2.cigq1e.0001.euw2.cache.amazonaws.com",
      "port": "6379"
    },
    "apiKeys": {
      "openai": true,
      "gemini": true
    }
  }
}
```

### Verify Migration Phase in Logs
```bash
aws logs tail /ecs/story-writing-backend --since 1m --region eu-west-2 | grep "Phase:"
```

**Expected Output for Current State**:
```
Phase: DUAL_WRITE_READ_REDIS
PostgreSQL: Enabled
Dual-Write: Active
Reading from: Redis
```

---

## Current Environment Variables (Dual-Write Phase)

```bash
# Migration Configuration
USE_POSTGRES=true
DUAL_WRITE=true
READ_FROM_POSTGRES=false

# Database Connections
POSTGRES_HOST=story-writing-db.cigq1e.eu-west-2.rds.amazonaws.com
POSTGRES_PORT=5432
POSTGRES_DB=story_writing
POSTGRES_USER=story_admin
POSTGRES_PASSWORD=[secure password]
POSTGRES_MAX_CONNECTIONS=20

REDIS_HOST=book-writing-redis-v2.cigq1e.0001.euw2.cache.amazonaws.com
REDIS_PORT=6379

# AWS Configuration
AWS_REGION=eu-west-2
S3_BUCKET=story-writing-uploads

# Application
NODE_ENV=production
PORT=3001
```

---

## Migration Phase Scripts

### Enable Dual-Write Mode
```bash
./scripts/enable-dual-write.sh
```

**What it does**:
1. Fetches current task definition
2. Updates environment variables to enable dual-write
3. Registers new task definition
4. Updates ECS service
5. Triggers rolling deployment

### Enable PostgreSQL Reads (Phase 3 - Not Yet Run)
```bash
# Future script: ./scripts/enable-postgres-reads.sh
# Will set: READ_FROM_POSTGRES=true
```

### Complete Migration (Phase 4 - Not Yet Run)
```bash
# Future script: ./scripts/complete-migration.sh
# Will set: DUAL_WRITE=false, USE_POSTGRES=true, READ_FROM_POSTGRES=true
```

### Rollback to Redis-Only
```bash
# Emergency rollback script
./scripts/rollback-to-redis-only.sh
```

---

## Common Deployment Workflows

### 1. Deploy Code Changes (No Config Changes)

```bash
# 1. Build and push new Docker image
docker build -t story-writing-backend:latest .
docker tag story-writing-backend:latest \
  220065406343.dkr.ecr.eu-west-2.amazonaws.com/story-writing-backend:latest
docker push 220065406343.dkr.ecr.eu-west-2.amazonaws.com/story-writing-backend:latest

# 2. Force new deployment (pulls latest image)
aws ecs update-service \
  --cluster story-writing-cluster-sai \
  --service story-writing-backend \
  --force-new-deployment \
  --region eu-west-2

# 3. Monitor deployment
aws ecs describe-services \
  --cluster story-writing-cluster-sai \
  --services story-writing-backend \
  --region eu-west-2 \
  --query 'services[0].deployments'

# 4. Watch logs
aws logs tail /ecs/story-writing-backend --follow --region eu-west-2
```

### 2. Deploy with Environment Variable Changes

```bash
# 1. Build and push new Docker image (if code changed)
docker build -t story-writing-backend:latest .
docker push 220065406343.dkr.ecr.eu-west-2.amazonaws.com/story-writing-backend:latest

# 2. Update task definition with new env vars
# Use scripts/enable-dual-write.sh as template, or manually:
# - Fetch current task def
# - Modify environment variables with jq
# - Register new task definition

# 3. Update service
aws ecs update-service \
  --cluster story-writing-cluster-sai \
  --service story-writing-backend \
  --task-definition story-writing-backend \
  --region eu-west-2

# 4. Verify new task definition is running
aws ecs describe-services \
  --cluster story-writing-cluster-sai \
  --services story-writing-backend \
  --region eu-west-2 \
  --query 'services[0].taskDefinition'
```

### 3. Rollback to Previous Task Definition

```bash
# 1. Identify previous task definition version
aws ecs list-task-definitions \
  --family-prefix story-writing-backend \
  --region eu-west-2

# 2. Update service to use specific version
aws ecs update-service \
  --cluster story-writing-cluster-sai \
  --service story-writing-backend \
  --task-definition story-writing-backend:1 \
  --region eu-west-2

# 3. Monitor rollback
aws logs tail /ecs/story-writing-backend --follow --region eu-west-2
```

---

## Troubleshooting Common Issues

### Issue: Task Fails to Start

**Check task stopped reason**:
```bash
aws ecs describe-tasks \
  --cluster story-writing-cluster-sai \
  --tasks [failed-task-arn] \
  --region eu-west-2 \
  --query 'tasks[0].{stoppedReason:stoppedReason,containers:containers[0].reason}'
```

**Common causes**:
- Image pull failure (check ECR permissions)
- Port conflict (check security group rules)
- Environment variable missing (check task definition)
- Resource limits (check CPU/memory)

### Issue: Environment Variables Not Applied

**Verify task definition env vars**:
```bash
aws ecs describe-task-definition \
  --task-definition story-writing-backend:3 \
  --region eu-west-2 \
  --query 'taskDefinition.containerDefinitions[0].environment' \
  --output table
```

**Check running task is using correct definition**:
```bash
aws ecs describe-tasks \
  --cluster story-writing-cluster-sai \
  --tasks [task-arn] \
  --region eu-west-2 \
  --query 'tasks[0].taskDefinitionArn'
```

### Issue: Deployment Stuck

**Check deployment status**:
```bash
aws ecs describe-services \
  --cluster story-writing-cluster-sai \
  --services story-writing-backend \
  --region eu-west-2 \
  --query 'services[0].deployments'
```

**Cancel stuck deployment and redeploy**:
```bash
# Stop the service temporarily
aws ecs update-service \
  --cluster story-writing-cluster-sai \
  --service story-writing-backend \
  --desired-count 0 \
  --region eu-west-2

# Wait for tasks to stop, then restart
aws ecs update-service \
  --cluster story-writing-cluster-sai \
  --service story-writing-backend \
  --desired-count 1 \
  --force-new-deployment \
  --region eu-west-2
```

---

## Migration Status Tracking

### Current Status (2026-01-28)

**Phase**: 2 - Dual-Write Mode Active
**Task Definition**: story-writing-backend:3
**Task ID**: 7fae2f7fb0d64b85a87eaba41a7439c9
**Status**: RUNNING and HEALTHY
**Deployment**: COMPLETED

**Configuration**:
- ✅ USE_POSTGRES=true
- ✅ DUAL_WRITE=true
- ✅ READ_FROM_POSTGRES=false

**Behavior**:
- Writes go to: **BOTH Redis AND PostgreSQL**
- Reads come from: **Redis**

### Next Steps

1. **Monitor for 48-72 hours** (until ~2026-01-30)
   - Watch CloudWatch logs for errors
   - Verify data consistency
   - Monitor application performance
   - Check PostgreSQL connection pool usage

2. **Phase 3: Enable PostgreSQL Reads**
   - Update: `READ_FROM_POSTGRES=true`
   - Monitor for another 48-72 hours
   - Verify read performance acceptable

3. **Phase 4: Complete Migration**
   - Update: `DUAL_WRITE=false`
   - Application uses PostgreSQL only
   - Redis keeps only sessions, jobs, rate limiting

4. **Phase 5: Cleanup**
   - Remove old Redis keys (user:\*, book:\*)
   - Update documentation
   - Archive migration scripts

---

## Important Files Reference

### Migration Scripts
- [scripts/enable-dual-write.sh](scripts/enable-dual-write.sh) - Enables dual-write mode
- [scripts/rollback-to-redis-only.sh](scripts/rollback-to-redis-only.sh) - Emergency rollback

### Documentation
- [DUAL_WRITE_STATUS.md](DUAL_WRITE_STATUS.md) - Current dual-write status and monitoring
- [DATA_SERVICE_INTEGRATION_COMPLETE.md](DATA_SERVICE_INTEGRATION_COMPLETE.md) - Phase 1 completion
- [PHASE2_POSTGRESQL_PLAN.md](PHASE2_POSTGRESQL_PLAN.md) - Full migration plan

### Code Files
- [server/db/dataService.js](server/db/dataService.js) - Dual-write logic
- [server/config/features.js](server/config/features.js) - Feature flags
- [server/db/postgres.js](server/db/postgres.js) - PostgreSQL connection
- [server/services/dataAdapter.js](server/services/dataAdapter.js) - API wrapper

---

## Quick Reference Commands

```bash
# View live logs
aws logs tail /ecs/story-writing-backend --follow --region eu-west-2

# Check service status
aws ecs describe-services --cluster story-writing-cluster-sai --services story-writing-backend --region eu-west-2

# Check health endpoint
curl -s https://story-writing.com/api/health | jq

# List running tasks
aws ecs list-tasks --cluster story-writing-cluster-sai --service-name story-writing-backend --region eu-west-2 --desired-status RUNNING

# Deploy new code
docker build -t story-writing-backend:latest . && \
docker tag story-writing-backend:latest 220065406343.dkr.ecr.eu-west-2.amazonaws.com/story-writing-backend:latest && \
docker push 220065406343.dkr.ecr.eu-west-2.amazonaws.com/story-writing-backend:latest && \
aws ecs update-service --cluster story-writing-cluster-sai --service story-writing-backend --force-new-deployment --region eu-west-2
```

---

**Document Version**: 1.0
**Last Verified**: 2026-01-28 09:40 UTC
