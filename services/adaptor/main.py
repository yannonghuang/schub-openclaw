"""
IMAP Adaptor — watches the inbox for replies to HITL emails and resumes
the waiting OpenClaw agent session.

Flow:
  1. Poll IMAP inbox every POLL_INTERVAL seconds for new messages.
  2. Tracks processed UIDs in a local JSON file — independent of the IMAP
     \\Seen flag, so other mail clients (Apple Mail, etc.) cannot cause misses.
  3. Walk the In-Reply-To + References chain to find a pending HITL record.
     If the found HITL is already "resumed" (e.g. a "needs_more_time" reply
     was processed earlier), checks for a newer pending HITL on the same
     session, or re-resumes the original so a definitive answer is never lost.
  4. POST the raw reply body to OpenClaw — the agent classifies intent
     (approved / rejected / needs_more_time). Adaptor stays stateless.
  5. Mark the matched HITL record as resumed via PUT /email-hitl/{id}/resume.
"""

import email
import imaplib
import json
import logging
import os
import re
import threading
import time

import httpx

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("adaptor")

IMAP_HOST      = os.getenv("IMAP_HOST", "imap.mail.me.com")
IMAP_PORT      = int(os.getenv("IMAP_PORT", "993"))
IMAP_USER      = os.getenv("IMAP_USER", "")
IMAP_PASS      = os.getenv("IMAP_PASS", "")
POLL_INTERVAL  = int(os.getenv("POLL_INTERVAL", "30"))   # seconds
BACKEND_URL    = os.getenv("BACKEND_URL", "http://auth-service:4000")
OPENCLAW_URL   = os.getenv("OPENCLAW_URL", "http://openclaw:18789")
OPENCLAW_TOKEN = os.getenv("OPENCLAW_TOKEN", "c34d9510b42222e8ff613d22f2d3dfc80b4eeb818aee7acc")
SWITCH_URL     = os.getenv("SWITCH_URL", "http://switch-service:6000/publish")
SEEN_FILE      = os.getenv("SEEN_FILE", "/tmp/adaptor_seen.json")


# ---------------------------------------------------------------------------
# Adaptor-owned seen-UID tracking (independent of IMAP \Seen flag)
# ---------------------------------------------------------------------------

_seen_uids: set[str] = set()


def _load_seen() -> None:
    global _seen_uids
    try:
        with open(SEEN_FILE) as f:
            _seen_uids = set(json.load(f))
        log.info("Loaded %d seen UIDs from %s", len(_seen_uids), SEEN_FILE)
    except FileNotFoundError:
        _seen_uids = set()
    except Exception as e:
        log.warning("Could not load seen UIDs: %s — starting fresh", e)
        _seen_uids = set()


def _save_seen() -> None:
    try:
        with open(SEEN_FILE, "w") as f:
            json.dump(sorted(_seen_uids), f)
    except Exception as e:
        log.warning("Could not save seen UIDs: %s", e)


# ---------------------------------------------------------------------------
# HITL lookup — walks the full References chain to find a matching record
# ---------------------------------------------------------------------------

