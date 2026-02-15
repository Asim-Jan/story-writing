#!/bin/bash

# Script to check the status of AWS services
# Run this to see what's currently running

REGION="eu-west-2"
CLUSTER="story-writing-cluster-sai"
RDS_INSTANCE="story-writing-postgres"

echo "📊 AWS Services Status"
echo "================================"

# Check ECS Services
echo ""
echo "📦 ECS Services:"
BACKEND_COUNT=$(aws ecs describe-services \
  --cluster $CLUSTER \
  --services story-writing-backend \
  --region $REGION \
  --query 'services[0].runningCount' \
  --output text 2>/dev/null || echo "0")

FRONTEND_COUNT=$(aws ecs describe-services \
  --cluster $CLUSTER \
  --services story-writing-frontend \
  --region $REGION \
  --query 'services[0].runningCount' \
  --output text 2>/dev/null || echo "0")

if [ "$BACKEND_COUNT" -gt 0 ]; then
  echo "  ✅ Backend:  Running ($BACKEND_COUNT tasks)"
else
  echo "  ⭕ Backend:  Stopped"
fi

if [ "$FRONTEND_COUNT" -gt 0 ]; then
  echo "  ✅ Frontend: Running ($FRONTEND_COUNT tasks)"
else
  echo "  ⭕ Frontend: Stopped"
fi

# Check RDS
echo ""
echo "🗄️  RDS Database:"
RDS_STATUS=$(aws rds describe-db-instances \
  --db-instance-identifier $RDS_INSTANCE \
  --region $REGION \
  --query 'DBInstances[0].DBInstanceStatus' \
  --output text 2>/dev/null || echo "not-found")

case "$RDS_STATUS" in
  "available")
    echo "  ✅ Status: Running (available)"
    ;;
  "stopped")
    echo "  ⭕ Status: Stopped"
    ;;
  "starting")
    echo "  ⏳ Status: Starting..."
    ;;
  "stopping")
    echo "  ⏳ Status: Stopping..."
    ;;
  "not-found")
    echo "  ❌ Status: Not found"
    ;;
  *)
    echo "  ⚠️  Status: $RDS_STATUS"
    ;;
esac

# Check Redis (ElastiCache)
echo ""
echo "💾 Redis (ElastiCache):"
REDIS_STATUS=$(aws elasticache describe-cache-clusters \
  --cache-cluster-id book-writing-redis-v2 \
  --region $REGION \
  --query 'CacheClusters[0].CacheClusterStatus' \
  --output text 2>/dev/null || echo "not-found")

if [ "$REDIS_STATUS" = "available" ]; then
  echo "  ✅ Status: Running (available)"
else
  echo "  ⚠️  Status: $REDIS_STATUS"
fi

# Check Application Load Balancer
echo ""
echo "🌐 Load Balancer:"
LB_STATE=$(aws elbv2 describe-load-balancers \
  --region $REGION \
  --query 'LoadBalancers[0].State.Code' \
  --output text 2>/dev/null || echo "not-found")

if [ "$LB_STATE" = "active" ]; then
  echo "  ✅ Status: Active"
else
  echo "  ⚠️  Status: $LB_STATE"
fi

# Estimate monthly costs
echo ""
echo "💰 Estimated Monthly Costs (when running):"
echo "  • ECS Fargate:      ~$20-30/month (2 tasks)"
echo "  • RDS (t3.micro):   ~$15-20/month (when running)"
echo "  • Redis (t2.micro): ~$13/month (always on)"
echo "  • Load Balancer:    ~$16/month (always on)"
echo "  • NAT Gateway:      ~$32/month (if used)"
echo "  • Data Transfer:    ~$5-10/month"
echo "  ────────────────────────────────────────"
echo "  Total:              ~$101-121/month"
echo ""
echo "💡 Stop ECS & RDS when not working to save ~$35-50/month"
echo ""
