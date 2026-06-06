#!/usr/bin/env bash
# mirror-base.sh
#
# Mirror the upstream base images (nginx, redis, pgvector) into the
# private registry so the prod VM can pull EVERYTHING — app + infra — from the
# local registry and needs zero Docker Hub egress at runtime.
#
# Run on the BUILD machine (which has Docker Hub access). Invoked automatically
# by build-push.sh (`make push`); can also be run standalone via `make mirror-base`.
#
# REGISTRY must end with a trailing slash if non-empty (e.g. 192.168.x.x:5000/).
# When REGISTRY is empty this is a no-op (nothing to mirror to).
#
# NOTE: registry:2 is intentionally NOT mirrored — the registry container can't
# be served by the registry it *is* (chicken-and-egg). Seed it on the VM with a
# one-time Docker Hub pull or `docker save`/`load`.
set -euo pipefail

: "${REGISTRY:=}"

# Keep these tags in sync with the ${REGISTRY}… overrides in
# docker-compose.prod.yml. Override the set via BASE_IMAGES="img1 img2 …".
BASE_IMAGES="${BASE_IMAGES:-nginx:latest redis:7 pgvector/pgvector:pg17}"

if [ -z "$REGISTRY" ]; then
  echo "==> REGISTRY not set — skipping base-image mirror"
  exit 0
fi

echo "==> Mirroring base images into ${REGISTRY}"
for img in $BASE_IMAGES; do
  echo "    ${img} -> ${REGISTRY}${img}"
  docker pull "$img"
  docker tag "$img" "${REGISTRY}${img}"
  docker push "${REGISTRY}${img}"
done
echo "==> Base images mirrored."
