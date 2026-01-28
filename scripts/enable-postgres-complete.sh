#!/bin/bash

# Enable PostgreSQL with Complete Configuration
# This script adds ALL required PostgreSQL environment variables and secrets

set -e

REGION="eu-west-2"
TASK_FAMILY="story-writing-backend"
SERVICE_NAME="story-writing-backend"
CLUSTER_NAME="story-writing-cluster-sai"

# PostgreSQL Configuration
POSTGRES_HOST="story-writing-postgres.cxsu2memgs31.eu-west-2.rds.amazonaws.com"
POSTGRES_PORT="5432"
POSTGRES_DB="story_writing"
POSTGRES_USER="story_user"
POSTGRES_PASSWORD_SECRET_ARN="arn:aws:secretsmanager:eu-west-2:220065406343:secret:story-writing/postgres-password-ZcZdnZ"
POSTGRES_MAX_CONNECTIONS="20"

echo "=========================================="
echo "Enable PostgreSQL - Complete Configuration"
echo "=========================================="
echo ""
echo "This will add:"
echo "  ✓ PostgreSQL connection details (host, port, db, user)"
echo "  ✓ PostgreSQL password (from Secrets Manager)"
echo "  ✓ Migration feature flags"
echo ""
echo "Phase 2 Configuration:"
echo "  - USE_POSTGRES=true"
echo "  - DUAL_WRITE=true"
echo "  - READ_FROM_POSTGRES=false"
echo ""
echo "Behavior:"
echo "  - Writes: BOTH Redis AND PostgreSQL"
echo "  - Reads: Redis"
echo ""

# Get the current task definition
echo "📥 Fetching current task definition..."
TASK_DEF=$(aws ecs describe-task-definition \
  --task-definition $TASK_FAMILY \
  --region $REGION \
  --query 'taskDefinition' \
  --output json)

# Extract necessary fields
TASK_ROLE_ARN=$(echo $TASK_DEF | jq -r '.taskRoleArn')
EXECUTION_ROLE_ARN=$(echo $TASK_DEF | jq -r '.executionRoleArn')
NETWORK_MODE=$(echo $TASK_DEF | jq -r '.networkMode')
CPU=$(echo $TASK_DEF | jq -r '.cpu')
MEMORY=$(echo $TASK_DEF | jq -r '.memory')
CONTAINER_DEFS=$(echo $TASK_DEF | jq -c '.containerDefinitions')
EXISTING_SECRETS=$(echo $TASK_DEF | jq -c '.containerDefinitions[0].secrets // []')

echo "✅ Current task definition retrieved"
echo ""

# Update environment variables
echo "🔧 Adding PostgreSQL environment variables..."
UPDATED_CONTAINER_DEFS=$(echo $CONTAINER_DEFS | jq --arg pg_host "$POSTGRES_HOST" \
  --arg pg_port "$POSTGRES_PORT" \
  --arg pg_db "$POSTGRES_DB" \
  --arg pg_user "$POSTGRES_USER" \
  --arg pg_max_conn "$POSTGRES_MAX_CONNECTIONS" \
  '
  .[0].environment |=
    # Remove existing PostgreSQL and migration vars
    map(select(
      .name != "USE_POSTGRES" and
      .name != "DUAL_WRITE" and
      .name != "READ_FROM_POSTGRES" and
      .name != "POSTGRES_HOST" and
      .name != "POSTGRES_PORT" and
      .name != "POSTGRES_DB" and
      .name != "POSTGRES_USER" and
      .name != "POSTGRES_MAX_CONNECTIONS"
    )) +
    # Add all PostgreSQL configuration
    [
      {"name": "USE_POSTGRES", "value": "true"},
      {"name": "DUAL_WRITE", "value": "true"},
      {"name": "READ_FROM_POSTGRES", "value": "false"},
      {"name": "POSTGRES_HOST", "value": $pg_host},
      {"name": "POSTGRES_PORT", "value": $pg_port},
      {"name": "POSTGRES_DB", "value": $pg_db},
      {"name": "POSTGRES_USER", "value": $pg_user},
      {"name": "POSTGRES_MAX_CONNECTIONS", "value": $pg_max_conn}
    ]
')

echo "✅ Environment variables configured:"
echo "   USE_POSTGRES=true"
echo "   DUAL_WRITE=true"
echo "   READ_FROM_POSTGRES=false"
echo "   POSTGRES_HOST=$POSTGRES_HOST"
echo "   POSTGRES_PORT=$POSTGRES_PORT"
echo "   POSTGRES_DB=$POSTGRES_DB"
echo "   POSTGRES_USER=$POSTGRES_USER"
echo "   POSTGRES_MAX_CONNECTIONS=$POSTGRES_MAX_CONNECTIONS"
echo ""

# Add PostgreSQL password secret
echo "🔐 Adding PostgreSQL password from Secrets Manager..."
UPDATED_CONTAINER_DEFS=$(echo $UPDATED_CONTAINER_DEFS | jq --arg secret_arn "$POSTGRES_PASSWORD_SECRET_ARN" '
  .[0].secrets |=
    # Remove existing POSTGRES_PASSWORD secret if any
    (if . then map(select(.name != "POSTGRES_PASSWORD")) else [] end) +
    # Add the PostgreSQL password secret
    [{"name": "POSTGRES_PASSWORD", "valueFrom": $secret_arn}]
')

echo "✅ Secret configured: POSTGRES_PASSWORD (from Secrets Manager)"
echo ""

# Register new task definition
echo "📝 Registering new task definition..."
NEW_TASK_DEF=$(aws ecs register-task-definition \
  --family $TASK_FAMILY \
  --task-role-arn "$TASK_ROLE_ARN" \
  --execution-role-arn "$EXECUTION_ROLE_ARN" \
  --network-mode "$NETWORK_MODE" \
  --requires-compatibilities FARGATE \
  --cpu "$CPU" \
  --memory "$MEMORY" \
  --container-definitions "$UPDATED_CONTAINER_DEFS" \
  --region $REGION \
  --query 'taskDefinition.taskDefinitionArn' \
  --output text)

echo "✅ New task definition registered: $NEW_TASK_DEF"
echo ""

# Update the ECS service
echo "🚀 Updating ECS service..."
aws ecs update-service \
  --cluster $CLUSTER_NAME \
  --service $SERVICE_NAME \
  --task-definition $TASK_FAMILY \
  --force-new-deployment \
  --region $REGION \
  --output json > /dev/null

echo "✅ ECS service updated - rolling deployment initiated"
echo ""
echo "=========================================="
echo "Deployment Started - Phase 2 (Dual-Write)"
echo "=========================================="
echo ""
echo "Next steps:"
echo ""
echo "  1. Monitor deployment status:"
echo "     aws ecs describe-services --cluster $CLUSTER_NAME --services $SERVICE_NAME --region $REGION"
echo ""
echo "  2. Watch logs for migration phase:"
echo "     aws logs tail /ecs/story-writing-backend --follow --region $REGION | grep -A5 'Migration Status'"
echo ""
echo "  3. Expected log output:"
echo "     Phase: DUAL_WRITE_READ_REDIS"
echo "     PostgreSQL: Enabled"
echo "     Dual-Write: Active"
echo "     Reading from: Redis"
echo ""
echo "  4. Verify NO PostgreSQL connection errors in logs"
echo ""
echo "  5. Test application health:"
echo "     curl https://story-writing.com/api/health"
echo ""
echo "⚠️  IMPORTANT: Monitor for 48-72 hours before enabling PostgreSQL reads (Phase 3)"
echo ""
