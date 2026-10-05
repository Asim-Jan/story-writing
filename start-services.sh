#!/bin/bash

# Script to start AWS services when you're ready to work
# Run this when you start working

set -e

REGION="eu-west-2"
CLUSTER="story-writing-cluster-sai"
RDS_INSTANCE="story-writing-postgres"
REDIS_CLUSTER="book-writing-redis-v2"
REDIS_SUBNET_GROUP="book-writing-redis-subnet-group"
REDIS_SECURITY_GROUP="sg-0c0a02718c29ede7a"
EC2_INSTANCE="i-082e8caea2703fbc2"
ALB_NAME="story-writing-alb"
ALB_SUBNETS="subnet-0bd580683ee8e09bb subnet-0c8bf39d30d1e9efd"
ALB_SECURITY_GROUP="sg-07a34c333fbb045c9"
FRONTEND_TG_ARN="arn:aws:elasticloadbalancing:eu-west-2:220065406343:targetgroup/story-writing-frontend-tg/a8060f608a533d0c"
BACKEND_TG_ARN="arn:aws:elasticloadbalancing:eu-west-2:220065406343:targetgroup/story-writing-backend-tg/8ab027e1abc56f54"
# Optional: set these to auto-update Cloudflare DNS
# CLOUDFLARE_API_TOKEN="your-token-here"
# CLOUDFLARE_ZONE_ID="your-zone-id-here"
# CLOUDFLARE_RECORD_NAME="storywriting.co.uk"

echo "🚀 Starting AWS Services..."
echo "================================"

# Start EC2 Instance (MinIO / test instance)
echo ""
echo "🖥️  Starting EC2 Instance..."
EC2_STATUS=$(aws ec2 describe-instances \
  --instance-ids $EC2_INSTANCE \
  --region $REGION \
  --query 'Reservations[0].Instances[0].State.Name' \
  --output text 2>/dev/null || echo "not-found")

if [ "$EC2_STATUS" = "stopped" ]; then
  aws ec2 start-instances \
    --instance-ids $EC2_INSTANCE \
    --region $REGION \
    --no-cli-pager > /dev/null 2>&1
  echo "  ✓ EC2 instance '$EC2_INSTANCE' starting..."
elif [ "$EC2_STATUS" = "running" ]; then
  echo "  ℹ️  EC2 instance is already running"
elif [ "$EC2_STATUS" = "pending" ]; then
  echo "  ⏳ EC2 instance is already starting..."
else
  echo "  ⚠️  EC2 instance status: $EC2_STATUS"
fi

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
  echo "  ⏳ Waiting for database to become available (~5 minutes)..."
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

# Disable public accessibility on RDS if still enabled (removes public IPv4 EIPs, saves ~$7/month)
RDS_PUBLIC=$(aws rds describe-db-instances \
  --db-instance-identifier $RDS_INSTANCE \
  --region $REGION \
  --query 'DBInstances[0].PubliclyAccessible' \
  --output text 2>/dev/null || echo "unknown")

if [ "$RDS_PUBLIC" = "True" ]; then
  echo "  🔒 Disabling RDS public accessibility (removes public IPs, saves ~\$7/month)..."
  aws rds modify-db-instance \
    --db-instance-identifier $RDS_INSTANCE \
    --no-publicly-accessible \
    --apply-immediately \
    --region $REGION \
    --no-cli-pager > /dev/null 2>&1
  echo "  ✅ RDS public accessibility disabled"
fi

# Recreate ElastiCache Redis cluster if it doesn't exist
echo ""
echo "💾 Starting ElastiCache Redis..."
REDIS_STATUS=$(aws elasticache describe-cache-clusters \
  --cache-cluster-id $REDIS_CLUSTER \
  --region $REGION \
  --query 'CacheClusters[0].CacheClusterStatus' \
  --output text 2>/dev/null || echo "not-found")

if [ "$REDIS_STATUS" = "not-found" ] || [ "$REDIS_STATUS" = "" ]; then
  echo "  ✓ Creating Redis cluster '$REDIS_CLUSTER'..."
  aws elasticache create-cache-cluster \
    --cache-cluster-id $REDIS_CLUSTER \
    --cache-node-type cache.t3.micro \
    --engine redis \
    --engine-version "7.1" \
    --num-cache-nodes 1 \
    --cache-subnet-group-name $REDIS_SUBNET_GROUP \
    --security-group-ids $REDIS_SECURITY_GROUP \
    --region $REGION \
    --no-cli-pager > /dev/null 2>&1
  echo "  ⏳ Waiting for Redis to become available (~5 minutes)..."
  aws elasticache wait cache-cluster-available \
    --cache-cluster-id $REDIS_CLUSTER \
    --region $REGION
  echo "  ✅ Redis is now available!"
elif [ "$REDIS_STATUS" = "available" ]; then
  echo "  ℹ️  Redis cluster is already running"
elif [ "$REDIS_STATUS" = "creating" ]; then
  echo "  ⏳ Redis cluster is already being created..."
  aws elasticache wait cache-cluster-available \
    --cache-cluster-id $REDIS_CLUSTER \
    --region $REGION
  echo "  ✅ Redis is now available!"