def _find_hitl(candidates: list[str]) -> tuple[str, dict] | None:
    """
    Walk a list of message-ids (most specific first) and return the first
    matching HITL record as (message_id, hitl_dict).

    Returns None if no matching HITL is found at all.
    Prefers "pending" records; falls back to "resumed" if nothing pending exists.
    """
    resumed_candidate: tuple[str, dict] | None = None

    for mid in candidates:
        mid = mid.strip()
        if not mid:
            continue
        try:
            resp = httpx.get(f"{BACKEND_URL}/email-hitl/{mid}", timeout=10)
        except Exception as e:
            log.warning("HITL lookup failed for %r: %s", mid, e)
            continue

        if resp.status_code == 404:
            continue
        if resp.status_code != 200:
            log.warning("Unexpected status %s for %r", resp.status_code, mid)
            continue

        hitl = resp.json()
        if hitl.get("status") == "pending":
            return mid, hitl   # best match — use immediately

        if hitl.get("status") == "resumed" and resumed_candidate is None:
            resumed_candidate = (mid, hitl)   # remember first resumed hit

    # No pending HITL found in chain. If we saw a resumed one, check whether
    # the agent created a newer pending HITL for the same session (e.g. after
    # a "needs_more_time" reply it sent a follow-up email with a new HITL).
    if resumed_candidate is not None:
        _, resumed_hitl = resumed_candidate
        session_key = resumed_hitl.get("session_key", "")
        try:
            resp = httpx.get(
                f"{BACKEND_URL}/email-hitl/session/{session_key}/pending",
                timeout=10,
            )
            if resp.status_code == 200:
                newer = resp.json()
                log.info(
                    "Found newer pending HITL %r for session %s (original was resumed)",
                    newer["message_id"], session_key,
                )
                return newer["message_id"], newer
        except Exception as e:
            log.warning("Pending HITL session lookup failed: %s", e)

        # No newer pending HITL — the user replied to the original thread
        # after the agent decided to wait (needs_more_time). Re-resume the
        # original session so the agent can process the definitive answer.
        log.info(
            "No newer pending HITL for session %s — re-resuming original",
            session_key,
        )
        return resumed_candidate

    return None


# ---------------------------------------------------------------------------
# Email body extraction
# ---------------------------------------------------------------------------

def extract_body(msg: email.message.Message) -> str:
    """Return the plain-text body of an email, stripping quoted history."""
    body = ""
    html_body = ""
    if msg.is_multipart():
        for part in msg.walk():
            ct = part.get_content_type()
            if ct == "text/plain" and not body:
                charset = part.get_content_charset() or "utf-8"
                body = part.get_payload(decode=True).decode(charset, errors="replace")
            elif ct == "text/html" and not html_body:
                charset = part.get_content_charset() or "utf-8"
                html_body = part.get_payload(decode=True).decode(charset, errors="replace")
    else:
        charset = msg.get_content_charset() or "utf-8"
        raw = msg.get_payload(decode=True).decode(charset, errors="replace")
        if msg.get_content_type() == "text/html":
            html_body = raw
        else:
            body = raw

    # Fall back to HTML body with tags stripped if no plain-text part
    if not body and html_body:
        body = re.sub(r"<[^>]+>", " ", html_body)
        body = re.sub(r"&nbsp;", " ", body)
        body = re.sub(r" +", " ", body)

    # Strip quoted reply lines ("> ..." and "On ... wrote:") to get just the reply
    lines = []
    for line in body.splitlines():
        stripped = line.strip()
        if stripped.startswith(">"):
            break
        if re.match(r"^On .+ wrote:$", stripped):
            break
        lines.append(line)
    return "\n".join(lines).strip()


# ---------------------------------------------------------------------------
# OpenClaw resume
# ---------------------------------------------------------------------------

def resume_session(session_key: str, agent_id: str, body: str) -> None:
    content = f"Human replied to HITL email. Reply: {body[:500]}"

    def _stream_to_completion() -> None:
        try:
            with httpx.stream(
                "POST",
                f"{OPENCLAW_URL}/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {OPENCLAW_TOKEN}",
                    "x-openclaw-session-key": session_key,
                    "Content-Type": "application/json",
                },
                json={
                    "model": f"openclaw:{agent_id}" if agent_id else "openclaw",
                    "messages": [{"role": "user", "content": content}],
                    "stream": True,
                },
                timeout=httpx.Timeout(connect=10.0, read=None, write=10.0, pool=10.0),
            ) as resp:
                log.info("Resumed session %s: HTTP %s", session_key, resp.status_code)
                # Consume stream to keep connection alive until agent completes
                for chunk in resp.iter_bytes():
                    pass
                log.info("Session %s stream complete", session_key)
        except Exception as e:
            log.error("Failed to resume session %s: %s", session_key, e)

    t = threading.Thread(target=_stream_to_completion, daemon=True)
    t.start()


# ---------------------------------------------------------------------------
# IMAP polling
# ---------------------------------------------------------------------------

