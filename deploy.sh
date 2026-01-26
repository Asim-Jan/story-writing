#!/bin/bash

# Deployment script with semantic versioning
# Usage: ./deploy.sh [frontend|backend|all] [patch|minor|major]

set -e

REGION="eu-west-2"
CLUSTER="story-writing-cluster-sai"
ECR_REGISTRY="220065406343.dkr.ecr.eu-west-2.amazonaws.com/story-writing"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Read current version
CURRENT_VERSION=$(cat VERSION)
echo -e "${GREEN}Current version: $CURRENT_VERSION${NC}"

# Function to increment version
increment_version() {
    local version=$1
    local increment_type=$2

    IFS='.' read -r -a parts <<< "$version"
    major="${parts[0]}"
    minor="${parts[1]}"
    patch="${parts[2]}"

    case $increment_type in
        major)
            major=$((major + 1))
            minor=0
            patch=0
            ;;
        minor)
            minor=$((minor + 1))
            patch=0
            ;;
        patch)
            patch=$((patch + 1))
            ;;
        *)
            echo -e "${RED}Invalid increment type. Use: major, minor, or patch${NC}"
            exit 1
            ;;
    esac

    echo "$major.$minor.$patch"
}

# Parse arguments
SERVICE=${1:-all}
INCREMENT=${2:-patch}

# Calculate new version
NEW_VERSION=$(increment_version "$CURRENT_VERSION" "$INCREMENT")
echo -e "${GREEN}New version: $NEW_VERSION${NC}"

# Confirm deployment
read -p "Deploy version $NEW_VERSION? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${YELLOW}Deployment cancelled${NC}"
    exit 0
fi

# Update VERSION file
echo "$NEW_VERSION" > VERSION

# Login to ECR
echo -e "${GREEN}Logging in to ECR...${NC}"
aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin $ECR_REGISTRY

# Function to build and push backend
deploy_backend() {
    echo -e "${GREEN}Building backend v$NEW_VERSION...${NC}"
    docker buildx build --platform linux/amd64 \
        -t $ECR_REGISTRY/story-writing-backend:$NEW_VERSION \
        -t $ECR_REGISTRY/story-writing-backend:latest \
        -f Dockerfile.backend . --load

    echo -e "${GREEN}Pushing backend images...${NC}"
    docker push $ECR_REGISTRY/story-writing-backend:$NEW_VERSION
    docker push $ECR_REGISTRY/story-writing-backend:latest

    echo -e "${GREEN}Deploying backend to ECS...${NC}"
    aws ecs update-service \
        --cluster $CLUSTER \
        --service story-writing-backend \
        --force-new-deployment \
        --region $REGION \
        --no-cli-pager > /dev/null

    echo -e "${GREEN}✓ Backend v$NEW_VERSION deployed${NC}"
}

# Function to build and push frontend
deploy_frontend() {
    echo -e "${GREEN}Building frontend v$NEW_VERSION...${NC}"
    docker buildx build --platform linux/amd64 \
        -t $ECR_REGISTRY/story-writing-frontend:$NEW_VERSION \
        -t $ECR_REGISTRY/story-writing-frontend:latest \
        --build-arg VITE_API_URL=https://story-writing.com \
        -f Dockerfile.frontend . --load

    echo -e "${GREEN}Pushing frontend images...${NC}"
    docker push $ECR_REGISTRY/story-writing-frontend:$NEW_VERSION
    docker push $ECR_REGISTRY/story-writing-frontend:latest

    echo -e "${GREEN}Deploying frontend to ECS...${NC}"
    aws ecs update-service \
        --cluster $CLUSTER \
        --service story-writing-frontend \
        --force-new-deployment \
        --region $REGION \
        --no-cli-pager > /dev/null

    echo -e "${GREEN}✓ Frontend v$NEW_VERSION deployed${NC}"
}

# Deploy based on service argument
case $SERVICE in
    backend)
        deploy_backend
        ;;
    frontend)
        deploy_frontend
        ;;
    all)
        deploy_backend
        deploy_frontend
        ;;
    *)
        echo -e "${RED}Invalid service. Use: frontend, backend, or all${NC}"
        exit 1
        ;;
esac

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Deployment Complete!${NC}"
echo -e "${GREEN}Version: $NEW_VERSION${NC}"
echo -e "${GREEN}Service(s): $SERVICE${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${YELLOW}Deployment in progress. Check status:${NC}"
echo "  Backend:  aws ecs describe-services --cluster $CLUSTER --services story-writing-backend --region $REGION --query 'services[0].deployments[0].rolloutState'"
echo "  Frontend: aws ecs describe-services --cluster $CLUSTER --services story-writing-frontend --region $REGION --query 'services[0].deployments[0].rolloutState'"