elif [ "$REDIS_STATUS" = "deleting" ]; then
  echo "  ⏳ Redis cluster is still deleting, waiting..."
  # Wait for deletion then recreate
  while true; do
    STATUS=$(aws elasticache describe-cache-clusters \
      --cache-cluster-id $REDIS_CLUSTER \
      --region $REGION \
      --query 'CacheClusters[0].CacheClusterStatus' \
      --output text 2>/dev/null || echo "not-found")
    if [ "$STATUS" = "not-found" ] || [ "$STATUS" = "" ]; then
      break
    fi
    echo "    Still deleting... (checking again in 15s)"
    sleep 15
  done
  echo "  ✓ Deleted. Recreating Redis cluster..."
  aws elasticache create-cache-cluster \
    --cache-cluster-id $REDIS_CLUSTER \
    --cache-node-type cache.t3.micro \
    --engine redis \
    --engine-version "7.1" \
    --num-cache-nodes 1 \
    --cache-subnet-group-name $REDIS_SUBNET_GROUP \
    --security-group-ids $REDIS_SECURITY_GROUP \
    --region $REGION \
    --no-cli-pager > /dev/null 2>&1
  echo "  ⏳ Waiting for Redis to become available (~5 minutes)..."
  aws elasticache wait cache-cluster-available \
    --cache-cluster-id $REDIS_CLUSTER \
    --region $REGION
  echo "  ✅ Redis is now available!"
else
  echo "  ⚠️  Redis cluster status: $REDIS_STATUS"
fi

# Recreate Load Balancer if deleted
echo ""
echo "🌐 Starting Load Balancer..."
ALB_ARN=$(aws elbv2 describe-load-balancers \
  --names $ALB_NAME \
  --region $REGION \
  --query 'LoadBalancers[0].LoadBalancerArn' \
  --output text 2>/dev/null || echo "None")

if [ "$ALB_ARN" = "None" ] || [ -z "$ALB_ARN" ]; then
  echo "  ✓ Creating load balancer '$ALB_NAME'..."
  ALB_ARN=$(aws elbv2 create-load-balancer \
    --name $ALB_NAME \
    --subnets $ALB_SUBNETS \
    --security-groups $ALB_SECURITY_GROUP \
    --scheme internet-facing \
    --type application \
    --ip-address-type ipv4 \
    --region $REGION \
    --no-cli-pager \
    --query 'LoadBalancers[0].LoadBalancerArn' \
    --output text 2>/dev/null)

  echo "  ⏳ Waiting for load balancer to become active..."
  aws elbv2 wait load-balancer-available \
    --load-balancer-arns "$ALB_ARN" \
    --region $REGION

  # Create HTTP:80 listener with /api/* → backend, default → frontend
  LISTENER_ARN=$(aws elbv2 create-listener \
    --load-balancer-arn "$ALB_ARN" \
    --protocol HTTP \
    --port 80 \
    --default-actions Type=forward,TargetGroupArn="$FRONTEND_TG_ARN" \
    --region $REGION \
    --no-cli-pager \
    --query 'Listeners[0].ListenerArn' \
    --output text 2>/dev/null)

  aws elbv2 create-rule \
    --listener-arn "$LISTENER_ARN" \
    --priority 1 \
    --conditions Field=path-pattern,Values='/api/*' \
    --actions Type=forward,TargetGroupArn="$BACKEND_TG_ARN" \
    --region $REGION \
    --no-cli-pager > /dev/null 2>/dev/null

  echo "  ✅ Load balancer ready!"

  # Get new DNS name
  NEW_DNS=$(aws elbv2 describe-load-balancers \
    --load-balancer-arns "$ALB_ARN" \
    --region $REGION \
    --query 'LoadBalancers[0].DNSName' \
    --output text 2>/dev/null)

  echo ""
  echo "  ⚠️  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  ⚠️  CLOUDFLARE DNS UPDATE REQUIRED"
  echo "  ⚠️  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  ⚠️  Go to Cloudflare → storywriting.co.uk → DNS"
  echo "  ⚠️  Update the CNAME record to point to:"
  echo "  ⚠️    $NEW_DNS"
  echo "  ⚠️  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  # Auto-update Cloudflare if credentials are set
  if [ -n "$CLOUDFLARE_API_TOKEN" ] && [ -n "$CLOUDFLARE_ZONE_ID" ] && [ -n "$CLOUDFLARE_RECORD_NAME" ]; then
    echo ""
    echo "  🔄 Auto-updating Cloudflare DNS..."
    RECORD_ID=$(curl -s -X GET \
      "https://api.cloudflare.com/client/v4/zones/$CLOUDFLARE_ZONE_ID/dns_records?name=$CLOUDFLARE_RECORD_NAME&type=CNAME" \
      -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
      -H "Content-Type: application/json" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['result'][0]['id'] if d['result'] else '')" 2>/dev/null)

    if [ -n "$RECORD_ID" ]; then
      curl -s -X PUT \
        "https://api.cloudflare.com/client/v4/zones/$CLOUDFLARE_ZONE_ID/dns_records/$RECORD_ID" \
        -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
        -H "Content-Type: application/json" \
        --data "{\"type\":\"CNAME\",\"name\":\"$CLOUDFLARE_RECORD_NAME\",\"content\":\"$NEW_DNS\",\"ttl\":1,\"proxied\":true}" > /dev/null 2>&1
      echo "  ✅ Cloudflare DNS updated automatically!"
    else
      echo "  ⚠️  Could not find Cloudflare record — update manually above"
    fi
  fi
else
  echo "  ℹ️  Load balancer is already running"
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
echo "⏳ Waiting for ECS services to become healthy (~2-3 minutes)..."
sleep 10

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
echo "   If you updated Cloudflare DNS today, allow a few minutes"
echo "   for propagation before the site is reachable."
echo ""
echo "💡 To stop services when done, run: ./stop-services.sh"
echo ""
