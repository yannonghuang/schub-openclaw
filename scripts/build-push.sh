#!/usr/bin/env bash
# Build the custom service images and push them to a registry.
#
# Usage:
#   REGISTRY=ghcr.io/yourorg/ TAG=1.2.0 ./scripts/build-push.sh
#
# Set REGISTRY and TAG in your .env or pass them as env vars.
# REGISTRY must end with a trailing slash if non-empty.
# Defaults to local images (no push) when REGISTRY is unset.
#
# Incremental by default: each image is rebuilt only when the content of its
# source paths has changed since the last successful build (a sha256 of those
# paths is cached under .push-cache/). Unchanged images skip the build; then
# ALL images are tagged + pushed. Push is layer/content-addressed, so pushing an
# unchanged image is near-free and also re-uploads anything missing after a
# registry reset — which is why this single path replaces the old build-all /
# skip-build split.
#
# FORCE=1 rebuilds every image regardless of source changes (use after a base
# image bump or a floating-tag dependency change that the source hash can't see).

set -euo pipefail

: "${REGISTRY:=}"
: "${TAG:=latest}"
: "${FORCE:=0}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
CACHE_DIR="$REPO_ROOT/.push-cache"
mkdir -p "$CACHE_DIR"

# JVM-based builds (the Kotlin allocator-backend Gradle wrapper) ignore the
# HTTP(S)_PROXY env vars, so derive JVM proxy system properties for them from the
# shell proxy env. localhost/127.0.0.1 is rewritten to host.docker.internal so the
# build container can reach a proxy running on the host (Docker Desktop). Override
# by exporting GRADLE_PROXY_OPTS yourself; leave the proxy env unset for direct egress.
: "${GRADLE_PROXY_OPTS:=}"
if [ -z "$GRADLE_PROXY_OPTS" ]; then
  _proxy="${HTTPS_PROXY:-${https_proxy:-${HTTP_PROXY:-${http_proxy:-}}}}"
  if [ -n "$_proxy" ]; then
    _hp="${_proxy#*://}"; _hp="${_hp%%/*}"          # strip scheme + path → host:port
    _host="${_hp%%:*}"; _port="${_hp##*:}"
    [ "$_port" = "$_hp" ] && _port=8080             # no :port in URL → default
    case "$_host" in localhost|127.0.0.1|0.0.0.0) _host=host.docker.internal ;; esac
    GRADLE_PROXY_OPTS="-Dhttp.proxyHost=$_host -Dhttp.proxyPort=$_port -Dhttps.proxyHost=$_host -Dhttps.proxyPort=$_port -Dhttp.nonProxyHosts=localhost|127.0.0.1|host.docker.internal"
    echo "==> Gradle build proxy derived from env: ${_host}:${_port} (override via GRADLE_PROXY_OPTS=)"
  fi
fi

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

# Per-image source paths used for change detection. Derived from each image's
# build context + Dockerfile COPY lines, so a change anywhere a build actually
# reads from invalidates only that image. Paths may live in the sibling
# allocator_inno_kotlin repo (../). Keep in sync with the Dockerfiles.
src_paths_for() {
  case "$1" in
    schub-openclaw-auth-service)       echo "services/auth shared" ;;
    schub-openclaw-openclaw)           echo "openclaw" ;;
    schub-openclaw-adaptor)            echo "services/adaptor" ;;
    schub-openclaw-switch-service)     echo "services/switch" ;;
    schub-openclaw-audit-service)      echo "services/audit services/auth/data" ;;
    schub-openclaw-frontend-service)   echo "frontend" ;;
    schub-openclaw-mcp-server)         echo "mcp-server" ;;
    schub-openclaw-allocator-backend)  echo "../allocator_inno_kotlin/backend-kotlin" ;;
    schub-openclaw-allocator-frontend) echo "../allocator_inno_kotlin/frontend" ;;
    *) echo "" ;;
  esac
}

