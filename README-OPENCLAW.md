# schub-openclaw

Experimental port of [schub](https://github.com/yannonghuang/schub) from LangGraph to [OpenClaw](https://docs.openclaw.ai).

## What changed

| Removed | Replaced by |
|---|---|
| `langgraph/` (graph_factory, agent_manager, dispatcher) | OpenClaw Gateway + agent workspaces (`openclaw/`) |
| `services/adaptor/` (IMAP worker) | OpenClaw built-in email channel |
| `services/switch/` (Redis router) | OpenClaw Gateway session routing |

## What stayed

- `db/` — PostgreSQL + pgvector
- `redis/` — kept for misc pub-sub
- `mcp-server/` — all engines (order, material, supply chain, MES) connected via MCP HTTP
- `services/auth/` — tool registry, business config, async job endpoints
- `services/audit/` — span tracing
- `frontend/` — Next.js UI (WebSocket updated to connect to OpenClaw SSE)

## Agent structure

```
openclaw/
├── openclaw.json           # Gateway config (model, email channel, MCP)
├── agents/
│   ├── main/               # Main orchestrator — routes events to subagents
│   ├── order/              # Order Agent — order_engine + email approval loop
│   ├── material/           # Material Agent — material_engine + DSPy
│   └── planning/           # Planning Agent — supply_chain_engine / mes_engine
└── skills/
    ├── send-email/         # Email tool with HITL reply gate
    ├── unicast/            # Direct notification
    ├── async-job/          # Background job poller
    └── dspy-material/      # DSPy Material reasoning wrapper
```

## Setup

```bash
cp .env.example .env
# Fill in ANTHROPIC_API_KEY, IMAP_*, SMTP_*, MCP_API_KEY

docker compose up
```

OpenClaw UI: http://localhost:18789

## Known gaps vs LangGraph version

1. **Explicit routing** — LangGraph had deterministic graph edges; OpenClaw routing is LLM-driven. May need precise AGENTS.md prompts.
2. **DSPy** — `dspy-material` skill wraps DSPy as an HTTP call; the optimized weights still live in auth-service.
3. **Span tracing** — No hook points in OpenClaw; spans are emitted manually from skills.
4. **Cycle detection** — OpenClaw has a built-in 4x same-tool guard (matches the LangGraph version).
