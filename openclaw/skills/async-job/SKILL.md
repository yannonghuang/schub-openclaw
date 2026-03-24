---
requires:
  env: [BACKEND_URL]
---
# async_job

Monitor a background async job submitted by an engine tool and wait for its completion.

## Usage
After an engine tool (order_engine, material_engine, supply_chain_engine, mes_engine) returns
`{status: "pending", job_id: "..."}`, call this skill to wait for the job result.

Parameters:
- `job_id`: the job ID returned by the engine tool

## Behaviour
Polls `${BACKEND_URL}/async-jobs/{job_id}` until status is `completed` or `error`.
Returns the job result when done. If status is `error`, includes the error message.

## Note
This skill blocks the agent session until the job is done. For long-running jobs (10s+),
the OpenClaw HITL gate will automatically pause and resume the session.
