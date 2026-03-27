"""
IMAP Adaptor — watches the inbox for replies to HITL emails and resumes
the waiting OpenClaw agent session.

Flow:
  1. Poll IMAP inbox every POLL_INTERVAL seconds for new messages.
  2. Tracks processed UIDs in a local JSON file — independent of the IMAP
     \\Seen flag, so other mail clients (Apple Mail, etc.) cannot cause misses.
  3. For each new message that has an In-Reply-To header, call auth-service
     GET /email-hitl/{message_id} to find the waiting session key.
  4. Classify the reply body (approved / rejected / ambiguous).
  5. POST to OpenClaw /v1/chat/completions with x-openclaw-session-key
     so the paused agent turn resumes.
  6. Mark the HITL record as resumed via PUT /email-hitl/{message_id}/resume.
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
# Reply classification
# ---------------------------------------------------------------------------

_APPROVED = re.compile(
    r"\b(approv(e|ed|es)|yes|confirm(ed)?|ok(ay)?|proceed|go ahead|accept(ed)?|agree(d)?)\b",
    re.IGNORECASE,
)
_REJECTED = re.compile(
    r"\b(reject(ed)?|no|deny|denied|declin(e|ed)|cancel(led)?|stop|refuse(d)?)\b",
    re.IGNORECASE,
)


def classify(text: str) -> str:
    text = text[:300]   # only look at first 300 chars — user's reply before any quoted history
    approved = bool(_APPROVED.search(text))
    rejected = bool(_REJECTED.search(text))
    if approved and not rejected:
        return "approved"
    if rejected and not approved:
        return "rejected"
    return "ambiguous"


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

def resume_session(session_key: str, agent_id: str, classification: str, body: str) -> None:
    content = (
        f"Human replied to HITL email. Classification: {classification}. "
        f"Reply: {body[:500]}"
    )

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
    msg = email.message_from_bytes(raw)
    in_reply_to = msg.get("In-Reply-To", "").strip()
    references  = msg.get("References", "").strip()

    # Pick the most specific reference (In-Reply-To first, then last in References)
    original_id = in_reply_to
    if not original_id and references:
        original_id = references.split()[-1]

    if not original_id:
        return   # Not a reply, skip

    log.info("Reply to %r — looking up HITL session", original_id)

    try:
        resp = httpx.get(f"{BACKEND_URL}/email-hitl/{original_id}", timeout=10)
    except Exception as e:
        log.error("auth-service lookup failed: %s", e)
        return

    if resp.status_code == 404:
        log.debug("No HITL record for %r — not a managed reply", original_id)
        return
    if resp.status_code != 200:
        log.error("auth-service returned %s for %r", resp.status_code, original_id)
        return

    hitl = resp.json()
    if hitl.get("status") == "resumed":
        log.info("Session %s already resumed, skipping", hitl["session_key"])
        return

    body           = extract_body(msg)
    classification = classify(body)
    log.info("Reply classified as %r for session %s", classification, hitl["session_key"])

    resume_session(hitl["session_key"], hitl.get("agent_id", ""), classification, body)

    # Mark as resumed so duplicate deliveries are ignored
    try:
        httpx.put(f"{BACKEND_URL}/email-hitl/{original_id}/resume", timeout=10)
    except Exception as e:
        log.warning("Failed to mark HITL as resumed: %s", e)


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
