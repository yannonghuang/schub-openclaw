#!/bin/sh
# Generate openclaw.json from template, substituting env vars
envsubst < /home/node/.openclaw/openclaw.json.template > /home/node/.openclaw/openclaw.json

# Copy custom skills into /app/skills/ so OpenClaw can find them.
# Symlinks are rejected by OpenClaw's path-containment check (resolves outside root).
for d in /home/node/.openclaw/skills/*/; do
    [ -d "$d" ] && cp -r "$d" "/app/skills/$(basename "$d")"
done

exec docker-entrypoint.sh "$@"
