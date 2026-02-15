#!/bin/bash

# Script to stop AWS services to save costs
# Run this when you're done working for the day

set -e

REGION="eu-west-2"
CLUSTER="story-writing-cluster-sai"
RDS_INSTANCE="story-writing-postgres"

echo "🛑 Stopping AWS Services..."
echo "================================"

# Stop ECS Services (set desired count to 0)
echo ""
echo "📦 Stopping ECS Services..."
aws ecs update-service \
  --cluster $CLUSTER \
  --service story-writing-backend \
  --desired-count 0 \
  --region $REGION \
  --no-cli-pager > /dev/null 2>&1

aws ecs update-service \
  --cluster $CLUSTER \
  --service story-writing-frontend \
  --desired-count 0 \
  --region $REGION \
  --no-cli-pager > /dev/null 2>&1

echo "  ✓ Backend service stopped (desired count: 0)"
echo "  ✓ Frontend service stopped (desired count: 0)"

# Stop RDS Instance
echo ""
echo "🗄️  Stopping RDS Database..."
aws rds stop-db-instance \
  --db-instance-identifier $RDS_INSTANCE \
  --region $REGION \
  --no-cli-pager > /dev/null 2>&1

echo "  ✓ RDS instance '$RDS_INSTANCE' stopping..."

# Note: ElastiCache (Redis) doesn't have a stop feature
# You can only delete/create it, so we'll leave it running
# It's cheaper than RDS anyway (~$13/month for cache.t2.micro)

echo ""
echo "✅ Services Stopped!"
echo "================================"
echo ""
echo "ℹ️  Notes:"
echo "  • Backend & Frontend: Tasks stopped (no charges)"
echo "  • RDS Database: Stopping (will be stopped in ~5 min)"
echo "  • Redis (ElastiCache): Still running (no stop option)"
echo "  • Load Balancer: Still running (~$16/month)"
echo ""
echo "💡 To start services again, run: ./start-services.sh"
echo ""
