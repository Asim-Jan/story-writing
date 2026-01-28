#!/bin/bash

# Phase 3: Enable PostgreSQL Reads
# This script updates the ECS task definition to read from PostgreSQL while maintaining dual-write

set -e

REGION="eu-west-2"
TASK_FAMILY="story-writing-backend"
SERVICE_NAME="story-writing-backend"
CLUSTER_NAME="story-writing-cluster-sai"

echo "=================================="
echo "Phase 3: Enable PostgreSQL Reads"
echo "=================================="
echo ""
echo "This will update the application to:"
echo "  - USE_POSTGRES=true"
echo "  - DUAL_WRITE=true"
echo "  - READ_FROM_POSTGRES=true (NEW)"
echo ""
echo "Expected behavior:"
echo "  - Writes: BOTH Redis AND PostgreSQL"
echo "  - Reads: PostgreSQL ONLY"
echo ""

# Get current task definition
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

echo "✅ Current task definition retrieved"
echo ""

# Update environment variables to enable PostgreSQL reads
echo "🔧 Updating environment variables..."
UPDATED_CONTAINER_DEFS=$(echo $CONTAINER_DEFS | jq '
  .[0].environment |=
    # Remove existing migration env vars
    map(select(.name != "USE_POSTGRES" and .name != "DUAL_WRITE" and .name != "READ_FROM_POSTGRES")) +
    # Add new values with PostgreSQL reads enabled
    [
      {"name": "USE_POSTGRES", "value": "true"},
      {"name": "DUAL_WRITE", "value": "true"},
      {"name": "READ_FROM_POSTGRES", "value": "true"}
    ]
')

echo "✅ Environment variables updated:"
echo "   USE_POSTGRES=true"
echo "   DUAL_WRITE=true"
echo "   READ_FROM_POSTGRES=true ⭐ (CHANGED)"
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

# Update the service to use the new task definition
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
echo "=================================="
echo "Phase 3 Deployment Started"
echo "=================================="
echo ""
echo "Next steps:"
echo "  1. Monitor deployment status:"
echo "     aws ecs describe-services --cluster $CLUSTER_NAME --services $SERVICE_NAME --region $REGION"
echo ""
echo "  2. Watch logs for migration phase:"
echo "     aws logs tail /ecs/story-writing-backend --follow --region $REGION | grep -A5 'Migration Status'"
echo ""
echo "  3. Expected log output:"
echo "     Phase: DUAL_WRITE_READ_POSTGRES"
echo "     PostgreSQL: Enabled"
echo "     Dual-Write: Active"
echo "     Reading from: PostgreSQL ⭐"
echo ""
echo "  4. Verify health endpoint:"
echo "     curl https://story-writing.com/api/health"
echo ""
echo "⚠️  IMPORTANT: Monitor for 48-72 hours before proceeding to Phase 4"
echo ""
