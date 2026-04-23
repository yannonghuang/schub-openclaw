#!/bin/sh
# Discover this subagent's own session key UUID by reverse-looking-up the current
# session's .jsonl basename (sessionId) against the sessions.json routing index.
#
# OpenClaw's chat-completions routing uses the sessionKey (e.g. agent:material:
# subagent:XYZ), which is NOT the same UUID as the session file's basename
# (the sessionId). `ls -t sessions/*.jsonl | basename` gives the sessionId; this
# script returns the routing-key UUID so callers (traces, callbacks) use the
# value OpenClaw will match on.
set -e
DIR=/home/node/.openclaw/agents/material/sessions
SID=$(ls -t "$DIR"/*.jsonl 2>/dev/null | head -1 | xargs basename 2>/dev/null | sed 's/\.jsonl//')
[ -z "$SID" ] && exit 0
python3 - <<PY
import json
data = json.load(open("$DIR/sessions.json"))
hits = [(k, v) for k, v in data.items()
        if v.get("sessionId") == "$SID" and k.startswith("agent:material:subagent:")]
hits.sort(key=lambda e: e[1].get("updatedAt", 0), reverse=True)
if hits:
    print(hits[0][0].split(":")[-1])
PY