def process_message(uid: bytes, raw: bytes) -> None:
    msg         = email.message_from_bytes(raw)
    in_reply_to = msg.get("In-Reply-To", "").strip()
    references  = msg.get("References", "").strip()

    if not in_reply_to and not references:
        return   # Not a reply — skip

    # Build candidate list: In-Reply-To first (most specific), then References
    # in reverse order (most recent parent first).
    ref_ids    = references.split() if references else []
    candidates = []
    if in_reply_to:
        candidates.append(in_reply_to)
    for mid in reversed(ref_ids):
        if mid not in candidates:
            candidates.append(mid)

    if not candidates:
        return

    log.info("Reply — walking %d candidate message-id(s) to find HITL", len(candidates))

    result = _find_hitl(candidates)
    if result is None:
        log.debug("No HITL record found in References chain — not a managed reply")
        return

    matched_id, hitl = result
    body = extract_body(msg)
    log.info("Resuming session %s (matched HITL %r)", hitl["session_key"], matched_id)

    # Delegate classification entirely to the agent — adaptor stays stateless
    resume_session(hitl["session_key"], hitl.get("agent_id", ""), body)

    # Mark HITL as resumed to prevent duplicate processing on re-delivery
    try:
        httpx.put(f"{BACKEND_URL}/email-hitl/{matched_id}/resume", timeout=10)
    except Exception as e:
        log.warning("Failed to mark HITL %r as resumed: %s", matched_id, e)

    # Publish schub/hitl_reply so the Agent UI reflects the email reply
    try:
        httpx.post(
            SWITCH_URL,
            json={
                "sender": "-1",
                "content": json.dumps({
                    "type": "CustomEvent",
                    "name": "schub/hitl_reply",
                    "value": {
                        "threadId": hitl["session_key"],
                        "messageContent": body[:200],
                        "idempotencyKey": f"email:{matched_id}",
                        "businessId": hitl.get("business_id"),
                    },
                    "timestamp": int(time.time() * 1000),
                }),
                "recipients": ["-2"],
            },
            timeout=5,
        )
    except Exception as e:
        log.warning("Failed to publish schub/hitl_reply: %s", e)


def poll_once(imap: imaplib.IMAP4_SSL) -> None:
    imap.select("INBOX")
    # Fetch all UIDs and compare against our own seen set — independent of \Seen flag
    _, data = imap.uid("search", None, "ALL")
    all_uids = data[0].split() if data and data[0] else []

    # Trim our seen set to UIDs still in the mailbox (prevents unbounded growth)
    mailbox_set = {u.decode() for u in all_uids}
    _seen_uids.intersection_update(mailbox_set)

    new_uids = [u for u in all_uids if u.decode() not in _seen_uids]
    if not new_uids:
        return

    log.info("Found %d new message(s)", len(new_uids))
    changed = False
    for uid in new_uids:
        uid_str = uid.decode()
        _seen_uids.add(uid_str)   # mark before processing to avoid reprocessing on crash-loop
        changed = True

        _, msg_data = imap.uid("fetch", uid, "(BODY.PEEK[])")
        raw = None
        for part in msg_data:
            if isinstance(part, tuple) and len(part) >= 2 and isinstance(part[1], bytes):
                raw = part[1]
                break
        if not raw:
            log.info("UID %s: no body — skipping (raw: %r)", uid_str, msg_data)
            continue
        try:
            process_message(uid, raw)
        except Exception as e:
            log.error("Error processing message %s: %s", uid_str, e)

    if changed:
        _save_seen()


def run() -> None:
    _load_seen()
    log.info("IMAP adaptor starting — host=%s user=%s poll=%ds", IMAP_HOST, IMAP_USER, POLL_INTERVAL)
    while True:
        try:
            with imaplib.IMAP4_SSL(IMAP_HOST, IMAP_PORT) as imap:
                imap.login(IMAP_USER, IMAP_PASS)
                log.info("IMAP connected")
                while True:
                    poll_once(imap)
                    time.sleep(POLL_INTERVAL)
        except imaplib.IMAP4.abort as e:
            log.warning("IMAP connection dropped, reconnecting: %s", e)
            time.sleep(5)
        except Exception as e:
            log.error("Unexpected error, reconnecting in 10s: %s", e)
            time.sleep(10)


if __name__ == "__main__":
    run()
