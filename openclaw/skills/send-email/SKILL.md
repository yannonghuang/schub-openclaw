---
requires:
  env: [BACKEND_URL]
---
# send_email

Send a business email to a recipient and await their reply before continuing.

## Usage
Call this skill when you need to send an email and pause for a human response (approval, rejection, or info request).

Parameters:
- `to`: recipient email address
- `subject`: email subject line
- `body`: email body (plain text or markdown)
- `business_id`: the business context ID
- `thread_id`: the current event thread ID (for reply tracking)

## Behaviour
After the email is sent, execution pauses until the recipient replies. The reply is classified as:
- `approved` — proceed with the workflow
- `rejected` — terminate the workflow
- `conditional` — proceed with stated conditions
- `request_info` — answer the question and re-send
- `ambiguous` — ask for clarification (max 2 rounds)

## Implementation
POST to `${BACKEND_URL}/send-email` with the parameters above.
The auth-service handles SMTP delivery and reply tracking.
