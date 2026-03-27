#!/bin/sh
# Generate openclaw.json from template, substituting env vars
envsubst < /home/node/.openclaw/openclaw.json.template > /home/node/.openclaw/openclaw.json
exec docker-entrypoint.sh "$@"
