#!/bin/bash

# Script to stop AWS services to save costs
# Run this when you're done working for the day

set -e

REGION="eu-west-2"
CLUSTER="story-writing-cluster-sai"
RDS_INSTANCE="story-writing-postgres"
REDIS_CLUSTER="book-writing-redis-v2"
EC2_INSTANCE="i-082e8caea2703fbc2"
ALB_NAME="story-writing-alb"

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
RDS_STATUS=$(aws rds describe-db-instances \
  --db-instance-identifier $RDS_INSTANCE \
  --region $REGION \
  --query 'DBInstances[0].DBInstanceStatus' \
  --output text 2>/dev/null || echo "not-found")

if [ "$RDS_STATUS" = "available" ]; then
  aws rds stop-db-instance \
    --db-instance-identifier $RDS_INSTANCE \
    --region $REGION \
    --no-cli-pager > /dev/null 2>&1
  echo "  ✓ RDS instance '$RDS_INSTANCE' stopping..."
elif [ "$RDS_STATUS" = "stopped" ]; then
  echo "  ℹ️  RDS instance is already stopped"
else
  echo "  ⚠️  RDS instance status: $RDS_STATUS (skipping)"
fi

# Delete ElastiCache Redis cluster (no stop feature — delete saves full cost)
# The cluster endpoint stays the same when recreated with the same ID
echo ""
echo "💾 Deleting ElastiCache Redis (to save costs)..."
REDIS_STATUS=$(aws elasticache describe-cache-clusters \
  --cache-cluster-id $REDIS_CLUSTER \
  --region $REGION \
  --query 'CacheClusters[0].CacheClusterStatus' \
  --output text 2>/dev/null || echo "not-found")

if [ "$REDIS_STATUS" = "available" ]; then
  aws elasticache delete-cache-cluster \
    --cache-cluster-id $REDIS_CLUSTER \
    --region $REGION \
    --no-cli-pager > /dev/null 2>&1
  echo "  ✓ Redis cluster '$REDIS_CLUSTER' deleting (~3 min)..."
  echo "  ℹ️  Note: Active sessions will be invalidated (users logged out)"
elif [ "$REDIS_STATUS" = "not-found" ] || [ "$REDIS_STATUS" = "deleting" ]; then
  echo "  ℹ️  Redis cluster already deleted or deleting"
else
  echo "  ⚠️  Redis cluster status: $REDIS_STATUS (skipping)"
fi

# Delete Load Balancer (target groups are kept so ECS service defs stay valid)
echo ""
echo "🌐 Deleting Load Balancer..."
ALB_ARN=$(aws elbv2 describe-load-balancers \
  --names $ALB_NAME \
  --region $REGION \
  --query 'LoadBalancers[0].LoadBalancerArn' \
  --output text 2>/dev/null || echo "None")

if [ "$ALB_ARN" != "None" ] && [ -n "$ALB_ARN" ]; then
  aws elbv2 delete-load-balancer \
    --load-balancer-arn "$ALB_ARN" \
    --region $REGION \
    --no-cli-pager > /dev/null 2>&1
  echo "  ✓ Load balancer '$ALB_NAME' deleted (~saves ~\$16/month)"
  echo "  ℹ️  Target groups kept (ECS service definitions stay intact)"
else
  echo "  ℹ️  Load balancer already deleted"
fi

# Stop EC2 Instance (MinIO / test instance)
echo ""
echo "🖥️  Stopping EC2 Instance..."
EC2_STATUS=$(aws ec2 describe-instances \
  --instance-ids $EC2_INSTANCE \
  --region $REGION \
  --query 'Reservations[0].Instances[0].State.Name' \
  --output text 2>/dev/null || echo "not-found")

if [ "$EC2_STATUS" = "running" ]; then
  aws ec2 stop-instances \
    --instance-ids $EC2_INSTANCE \
    --region $REGION \
    --no-cli-pager > /dev/null 2>&1
  echo "  ✓ EC2 instance '$EC2_INSTANCE' stopping..."
elif [ "$EC2_STATUS" = "stopped" ]; then
  echo "  ℹ️  EC2 instance is already stopped"
else
  echo "  ⚠️  EC2 instance status: $EC2_STATUS (skipping)"
fi

echo ""
echo "✅ Services Stopped!"
echo "================================"
echo ""
echo "ℹ️  Status:"
echo "  • ECS Backend/Frontend: Stopped (no charges)"
echo "  • RDS Database:         Stopping (~5 min, no charges when stopped)"
echo "  • Redis (ElastiCache):  Deleting (~3 min, saves ~\$9/month)"
echo "  • Load Balancer:        Deleted (saves ~\$16/month)"
echo "  • EC2 Instance:         Stopping (saves ~\$2.50/month)"
echo ""
echo "⚠️  DNS note: When you start services, Cloudflare must be updated"
echo "   with the new ALB DNS name. The start script will show you the value."
echo ""
echo "💡 To start services again, run: ./start-services.sh"
echo ""
