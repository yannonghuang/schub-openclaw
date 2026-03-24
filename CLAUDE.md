# CLAUDE.md — schub-openclaw

## What this repo is
Experimental port of [schub](https://github.com/yannonghuang/schub) from LangGraph to [OpenClaw](https://docs.openclaw.ai).
The goal is to replace the LangGraph graph execution layer and IMAP adaptor with OpenClaw's ReAct loop + built-in email channel.

## What was removed from schub
| Removed | Replaced by |
|---|---|
| `langgraph/` (graph_factory, agent_manager, dispatcher) | `openclaw/` — Gateway config + agent workspaces |
| `services/adaptor/` (IMAP worker) | OpenClaw built-in email channel (IMAP/SMTP) |
| `services/switch/` (Redis pub-sub router) | OpenClaw Gateway session routing |

## What stayed (unchanged from schub)
| Service | Port | Description |
|---|---|---|
| `nginx` | 443 | Reverse proxy (HTTPS) |
| `db` | 5432 | PostgreSQL + pgvector |
| `redis` | 6379 | Misc pub-sub |
| `auth-service` | 4000 | Business config, tool registry, async job endpoints |
| `mcp-server` | 9500 | MCP tool servers (order_engine, material_engine, etc.) |
| `audit-service` | 9000 | Span tracing |
| `frontend-service` | 3000 | Next.js UI |
| `agent-chat-ui` | 3500 | Agent chat interface |
| `openclaw` | 18789 | OpenClaw Gateway (replaces langgraph-api + adaptor + switch) |

## OpenClaw structure (`openclaw/`)
```
openclaw/
├── openclaw.json              # Gateway config: model, email channel, MCP server
├── agents/
│   ├── main/AGENTS.md         # Orchestrator — routes events to subagents
│   ├── order/AGENTS.md        # Order Agent — order_engine + email HITL approval
│   ├── material/AGENTS.md     # Material Agent — material_engine
│   └── planning/AGENTS.md    # Planning Agent — supply_chain_engine / mes_engine
└── skills/
    ├── send-email/SKILL.md    # Email tool with reply HITL gate
    ├── unicast/SKILL.md       # Direct notification
    ├── async-job/SKILL.md     # Background job poller
    └── dspy-material/SKILL.md # DSPy Material reasoning wrapper
```

## Agent execution model
- OpenClaw uses a **ReAct loop** (not a StateGraph). The LLM decides what to do next via tool calls.
- Agent logic is defined in `AGENTS.md` (markdown prompts), not Python code.
- State persists as a per-session JSONL event log (automatic, no checkpointer needed).
- Multi-agent: `main` agent hands off to `order`/`material`/`planning` via `agentToAgent` tool.
- Human-in-the-loop: OpenClaw's built-in HITL gates pause execution on `send_email` and async jobs.

## MCP tools (unchanged)
The `mcp-server` exposes async engines via MCP HTTP transport:
- `order_engine` — returns `{status: pending, job_id}` immediately; background task runs ~10s
- `material_engine` — same async pattern
- `supply_chain_engine`, `mes_engine` — same async pattern
OpenClaw connects via `openclaw.json` → `mcp.servers.schub-engines`

## Key design differences from LangGraph (schub)
| LangGraph pattern | OpenClaw equivalent |
|---|---|
| `reason → route → tools` StateGraph loop | Implicit ReAct loop driven by LLM |
| `__dynamic__` node + subagent dispatch | `agentToAgent` tool + OpenClaw handoffs |
| `await_confirmation` interrupt node | Built-in HITL gate on tool calls |
| `DispatcherState` TypedDict | OpenClaw session (JSONL event log) |
| `MemorySaver` checkpointing | Automatic per-turn session persistence |
| DSPy `MaterialAgentModule` node | `dspy-material` skill (HTTP call to DSPy endpoint) |
| Fingerprint-based agent caching | OpenClaw handles agent lifecycle |
| Explicit cycle detection (4x guard) | OpenClaw built-in 4x same-tool loop guard |

## Known gaps / open work
1. **Routing reliability** — OpenClaw routing is LLM-driven; `AGENTS.md` prompts need tuning to match LangGraph's deterministic edges.
2. **DSPy integration** — `dspy-material` skill needs a FastAPI endpoint in `auth-service` (or separate service) that runs the optimized `MaterialAgentModule`. Weights are in `optimized_material_agent.json`.
3. **Span tracing** — No native hook points in OpenClaw; spans need to be emitted manually from skill wrappers calling `audit-service`.
4. **Frontend** — WebSocket/SSE handling needs updating to consume OpenClaw's `/api/runtime/stream` SSE instead of LangGraph's stream.
5. **Email reply classification** — `services/adaptor/email_analyzer.py` (DSPy-based intent classifier) is removed. OpenClaw's email channel needs to replicate intent classification (approved / rejected / conditional / request_info / ambiguous) before resuming sessions.

## Dev setup
```bash
cp .env.example .env
# Fill in: ANTHROPIC_API_KEY, IMAP_HOST/PORT/USER/PASS, SMTP_HOST/PORT/USER/PASS, MCP_API_KEY

docker compose up
```

OpenClaw UI: http://localhost:18789

## Origin
Forked from schub (https://github.com/yannonghuang/schub) at commit c9d6b46.
Migration designed and scaffolded in the schub project session — see schub memory for full background.
