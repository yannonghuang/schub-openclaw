#!/bin/sh
# Discover main's current chat-session key (full form, e.g.
# `agent:main:14da5399-2919-4fb4-b467-1b6f88fb47ab`).
#
# OpenClaw routes resume-on-email-reply by session_key, so the agent must
# embed its session_key in /send-email's payload before pausing. This script
# resolves the key by:
#   1. Finding the most recently touched non-trajectory .jsonl in sessions/
#      (that's the running chat session).
#   2. Looking up which entry in sessions.json maps to that sessionId,
#      excluding the heartbeat row `agent:main:main`.
#
# Output: the full session_key (e.g. `agent:main:UUID`) on stdout, or empty
# if no current chat session can be identified.
set -e
DIR=/home/node/.openclaw/agents/main/sessions
# Pick the most recent .jsonl that isn't a .trajectory.jsonl
SID=$(ls -t "$DIR"/*.jsonl 2>/dev/null | grep -v '\.trajectory\.jsonl$' | head -1 | xargs basename 2>/dev/null | sed 's/\.jsonl//')
[ -z "$SID" ] && exit 0
python3 - <<PY
import json
data = json.load(open("$DIR/sessions.json"))
hits = [(k, v) for k, v in data.items()
        if v.get("sessionId") == "$SID" and k != "agent:main:main"]
hits.sort(key=lambda e: e[1].get("updatedAt", 0), reverse=True)
if hits:
    print(hits[0][0])
PY
