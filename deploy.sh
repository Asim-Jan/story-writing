#!/bin/bash

# Deployment script — builds images and pushes to DockerHub + GHCR, deploys to k3s
# Usage: ./deploy.sh [frontend|backend|all] [patch|minor|major]

set -e

DOCKERHUB_REGISTRY="solutionsai"
DOCKERHUB_BACKEND="$DOCKERHUB_REGISTRY/story-writing-backend"
DOCKERHUB_FRONTEND="$DOCKERHUB_REGISTRY/story-writing-frontend"

GHCR_REGISTRY="ghcr.io/asim-jan"
GHCR_BACKEND="$GHCR_REGISTRY/story-writing-backend"
GHCR_FRONTEND="$GHCR_REGISTRY/story-writing-frontend"

VITE_API_URL="https://story-writing.solutionsai.co.uk"
K8S_NAMESPACE="story-writing"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

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
        major) major=$((major + 1)); minor=0; patch=0 ;;
        minor) minor=$((minor + 1)); patch=0 ;;
        patch) patch=$((patch + 1)) ;;
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
read -p "Deploy v$NEW_VERSION ($SERVICE) to k3s? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${YELLOW}Deployment cancelled${NC}"
    exit 0
fi

# Update VERSION file
echo "$NEW_VERSION" > VERSION

# Get credentials
if [ -z "$DOCKERHUB_TOKEN" ]; then
    echo -e "${YELLOW}DOCKERHUB_TOKEN not set. Enter DockerHub password/token for 'solutionsai':${NC}"
    read -rs DOCKERHUB_TOKEN
    echo
fi

# Build inline Docker config with credentials (bypasses macOS keychain — builder containers can't access it)
DOCKER_AUTH_DIR=$(mktemp -d)
trap "rm -rf $DOCKER_AUTH_DIR" EXIT

DH_AUTH=$(echo -n "solutionsai:$DOCKERHUB_TOKEN" | base64)
AUTH_JSON="{\"auths\":{\"https://index.docker.io/v1/\":{\"auth\":\"$DH_AUTH\"}"

if [ -n "$GITHUB_TOKEN" ]; then
    GHCR_AUTH=$(echo -n "asim-jan:$GITHUB_TOKEN" | base64)
    AUTH_JSON="$AUTH_JSON,\"ghcr.io\":{\"auth\":\"$GHCR_AUTH\"}"
else
    echo -e "${YELLOW}GITHUB_TOKEN not set — skipping GHCR push${NC}"
fi
AUTH_JSON="$AUTH_JSON}}"

echo "$AUTH_JSON" > "$DOCKER_AUTH_DIR/config.json"

# Symlink the buildx CLI plugin into the temp config dir.
# When DOCKER_CONFIG is overridden, Docker looks for plugins in
# $DOCKER_CONFIG/cli-plugins/ — without this symlink it falls back to plain
# `docker build` which doesn't understand --platform.
mkdir -p "$DOCKER_AUTH_DIR/cli-plugins"
for plugin_dir in \
    "$HOME/.docker/cli-plugins" \
    "/usr/local/lib/docker/cli-plugins" \
    "/usr/local/libexec/docker/cli-plugins" \
    "/Applications/Docker.app/Contents/Resources/cli-plugins"; do
    if [ -f "$plugin_dir/docker-buildx" ]; then
        ln -sf "$plugin_dir/docker-buildx" "$DOCKER_AUTH_DIR/cli-plugins/docker-buildx"
        break
    fi
done
if [ ! -L "$DOCKER_AUTH_DIR/cli-plugins/docker-buildx" ]; then
    echo -e "${RED}docker-buildx plugin not found — cannot continue${NC}"
    exit 1
fi

echo -e "${GREEN}Credentials configured${NC}"

# Ensure we use a docker-container builder.
# Create it under DOCKER_CONFIG=$DOCKER_AUTH_DIR so the builder registration and
# inline credentials live in the same context (otherwise buildx can't find the
# builder when DOCKER_CONFIG is overridden during `buildx build`).
docker buildx rm sw-builder 2>/dev/null || true
DOCKER_CONFIG="$DOCKER_AUTH_DIR" docker buildx rm sw-builder 2>/dev/null || true
echo -e "${GREEN}Creating buildx builder...${NC}"
DOCKER_CONFIG="$DOCKER_AUTH_DIR" docker buildx create --name sw-builder --driver docker-container --use --bootstrap

# Build helper — passes inline auth config so builder container can push without macOS keychain
build_and_push() {
    local dh_tag=$1
    local ghcr_tag=$2
    shift 2
    local extra_args=("$@")

    local tags=(-t "$dh_tag:$NEW_VERSION" -t "$dh_tag:latest")
    if [ -n "$GITHUB_TOKEN" ]; then
        tags+=(-t "$ghcr_tag:$NEW_VERSION" -t "$ghcr_tag:latest")
    fi

    DOCKER_CONFIG="$DOCKER_AUTH_DIR" docker buildx build \
        --platform linux/amd64 \
        --provenance=false \
        --sbom=false \
        "${tags[@]}" "${extra_args[@]}" --push
}

# k3s rollout helper — skips gracefully if kubectl not configured
k3s_rollout() {
    local deployment=$1
    if kubectl config current-context &>/dev/null; then
        echo -e "${GREEN}Rolling out $deployment in k3s...${NC}"
        kubectl rollout restart deployment/$deployment -n $K8S_NAMESPACE
        kubectl rollout status deployment/$deployment -n $K8S_NAMESPACE --timeout=120s
    else
        echo -e "${YELLOW}kubectl not configured — skipping k3s rollout for $deployment${NC}"
        echo -e "${YELLOW}Run 'kubectl rollout restart deployment/$deployment -n $K8S_NAMESPACE' manually once cluster is set up${NC}"
    fi
}

# Build and push the ONE app image (backend + the built frontend it serves;
# the nginx frontend deployment is gone — SAI-Cloud shape)
deploy_app() {
    echo -e "${GREEN}Building app v$NEW_VERSION (VITE_API_URL=$VITE_API_URL)...${NC}"
    build_and_push "$DOCKERHUB_BACKEND" "$GHCR_BACKEND" \
        --build-arg VITE_API_URL=$VITE_API_URL \
        -f Dockerfile.backend .
    k3s_rollout backend
    k3s_rollout worker
    echo -e "${GREEN}✓ App v$NEW_VERSION pushed${NC}"
}

# Deploy based on service argument
case $SERVICE in
    backend|frontend|all|app)  deploy_app ;;
    *)
        echo -e "${RED}Invalid service. Use: all, app, backend, or frontend${NC}"
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
echo -e "${YELLOW}Check pod status:${NC}"
echo "  kubectl get pods -n $K8S_NAMESPACE"
echo "  kubectl logs deploy/backend -n $K8S_NAMESPACE --tail=50"
