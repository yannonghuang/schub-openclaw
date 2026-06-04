#!/usr/bin/env bash
# clean-heartbeat-sessions.sh
#
# Delete idle heartbeat sessions for the non-conversational OpenClaw agents
# (wip, scheduling). These agents are never part of a workflow and are outside
# the auto-GC scope, so their [OpenClaw heartbeat poll] sessions linger as idle
# leftovers. This removes the session .jsonl / .trajectory files AND their
# sessions.json index entries, running inside the live openclaw container (works
# for both the dev bind-mount and the prod workspace volume).
#
# Safe by design: only touches `wip`/`scheduling` (override with AGENTS=…), and
# only sessions idle for >= GRACE seconds, so it can't race a just-created one.
#
# Usage (run on the host that runs the openclaw container, e.g. the prod VM):
#   ./scripts/clean-heartbeat-sessions.sh                 # wip + scheduling, idle > 120s
#   DRY_RUN=1 ./scripts/clean-heartbeat-sessions.sh       # preview only, delete nothing
#   AGENTS="wip" ./scripts/clean-heartbeat-sessions.sh    # wip only
#   CONTAINER=myproj-openclaw-1 ./scripts/clean-heartbeat-sessions.sh
set -euo pipefail

CONTAINER="${CONTAINER:-schub-openclaw-openclaw-1}"
AGENTS="${AGENTS:-wip scheduling}"
GRACE="${GRACE:-120}"     # only delete sessions idle >= this many seconds
DRY_RUN="${DRY_RUN:-0}"
BASE="${BASE:-/home/node/.openclaw/agents}"

docker exec -i "$CONTAINER" python3 - "$BASE" "$GRACE" "$DRY_RUN" $AGENTS <<'PY'
import json, os, sys, glob, time
base, grace, dry = sys.argv[1], int(sys.argv[2]), sys.argv[3] == "1"
agents = sys.argv[4:]
now = time.time()
total = 0
for ag in agents:
    sdir = os.path.join(base, ag, "sessions")
    if not os.path.isdir(sdir):
        continue
    victims = set()
    for f in glob.glob(os.path.join(sdir, "*.jsonl")):
        if f.endswith(".trajectory.jsonl"):
            continue
        try:
            if now - os.path.getmtime(f) < grace:
                continue  # too fresh — leave it
        except OSError:
            continue
        victims.add(os.path.basename(f)[:-6])  # strip ".jsonl"
    for u in sorted(victims):
        print(f"  {'[dry] ' if dry else ''}{ag}/{u[:8]} -> delete")
        if not dry:
            for suf in (".jsonl", ".trajectory.jsonl", ".trajectory-path.json"):
                try:
                    os.remove(os.path.join(sdir, u + suf))
                except FileNotFoundError:
                    pass
        total += 1
    if not dry and victims:
        idx_path = os.path.join(sdir, "sessions.json")
        try:
            idx = json.load(open(idx_path))
            new = {k: v for k, v in idx.items() if v.get("sessionId") not in victims}
            if len(new) != len(idx):
                tmp = idx_path + ".tmp"
                json.dump(new, open(tmp, "w"))
                os.replace(tmp, idx_path)
        except (FileNotFoundError, json.JSONDecodeError):
            pass
print(f"{'[dry] would remove' if dry else 'removed'} {total} session(s)")
PY
