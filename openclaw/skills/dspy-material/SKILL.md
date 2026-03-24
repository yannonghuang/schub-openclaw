---
requires:
  env: [BACKEND_URL]
---
# dspy_material

Run DSPy-enhanced structured reasoning on a material request before processing.

## Usage
Call this skill at the start of material event handling to structure and enrich the raw input
using the optimized MaterialAgentModule DSPy model.

Parameters:
- `raw_input`: the raw material event payload (JSON string or dict)
- `business_id`: the business context ID

## Returns
A structured payload with enriched fields ready for `material_engine`.

## Implementation
POST to `${BACKEND_URL}/dspy/material` with the parameters.
The auth-service proxies to the DSPy FastAPI endpoint which runs the optimized MaterialAgentModule.
