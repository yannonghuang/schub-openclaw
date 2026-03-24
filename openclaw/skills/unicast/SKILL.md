---
requires:
  env: [BACKEND_URL]
---
# unicast

Send a direct notification message to a specific business user or channel.

## Usage
Call this skill at the end of a workflow to notify stakeholders of the outcome.

Parameters:
- `business_id`: the business context ID
- `recipient_id`: the target user or channel ID
- `message`: the notification content (plain text)

## Implementation
POST to `${BACKEND_URL}/unicast` with the parameters above.
