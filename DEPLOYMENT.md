# Deployment Guide

## Versioning Strategy

This project uses **Semantic Versioning** (SemVer):
- **MAJOR** (X.0.0): Breaking changes or major new features
- **MINOR** (0.X.0): New features, backwards compatible
- **PATCH** (0.0.X): Bug fixes, small improvements

## Quick Deploy

### Deploy Everything (Recommended)
```bash
./deploy.sh all patch    # Bug fixes
./deploy.sh all minor    # New features
./deploy.sh all major    # Breaking changes
```

### Deploy Individual Services
```bash
./deploy.sh backend patch    # Deploy only backend
./deploy.sh frontend minor   # Deploy only frontend
```

## Manual Deployment

If you prefer manual control:

### 1. Update Version
```bash
echo "1.0.1" > VERSION
```

### 2. Login to ECR
```bash
aws ecr get-login-password --region eu-west-2 | docker login --username AWS --password-stdin 220065406343.dkr.ecr.eu-west-2.amazonaws.com
```

### 3. Build & Push Backend
```bash
VERSION=$(cat VERSION)
docker buildx build --platform linux/amd64 \
  -t 220065406343.dkr.ecr.eu-west-2.amazonaws.com/story-writing/story-writing-backend:$VERSION \
  -t 220065406343.dkr.ecr.eu-west-2.amazonaws.com/story-writing/story-writing-backend:latest \
  -f Dockerfile.backend . --load

docker push 220065406343.dkr.ecr.eu-west-2.amazonaws.com/story-writing/story-writing-backend:$VERSION
docker push 220065406343.dkr.ecr.eu-west-2.amazonaws.com/story-writing/story-writing-backend:latest
```

### 4. Build & Push Frontend
```bash
VERSION=$(cat VERSION)
docker buildx build --platform linux/amd64 \
  -t 220065406343.dkr.ecr.eu-west-2.amazonaws.com/story-writing/story-writing-frontend:$VERSION \
  -t 220065406343.dkr.ecr.eu-west-2.amazonaws.com/story-writing/story-writing-frontend:latest \
  --build-arg VITE_API_URL=https://story-writing.com \
  -f Dockerfile.frontend . --load

docker push 220065406343.dkr.ecr.eu-west-2.amazonaws.com/story-writing/story-writing-frontend:$VERSION
docker push 220065406343.dkr.ecr.eu-west-2.amazonaws.com/story-writing/story-writing-frontend:latest
```

### 5. Deploy to ECS
```bash
# Backend
aws ecs update-service \
  --cluster story-writing-cluster-sai \
  --service story-writing-backend \
  --force-new-deployment \
  --region eu-west-2

# Frontend
aws ecs update-service \
  --cluster story-writing-cluster-sai \
  --service story-writing-frontend \
  --force-new-deployment \
  --region eu-west-2
```

## Check Deployment Status

```bash
# Backend status
aws ecs describe-services \
  --cluster story-writing-cluster-sai \
  --services story-writing-backend \
  --region eu-west-2 \
  --query 'services[0].deployments[0].rolloutState'

# Frontend status
aws ecs describe-services \
  --cluster story-writing-cluster-sai \
  --services story-writing-frontend \
  --region eu-west-2 \
  --query 'services[0].deployments[0].rolloutState'
```

## Rollback to Previous Version

If something goes wrong:

```bash
# List available versions
aws ecr describe-images \
  --repository-name story-writing/story-writing-backend \
  --region eu-west-2 \
  --query 'sort_by(imageDetails,& imagePushedAt)[*].imageTags[0]'

# Update task definition to use specific version
# Then force new deployment
```

## Best Practices

1. **Always test locally** before deploying
2. **Update CHANGELOG.md** with changes
3. **Tag git commits** with version numbers
4. **Use patch** for bug fixes and small changes
5. **Use minor** for new features
6. **Use major** for breaking changes
7. **Keep both versioned and latest tags** for flexibility

## Environment Variables

### Backend (.env)
- `OPENAI_API_KEY` - System default OpenAI key
- `GEMINI_API_KEY` - System default Gemini key
- `JWT_SECRET` - JWT signing secret
- `REDIS_URL` - Redis connection URL
- `MINIO_*` - MinIO storage credentials

### Frontend (build args)
- `VITE_API_URL` - Backend API URL (https://story-writing.com)

## Current Version

Check current version:
```bash
cat VERSION
```

## Infrastructure

- **Region**: eu-west-2 (London)
- **Cluster**: story-writing-cluster-sai
- **Services**: story-writing-backend, story-writing-frontend
- **ALB**: story-writing-alb
- **Domain**: story-writing.com (via Cloudflare)
- **SSL**: Cloudflare (Free SSL)
