#!/usr/bin/env bash
# Build all custom service images and push them to a registry.
#
# Usage:
#   REGISTRY=ghcr.io/yourorg/ TAG=1.2.0 ./scripts/build-push.sh
#
# Set REGISTRY and TAG in your .env or pass them as env vars.
# REGISTRY must end with a trailing slash if non-empty.
# Defaults to local images (no push) when REGISTRY is unset.

set -euo pipefail

: "${REGISTRY:=}"
: "${TAG:=latest}"

echo "==> Building images (REGISTRY='${REGISTRY}' TAG='${TAG}')"

# Build all services (uses image: labels added to docker-compose.yml)
REGISTRY="$REGISTRY" TAG="$TAG" docker compose build \
  auth-service \
  openclaw \
  adaptor \
  switch-service \
  audit-service \
  frontend-service \
  mcp-server \
  allocator-backend \
  allocator-frontend

if [ -z "$REGISTRY" ]; then
  echo "==> REGISTRY not set — skipping push (images available locally)"
  exit 0
fi

echo "==> Pushing images to ${REGISTRY}"

IMAGES=(
  "schub-auth"
  "schub-openclaw"
  "schub-adaptor"
  "schub-switch"
  "schub-audit"
  "schub-frontend"
  "schub-mcp"
  "schub-allocator-backend"
  "schub-allocator-frontend"
)

for name in "${IMAGES[@]}"; do
  echo "    pushing ${REGISTRY}${name}:${TAG}"
  docker push "${REGISTRY}${name}:${TAG}"
done

echo "==> Done. Deploy with:"
echo "    REGISTRY='${REGISTRY}' TAG='${TAG}' docker compose -f docker-compose.prod.yml pull"
echo "    REGISTRY='${REGISTRY}' TAG='${TAG}' docker compose -f docker-compose.prod.yml up -d"