# Content hash of a set of paths — independent of mtimes; ignores build artifacts
# and VCS metadata so they never trigger a rebuild.
hash_paths() {
  find "$@" \
      \( -path '*/node_modules/*' -o -path '*/.git/*' -o -path '*/build/*' \
         -o -path '*/.gradle/*' -o -path '*/.next/*' -o -path '*/__pycache__/*' \) -prune \
      -o -type f -print0 2>/dev/null \
    | LC_ALL=C sort -z | xargs -0 sha256sum 2>/dev/null | sha256sum | cut -d' ' -f1
}

# Per-image build dispatcher.
# Note: the two Next.js frontends build --no-cache (build-arg/env baked in); with
#       change-gating they now only rebuild when their own source changed.
build_image() {
  case "$1" in
    schub-openclaw-auth-service)
      docker build --target prod -t schub-openclaw-auth-service \
        -f services/auth/Dockerfile .
      ;;
    schub-openclaw-openclaw)
      docker compose --env-file .env.dev \
        -f docker-compose.yml -f docker-compose.dev.yml \
        build openclaw
      ;;
    schub-openclaw-adaptor)
      docker compose --env-file .env.dev \
        -f docker-compose.yml -f docker-compose.dev.yml \
        build adaptor
      ;;
    schub-openclaw-switch-service)
      docker build --target prod -t schub-openclaw-switch-service \
        -f services/switch/Dockerfile .
      ;;
    schub-openclaw-audit-service)
      docker build --target prod -t schub-openclaw-audit-service \
        -f services/audit/Dockerfile .
      ;;
    schub-openclaw-frontend-service)
      docker build --no-cache --target prod -t schub-openclaw-frontend-service \
        -f frontend/Dockerfile ./frontend
      ;;
    schub-openclaw-mcp-server)
      docker build --target prod -t schub-openclaw-mcp-server \
        -f mcp-server/dockerfile ./mcp-server
      ;;
    schub-openclaw-allocator-backend)
      if [ -n "${GRADLE_PROXY_OPTS:-}" ]; then
        docker compose --env-file .env.dev \
          -f docker-compose.yml -f docker-compose.dev.yml \
          build --build-arg GRADLE_PROXY_OPTS="$GRADLE_PROXY_OPTS" allocator-backend
      else
        docker compose --env-file .env.dev \
          -f docker-compose.yml -f docker-compose.dev.yml \
          build allocator-backend
      fi
      ;;
    schub-openclaw-allocator-frontend)
      docker build --no-cache --target runner -t schub-openclaw-allocator-frontend \
        ../allocator_inno_kotlin/frontend
      ;;
    *)
      echo "ERROR: unknown image '$1'" >&2
      return 1
      ;;
  esac
}

echo "==> Building changed images (REGISTRY='${REGISTRY}' TAG='${TAG}' FORCE=${FORCE})"
for src in "${SRC[@]}"; do
  paths="$(src_paths_for "$src")"
  cache_file="$CACHE_DIR/${src}.hash"
  new_hash="$(hash_paths $paths)"
  old_hash=""
  [ -f "$cache_file" ] && old_hash="$(cat "$cache_file")"

  if [ "$FORCE" = "1" ]; then
    reason="forced"
  elif ! docker image inspect "$src" >/dev/null 2>&1; then
    reason="missing-local"
  elif [ "$new_hash" != "$old_hash" ]; then
    reason="changed"
  else
    echo "    [skip]  $src (unchanged)"
    continue
  fi

  echo "    [build] $src ($reason)"
  build_image "$src"
  echo "$new_hash" > "$cache_file"   # record only after a successful build
done

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

# Also mirror the upstream base images (nginx/redis/pgvector) into the
# registry so the prod VM pulls everything from local — no Docker Hub at runtime.
# (Only reached when REGISTRY is set; the empty case exits above.)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"${SCRIPT_DIR}/mirror-base.sh"

echo "==> Done."
