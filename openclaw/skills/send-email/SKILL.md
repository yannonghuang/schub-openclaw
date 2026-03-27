---
name: send-email
description: "Send a HITL email to business users and pause for human reply (approved/rejected). Use when agent needs human confirmation before proceeding."
metadata: { "openclaw": { "requires": { "env": ["BACKEND_URL"] } } }
---
# send_email

Send a business email to the users of one or more businesses and wait for a human reply before continuing.

## Usage

Call this skill when you need human confirmation (approval / rejection) before proceeding.

## Parameters

POST to `${BACKEND_URL}/send-email` with this JSON body:

```json
{
  "business_id": 1,
  "recipients": [1],
  "subject": "Approval required: <brief description>",
  "body": "<what needs approval and why>",
  "session_key": "<your session key>",
  "agent_id": "<your agent id>"
}
```

- `business_id` — the business context (integer)
- `recipients` — list of business_ids whose users should receive the email
- `subject` — email subject line
- `body` — plain-text email body describing what needs approval
- `session_key` — **required for HITL**: your OpenClaw session key (e.g. `agent:order:subagent:{uuid}`). Discovered via `exec ls -t ~/.openclaw/agents/{agent}/sessions/`
- `agent_id` — your agent id (e.g. `order`, `planning`, `wip`)

## Behaviour

After the email is sent the IMAP adaptor watches for a reply. When the human replies, the adaptor resumes this session with one of:
- `approved` — proceed with the workflow
- `rejected` — terminate without sending notifications
- `ambiguous` — ask for clarification

Do not poll. Do not call send_email again. End your turn after sending and wait for the resume message.

## Implementation

```
exec curl -s -X POST ${BACKEND_URL}/send-email \
  -H 'Content-Type: application/json' \
  -d '{...}'
```
