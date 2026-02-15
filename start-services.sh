#!/bin/bash

# Script to start AWS services when you're ready to work
# Run this when you start working

set -e

REGION="eu-west-2"
CLUSTER="story-writing-cluster-sai"
RDS_INSTANCE="story-writing-postgres"

echo "🚀 Starting AWS Services..."
echo "================================"

# Start RDS Instance
echo ""
echo "🗄️  Starting RDS Database..."
RDS_STATUS=$(aws rds describe-db-instances \
  --db-instance-identifier $RDS_INSTANCE \
  --region $REGION \
  --query 'DBInstances[0].DBInstanceStatus' \
  --output text 2>/dev/null || echo "not-found")

if [ "$RDS_STATUS" = "stopped" ]; then
  aws rds start-db-instance \
    --db-instance-identifier $RDS_INSTANCE \
    --region $REGION \
    --no-cli-pager > /dev/null 2>&1
  echo "  ✓ RDS instance '$RDS_INSTANCE' starting..."
  echo "  ⏳ Waiting for database to become available (this takes ~5 minutes)..."

  # Wait for RDS to be available
  aws rds wait db-instance-available \
    --db-instance-identifier $RDS_INSTANCE \
    --region $REGION

  echo "  ✅ Database is now available!"
elif [ "$RDS_STATUS" = "available" ]; then
  echo "  ℹ️  RDS instance is already running"
elif [ "$RDS_STATUS" = "starting" ]; then
  echo "  ⏳ RDS instance is already starting..."
  aws rds wait db-instance-available \
    --db-instance-identifier $RDS_INSTANCE \
    --region $REGION
  echo "  ✅ Database is now available!"
else
  echo "  ⚠️  RDS instance status: $RDS_STATUS"
fi

# Start ECS Services (set desired count to 1)
echo ""
echo "📦 Starting ECS Services..."
aws ecs update-service \
  --cluster $CLUSTER \
  --service story-writing-backend \
  --desired-count 1 \
  --region $REGION \
  --no-cli-pager > /dev/null 2>&1

aws ecs update-service \
  --cluster $CLUSTER \
  --service story-writing-frontend \
  --desired-count 1 \
  --region $REGION \
  --no-cli-pager > /dev/null 2>&1

echo "  ✓ Backend service starting (desired count: 1)"
echo "  ✓ Frontend service starting (desired count: 1)"

echo ""
echo "⏳ Waiting for services to become healthy (~2-3 minutes)..."
sleep 10

# Wait for tasks to be running
echo "  • Backend task starting..."
aws ecs wait services-stable \
  --cluster $CLUSTER \
  --services story-writing-backend \
  --region $REGION

echo "  • Frontend task starting..."
aws ecs wait services-stable \
  --cluster $CLUSTER \
  --services story-writing-frontend \
  --region $REGION

echo ""
echo "✅ All Services Started!"
echo "================================"
echo ""
echo "🌐 Your application should be available at:"
echo "   https://storywriting.co.uk"
echo ""
echo "⚠️  Note: It may take another 1-2 minutes for the"
echo "   load balancer health checks to pass."
echo ""
echo "💡 To stop services when done, run: ./stop-services.sh"
echo ""
