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

# Services without dev/prod targets (single stage — build once via compose)
# Note: allocator-frontend excluded here — it has separate Dockerfile/Dockerfile.dev;
#       the dev compose uses Dockerfile.dev (no source), so we build prod explicitly below.
docker compose \
  --env-file .env.dev \
  -f docker-compose.yml \
  -f docker-compose.dev.yml \
  build \
  openclaw \
  adaptor \
  allocator-backend

# Services with dev/prod targets — build prod target directly
echo "==> Building prod-targeted services"
docker build --target prod -t schub-openclaw-auth-service \
  -f services/auth/Dockerfile .
docker build --target prod -t schub-openclaw-switch-service \
  -f services/switch/Dockerfile .
docker build --target prod -t schub-openclaw-audit-service \
  -f services/audit/Dockerfile .
docker build --target prod -t schub-openclaw-frontend-service \
  -f frontend/Dockerfile ./frontend
docker build --target prod -t schub-openclaw-mcp-server \
  -f mcp-server/dockerfile ./mcp-server
docker build --target runner -t schub-openclaw-allocator-frontend \
  ../allocator_inno_kotlin/frontend

# Compose source name → registry target name (parallel arrays, bash 3 compatible)
SRC=(
  schub-openclaw-auth-service
  schub-openclaw-openclaw
  schub-openclaw-adaptor
  schub-openclaw-switch-service
  schub-openclaw-audit-service
  schub-openclaw-frontend-service
  schub-openclaw-mcp-server
  schub-openclaw-allocator-backend
  schub-openclaw-allocator-frontend
)
DST=(
  schub-auth
  schub-openclaw
  schub-adaptor
  schub-switch
  schub-audit
  schub-frontend
  schub-mcp
  schub-allocator-backend
  schub-allocator-frontend
)

echo "==> Tagging images"
for i in "${!SRC[@]}"; do
  docker tag "${SRC[$i]}" "${REGISTRY}${DST[$i]}:${TAG}"
  echo "    ${SRC[$i]} -> ${REGISTRY}${DST[$i]}:${TAG}"
done

if [ -z "$REGISTRY" ]; then
  echo "==> REGISTRY not set — skipping push (images tagged locally)"
  exit 0
fi

echo "==> Pushing images to ${REGISTRY}"
for i in "${!DST[@]}"; do
  echo "    pushing ${REGISTRY}${DST[$i]}:${TAG}"
  docker push "${REGISTRY}${DST[$i]}:${TAG}"
done

echo "==> Done."
