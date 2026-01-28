#!/bin/bash

# Enable Dual-Write Mode on AWS ECS
# This script updates the task definition to enable dual-write mode

set -e

REGION="eu-west-2"
TASK_FAMILY="story-writing-backend"
SERVICE_NAME="story-writing-backend"
CLUSTER_NAME="story-writing-cluster-sai"

echo "🔄 Enabling Dual-Write Mode on AWS..."
echo ""

# Get the current task definition
echo "📥 Fetching current task definition..."
TASK_DEF=$(aws ecs describe-task-definition \
  --task-definition $TASK_FAMILY \
  --region $REGION \
  --query 'taskDefinition' \
  --output json)

# Extract the current task definition details
CONTAINER_DEFS=$(echo $TASK_DEF | jq -r '.containerDefinitions')
TASK_ROLE_ARN=$(echo $TASK_DEF | jq -r '.taskRoleArn')
EXECUTION_ROLE_ARN=$(echo $TASK_DEF | jq -r '.executionRoleArn')
NETWORK_MODE=$(echo $TASK_DEF | jq -r '.networkMode')
REQUIRES_COMPATIBILITIES=$(echo $TASK_DEF | jq -r '.requiresCompatibilities')
CPU=$(echo $TASK_DEF | jq -r '.cpu')
MEMORY=$(echo $TASK_DEF | jq -r '.memory')

# Update environment variables for dual-write mode
echo "🔧 Updating environment variables for dual-write mode..."
UPDATED_CONTAINER_DEFS=$(echo $CONTAINER_DEFS | jq '
  .[0].environment |=
    # First, remove any existing migration env vars
    map(select(.name != "USE_POSTGRES" and .name != "DUAL_WRITE" and .name != "READ_FROM_POSTGRES")) +
    # Then add the new values
    [
      {"name": "USE_POSTGRES", "value": "true"},
      {"name": "DUAL_WRITE", "value": "true"},
      {"name": "READ_FROM_POSTGRES", "value": "false"}
    ]
')

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

# Update the ECS service to use the new task definition
echo "🚀 Updating ECS service to use new task definition..."
aws ecs update-service \
  --cluster $CLUSTER_NAME \
  --service $SERVICE_NAME \
  --task-definition $TASK_FAMILY \
  --force-new-deployment \
  --region $REGION \
  --query 'service.{serviceName:serviceName,taskDefinition:taskDefinition,desiredCount:desiredCount}' \
  --output table

echo ""
echo "✅ Dual-write mode enabled!"
echo ""
echo "📊 Expected configuration:"
echo "   - USE_POSTGRES=true"
echo "   - DUAL_WRITE=true"
echo "   - READ_FROM_POSTGRES=false"
echo ""
echo "🔍 Monitor deployment:"
echo "   aws ecs describe-services --cluster $CLUSTER_NAME --services $SERVICE_NAME --region $REGION"
echo ""
echo "📋 Check logs:"
echo "   Look for: 'Phase: DUAL_WRITE_READ_REDIS' in CloudWatch logs"
echo ""
