#!/bin/bash

# Script to check the status of AWS services
# Run this to see what's currently running

REGION="eu-west-2"
CLUSTER="story-writing-cluster-sai"
RDS_INSTANCE="story-writing-postgres"
REDIS_CLUSTER="book-writing-redis-v2"
EC2_INSTANCE="i-082e8caea2703fbc2"

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
  --cache-cluster-id $REDIS_CLUSTER \
  --region $REGION \
  --query 'CacheClusters[0].CacheClusterStatus' \
  --output text 2>/dev/null || echo "not-found")

case "$REDIS_STATUS" in
  "available")
    echo "  ✅ Status: Running (available)"
    ;;
  "not-found" | "")
    echo "  ⭕ Status: Deleted (will be recreated on start)"
    ;;
  "creating")
    echo "  ⏳ Status: Creating..."
    ;;
  "deleting")
    echo "  ⏳ Status: Deleting..."
    ;;
  *)
    echo "  ⚠️  Status: $REDIS_STATUS"
    ;;
esac

# Check EC2 Instance
echo ""
echo "🖥️  EC2 Instance (MinIO):"
EC2_STATUS=$(aws ec2 describe-instances \
  --instance-ids $EC2_INSTANCE \
  --region $REGION \
  --query 'Reservations[0].Instances[0].State.Name' \
  --output text 2>/dev/null || echo "not-found")

case "$EC2_STATUS" in
  "running")
    echo "  ✅ Status: Running"
    ;;
  "stopped")
    echo "  ⭕ Status: Stopped"
    ;;
  "pending")
    echo "  ⏳ Status: Starting..."
    ;;
  "stopping")
    echo "  ⏳ Status: Stopping..."
    ;;
  *)
    echo "  ⚠️  Status: $EC2_STATUS"
    ;;
esac

# Check Application Load Balancer
echo ""
echo "🌐 Load Balancer:"
LB_STATE=$(aws elbv2 describe-load-balancers \
  --names story-writing-alb \
  --region $REGION \
  --query 'LoadBalancers[0].State.Code' \
  --output text 2>/dev/null || echo "not-found")

LB_DNS=$(aws elbv2 describe-load-balancers \
  --names story-writing-alb \
  --region $REGION \
  --query 'LoadBalancers[0].DNSName' \
  --output text 2>/dev/null || echo "")

case "$LB_STATE" in
  "active")
    echo "  ✅ Status: Active"
    echo "     DNS: $LB_DNS"
    ;;
  "not-found" | "None" | "")
    echo "  ⭕ Status: Deleted (will be recreated on start)"
    ;;
  "provisioning")
    echo "  ⏳ Status: Provisioning..."
    ;;
  *)
    echo "  ⚠️  Status: $LB_STATE"
    ;;
esac

# Estimate costs based on current state
echo ""
echo "💰 Cost Estimates:"

# Calculate running/stopped costs
if [ "$BACKEND_COUNT" -gt 0 ] && [ "$FRONTEND_COUNT" -gt 0 ]; then
  ECS_STATUS="  ✅ ECS Fargate:         ~\$20-30/month (running)"
else
  ECS_STATUS="  ⭕ ECS Fargate:         \$0 (stopped)"
fi

case "$RDS_STATUS" in
  "available") RDS_COST="  ✅ RDS (t3.micro):      ~\$13/month (running)" ;;
  "stopped")   RDS_COST="  ⭕ RDS (t3.micro):      ~\$0/month (stopped)" ;;
  *)           RDS_COST="  ⚠️  RDS (t3.micro):      unknown status" ;;
esac

case "$REDIS_STATUS" in
  "available")     REDIS_COST="  ✅ Redis (t3.micro):    ~\$9/month (running)" ;;
  "not-found" | "") REDIS_COST="  ⭕ Redis (t3.micro):    \$0 (deleted)" ;;
  *)               REDIS_COST="  ⚠️  Redis (t3.micro):    unknown status" ;;
esac

case "$EC2_STATUS" in
  "running") EC2_COST="  ✅ EC2 Instance:        ~\$8/month (running)" ;;
  "stopped") EC2_COST="  ⭕ EC2 Instance:        ~\$0 (stopped, EBS minimal)" ;;
  *)         EC2_COST="  ⚠️  EC2 Instance:        unknown status" ;;
esac

case "$LB_STATE" in
  "active")       ALB_COST="  ✅ Load Balancer:       ~\$16/month (running)" ;;
  "not-found"|"") ALB_COST="  ⭕ Load Balancer:       \$0 (deleted)" ;;
  *)              ALB_COST="  ⚠️  Load Balancer:       $LB_STATE" ;;
esac

echo "$ECS_STATUS"
echo "$RDS_COST"
echo "$REDIS_COST"
echo "$EC2_COST"
echo "$ALB_COST"
echo "  ✅ Secrets Manager:     ~\$2.50/month (always on)"
echo ""
echo "💡 Run ./stop-services.sh when done to minimize costs"
echo "   Run ./start-services.sh when ready to work"
echo ""
