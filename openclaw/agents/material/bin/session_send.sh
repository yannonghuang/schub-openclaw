#!/bin/sh
# Inject MESSAGE as a new user turn into an existing OpenClaw session, via the
# gateway's sessions_send tool (POST /tools/invoke). Used for every callback
# into a parked subagent session (order -> material).
#
# OpenClaw >= 2026.6.x rejects `x-openclaw-session-key: agent:<id>:subagent:...`
# on /v1/chat/completions, so that header can no longer target these sessions.
# The call is made from the target agent's own main session so
# `tools.sessions.visibility: "agent"` covers it; the gateway must allow the
# tool over HTTP (`gateway.tools.allow: ["sessions_send"]`).
#
# TIMEOUT_SECONDS=0 (default) queues the turn and returns immediately.
# Prints `callback_dispatched` on success; exits 1 with the response otherwise.
#
# Argv: SESSION_KEY MESSAGE [TIMEOUT_SECONDS]
set -e
SKEY=$1
MSG=$2
TIMEOUT=${3:-0}
if [ -z "$SKEY" ] || [ -z "$MSG" ]; then
    echo "usage: $0 SESSION_KEY MESSAGE [TIMEOUT_SECONDS]" >&2
    exit 1
fi
# Callbacks only ever target parked subagent sessions. Refuse anything else so
# an agent can't use this to drive another agent's main session.
case "$SKEY" in
    agent:*:subagent:*) ;;
    *) echo "session_send refused: $SKEY is not a subagent session key" >&2; exit 1 ;;
esac

AGENT=$(echo "$SKEY" | cut -d: -f2)
BODY=$(node -e '
const [key, agent, message, timeout] = process.argv.slice(1);
process.stdout.write(JSON.stringify({
  name: "sessions_send",
  sessionKey: `agent:${agent}:main`,
  args: { sessionKey: key, message, timeoutSeconds: Number(timeout) },
}));' "$SKEY" "$AGENT" "$MSG" "$TIMEOUT")

RESP=$(curl -s -X POST http://openclaw:18789/tools/invoke \
  -H "Authorization: Bearer ${OPENCLAW_TOKEN}" \
  -H 'Content-Type: application/json' \
  -d "$BODY")

STATUS=$(printf '%s' "$RESP" | node -e '
let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
  try { const r = JSON.parse(s); process.stdout.write(r.ok ? String(r.result?.details?.status ?? "") : ""); }
  catch { process.stdout.write(""); }
});')

case "$STATUS" in
    ok|accepted) echo callback_dispatched ;;
    *) echo "session_send failed: $RESP" >&2; exit 1 ;;
esac
