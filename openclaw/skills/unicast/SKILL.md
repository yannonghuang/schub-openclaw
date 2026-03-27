---
name: unicast
description: "Send a one-way notification email to a specific business. Use at the end of a workflow to inform the source business of the outcome."
metadata: { "openclaw": { "requires": { "env": ["BACKEND_URL"] } } }
---
# unicast

Send a one-way notification email to the users of a specific business. No reply is expected.

## Usage

Call this skill at the end of a workflow to notify the source (or partner) business of the outcome.

## Parameters

POST to `${BACKEND_URL}/send-email` with this JSON body:

```json
{
  "business_id": 1,
  "recipients": [2],
  "subject": "Outcome: <brief description>",
  "body": "<outcome summary>"
}
```

- `business_id` — your business context (integer)
- `recipients` — list of business_ids to notify (typically the `source` field from the event)
- `subject` — email subject
- `body` — plain-text notification content

Do **not** include `session_key` — this is a fire-and-forget notification, not a HITL email.

## Implementation

```
exec curl -s -X POST ${BACKEND_URL}/send-email \
  -H 'Content-Type: application/json' \
  -d '{...}'
```
