#!/bin/sh
# Fire-and-forget self-callback: POST a `negotiation_recompute` message back to
# THIS material session so Step 1.5/1.6 (re-rating + wait registration) run in a
# FRESH turn. Called from Step 1.7 counter branch after material_engine returns,
# to avoid the compound API-timeout that aborts counter→rate→wait in one turn.
#
# Also touches the per-round idempotency sentinel — only AFTER the counter was
# processed successfully — so an aborted counter-turn remains retryable.
#
# Argv: SESSION_UUID ROUND
set -e
UUID=$1
ROUND=$2
if [ -z "$UUID" ] || [ -z "$ROUND" ]; then
    echo "usage: $0 SESSION_UUID ROUND" >&2
    exit 1
fi

SENTINEL="/tmp/mat_neg_${UUID}_round_${ROUND}_processed"
LOG="/tmp/mat_neg_${UUID}_round_${ROUND}_callback.log"
SKEY="agent:material:subagent:${UUID}"
TOKEN="${OPENCLAW_TOKEN}"

touch "$SENTINEL"

# 2s sleep lets the current turn flush to sessions.json before the callback
# arrives, so OpenClaw sees a paused session rather than a running one.
# All shell-var interpolation happens in THIS (outer) shell; the inner sh -c
# receives a fully-expanded command so single-quoted -H args are safe.
nohup sh -c "sleep 2 && curl -s -X POST http://openclaw:18789/v1/chat/completions \
  -H 'Authorization: Bearer ${TOKEN}' \
  -H 'x-openclaw-session-key: ${SKEY}' \
  -H 'Content-Type: application/json' \
  -d '{\"model\":\"openclaw:material\",\"messages\":[{\"role\":\"user\",\"content\":\"{\\\"type\\\":\\\"negotiation_recompute\\\",\\\"round\\\":${ROUND}}\"}],\"stream\":false}'" \
  >"$LOG" 2>&1 </dev/null &
disown $! 2>/dev/null || true
echo callback_dispatched
