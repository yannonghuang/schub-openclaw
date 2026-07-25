# Local LLM hosting for the allocator copilot — evaluation (called off)

*Branch: `feat/local-llm-copilot` · Evaluated 2026-07-24/25, called off 2026-07-25*

## Outcome

Explored self-hosting the LLM behind the allocator's planning copilot (Ollama on
an M1 Pro for dev, vLLM on a GPU host as the eventual target) as an alternative
to the cloud provider. **Called off** — the live chat agent's prompt
(`PlanningAgentRoutes.kt`: 37 tool schemas + ~1000-line system prompt +
`agent-knowledge.md`) is too large for practical CPU/Metal-served local
inference: even a single-tool-call turn took minutes on `qwen2.5:7b`, and nginx
+ Next.js + backend all needed non-trivial timeout surgery just to stop
hard-failing before a local model could finish a turn. Revisit if/when a GPU
host running vLLM is available — the integration itself is provider-agnostic
(any OpenAI-compatible `/v1/chat/completions` endpoint), so nothing about this
finding blocks that path; it's specifically CPU/Metal local serving that isn't
viable for this route's prompt size today.

All local-hosting-specific infrastructure (the `docker-compose.local-llm.yml`
overlay, the `Makefile`'s `LLM=local` flag + Ollama auto-start, the nginx
1800s timeout bump, the Next.js `NODE_OPTIONS` timeout-disable script) was
reverted. What follows are the durable findings the process surfaced —
independent of local vs. cloud hosting, and kept in the codebase.

## Real production bug found + fixed: `update_config` was never wired in

The live agent's system prompt (`PlanningAgentRoutes.kt`) teaches the model to
call `update_config` (~15 references) to change planning config from chat.
The tool was never registered — absent from the 37-entry `TOOLS` list and the
`dispatchTool` dispatcher, so every attempt returned `"unknown tool:
update_config"`. **Chat-based config changes were completely non-functional
in production, on any LLM provider, unrelated to anything about local
hosting.** The implementation (`toolUpdateConfig`) already existed and already
matched exactly what the prompt teaches (`{"partial": {...}}` deep-merge) — it
just needed a tool schema + one dispatch line. Fixed and verified live (had to
verify against local Ollama since both configured cloud credentials were
separately broken — NanoGPT key has no entitled models, Anthropic key is an
OAuth token not usable via the direct-anthropic override): "set max methods to
3" now correctly calls `update_config` and returns the right merged config.

## Deterministic honesty guard for tool-calling models

Observed `qwen2.5:7b` narrate "Plan started — I'll show the result here when
it lands" after calling only `update_config`, never actually calling
`run_plan_async` — violating the system prompt's own HONESTY RULES. Prompt
tightening alone (an explicit rule + a concrete negative example, mirroring
the prompt's existing KB-honesty example) did not fix it on this model.
Added a deterministic backend check instead
(`applyPlanStartedHonestyCheck`, `PlanningAgentRoutes.kt`): after the tool
loop ends, if the reply claims a plan is running but `run_plan_async` never
appears in that turn's `steps`, append a correction before returning. This is
provider-independent — it protects against any model (local or cloud)
narrating an action it didn't take, consistent with keeping deterministic
checks in Kotlin rather than depending solely on the prompt (the same
principle behind the Allocation↔Purchasable coupling handling below).

## Scope correction: `PlanningCopilotRoutes.kt` is dead code

Before the local-LLM angle, most of this branch's early work (predicate-free
purchasable-materials handling, Supply Preferences tuning by chat, Allocation↔
Purchasable staleness awareness) was built into `PlanningCopilotRoutes.kt` —
which turned out to have zero frontend call sites. The browser's copilot chat
panel only ever calls `planningAgent()` → `PlanningAgentRoutes.kt`; a prior
change removed the copilot route's only caller with the comment "The LLM agent
is the single source of truth now."

Investigated the live route against the same 3 concerns:
1. **Purchasable Materials hallucination risk** — already safe there for
   free: `run_plan_async` resolves the real selected whitelist via
   `resolveEffectiveConfig`/`planningConfig` (`Allocate.kt`, now `internal`),
   regardless of what's in the working config.
2. **Preferences tuning by chat** — genuine gap, not implemented in the live
   agent at all.
3. **Allocation ↔ Purchasable staleness** — genuine, confirmed-present gap:
   an Allocation only auto-regenerates when no rows exist yet for the
   resolved version; once generated, it's silently reused even after
   purchasable materials change, with no prompt awareness or tool to fix it.

`PlanningCopilotRoutes.kt` (~420 lines) is left in the codebase, reviewed and
internally correct, as an unwired reference/design spec — not deleted, not
currently reachable. Porting items 2–3 into the live agent (as real tools,
following the same "deterministic Kotlin, not prompt-trusted" pattern as the
honesty guard) remains open, unrelated to local-vs-cloud hosting.

## Other durable change

`Config.kt` gained a configurable `llmRequestTimeoutMs` (env
`LLM_REQUEST_TIMEOUT_MS`, defaults to the original hardcoded 90s) — a general
flexibility improvement with zero behavior change unless explicitly
overridden. Kept.

## Follow-ups

- [ ] Port Preferences-tuning + Allocation-regen tools into
      `PlanningAgentRoutes.kt` (real gaps, confirmed above) — separate from
      the local-LLM question entirely.
- [ ] Decide `PlanningCopilotRoutes.kt`'s fate: delete, wire in as an actual
      fallback, or leave as reference.
- [ ] Revisit local/self-hosted inference only alongside a GPU/vLLM host —
      not CPU/Metal dev-machine serving.
