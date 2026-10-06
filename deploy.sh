#!/bin/bash

# Deployment script — builds the ONE app image (backend + SPA), pushes to the
# SAI registry (registry.solutionsai.co.uk), pins the exact digest in the cluster.
# Usage: ./deploy.sh [frontend|backend|all] [patch|minor|major]

set -e

# The SAI registry (in-cluster Zot) is the home of app images. Docker Hub is a
# PUBLIC surface — pushing app images there was blocked in the 2026-10-06 review.
SAI_REGISTRY="registry.solutionsai.co.uk/solutionsai"
SAI_IMAGE="$SAI_REGISTRY/story-writing-backend"


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

# Credentials: the SAI registry login comes from the user's own docker
# credentials (docker login registry.solutionsai.co.uk — no token plumbing in
# this script; the keychain-holding config is used read-only via a copy).
DOCKER_AUTH_DIR=$(mktemp -d)
trap "rm -rf $DOCKER_AUTH_DIR" EXIT

if ! docker-credential-desktop get <<< "https://registry.solutionsai.co.uk" > "$DOCKER_AUTH_DIR/cred.json" 2>/dev/null; then
    echo -e "${RED}No registry.solutionsai.co.uk credentials in the keychain. Run: docker login registry.solutionsai.co.uk${NC}"
    exit 1
fi
CRED=$(cat "$DOCKER_AUTH_DIR/cred.json")

if [ -z "$CRED" ]; then
    echo -e "${RED}No registry.solutionsai.co.uk credentials found. Run: docker login registry.solutionsai.co.uk${NC}"
    exit 1
fi

REG_URL="https://registry.solutionsai.co.uk"
USERNAME=$(echo "$CRED" | python3 -c "import json,sys; print(json.load(sys.stdin).get('Username',''))")
SECRET=$(echo "$CRED" | python3 -c "import json,sys; print(json.load(sys.stdin).get('Secret',''))")
REG_AUTH=$(printf '%s:%s' "$USERNAME" "$SECRET" | base64)
echo "{\"auths\":{\"$REG_URL\":{\"auth\":\"$REG_AUTH\"}}}" > "$DOCKER_AUTH_DIR/config.json"

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
    local extra_args=("$@")

    local tags=(-t "$SAI_IMAGE:$NEW_VERSION" -t "$SAI_IMAGE:latest")

    DOCKER_CONFIG="$DOCKER_AUTH_DIR" docker buildx build \
        --platform linux/amd64 \
        --provenance=false \
        --sbom=false \
        "${tags[@]}" "${extra_args[@]}" --push

    # Capture the pushed digest — the k8s manifests pin by digest, never by tag.
    local digest
    digest=$(docker buildx imagetools inspect "$SAI_IMAGE:$NEW_VERSION" 2>/dev/null | awk '/^Digest:/ {print $2}')
    if [ -z "$digest" ]; then
        echo -e "${RED}✗ Could not read the pushed digest — refusing to roll out an unpinned ref${NC}"
        exit 1
    fi
    echo "$SAI_IMAGE@$digest" > /tmp/sw-image-ref.txt
    echo -e "${GREEN}✓ Pushed $SAI_IMAGE:$NEW_VERSION (digest $digest)${NC}"
}

# k3s rollout helper — skips gracefully if kubectl not configured
k3s_rollout() {
    local deployment=$1
    local image_ref=${2:-}
    if kubectl config current-context &>/dev/null; then
        echo -e "${GREEN}Rolling out $deployment in k3s...${NC}"
        if [ -n "$image_ref" ]; then
            kubectl set image deployment/$deployment "$deployment=$image_ref" -n $K8S_NAMESPACE
        else
            kubectl rollout restart deployment/$deployment -n $K8S_NAMESPACE
        fi
        kubectl rollout status deployment/$deployment -n $K8S_NAMESPACE --timeout=300s
    else
        echo -e "${YELLOW}kubectl not configured — skipping k3s rollout for $deployment${NC}"
        echo -e "${YELLOW}Run 'kubectl set image deployment/$deployment -n $K8S_NAMESPACE' manually once cluster is set up${NC}"
    fi
}

# Build and push the ONE app image (backend + the built frontend it serves;
# the nginx frontend deployment is gone — SAI-Cloud shape)
deploy_app() {
    echo -e "${GREEN}Building app v$NEW_VERSION (VITE_API_URL=$VITE_API_URL)...${NC}"
    build_and_push \
        --build-arg VITE_API_URL=$VITE_API_URL \
        -f Dockerfile.backend .
    IMAGE_REF=$(cat /tmp/sw-image-ref.txt 2>/dev/null)
    # The k8s manifests pin images BY DIGEST in Solutions-AI-LTD/story-writing —
    # a kubectl set image here would be reverted by the next manifest apply.
    # The pin is changed by a PR there (the deploy.sh in that repo's
    # pipeline does the rollout); this script only builds + pushes + reports.
    echo -e "${GREEN}✓ App v$NEW_VERSION pushed${NC}"
    echo -e "${YELLOW}Pin this digest via a manifest PR: $IMAGE_REF${NC}"
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
