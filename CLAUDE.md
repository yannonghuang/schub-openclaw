# CLAUDE.md — schub

## Project Overview
Multi-agent AI workflow automation platform. Processes business events (emails, messages) through LangGraph agent graphs with DSPy-enhanced reasoning.

## Architecture

### Services (docker-compose)
| Service | Port | Description |
|---|---|---|
| `nginx` | 443 | Reverse proxy (HTTPS) |
| `db` | 5432 | PostgreSQL + pgvector |
| `redis` | 6379 | Message bus / pub-sub |
| `auth-service` | 4000 | Backend API (business, subagent, tool registry) |
| `switch-service` | 6000 | Redis channel router |
| `adaptor-service` | 8600 | IMAP email adaptor |
| `langgraph-api` | 8000 | LangGraph agent runtime |
| `mcp-server` | 9500 | MCP tool servers |
| `frontend-service` | 3000 | Next.js frontend |
| `agent-chat-ui` | 3500 | Agent chat interface |

### LangGraph Agent (`langgraph/src/`)
- **`agent/agent_manager.py`**: `BusinessAgentManager` singleton — builds and caches business agents and subagents with SHA256 fingerprint-based invalidation
- **`agent/graph_factory.py`**: `BusinessGraphFactory` — constructs `StateGraph` per business/subagent

#### Graph Flow
```
initialize_context → [dspy_material*] → reason → route → tools / subagents / __dynamic__ / __end__
                                                     ↓
                                               await_confirmation (interrupt on send_email)
```
*DSPy material node only active for agents named `"Material"`

#### State (`DispatcherState`)
- `messages`: LangGraph message list
- `business_id`: current business context
- `original_type`, `original_event_id`, `thread_id`: immutable thread context
- `workflow_status`: `"running"` | `"completed"`
- `dynamic_route_name`, `dynamic_invoked_pairs`: dynamic subagent dispatch tracking
- `dspy_structured_payload`: DSPy-structured input (Material agent only)

### Email Adaptor (`services/adaptor/app/`)
- `imap_worker.py`: Polls IMAP mailbox → parses subject → calls `resume_thread()`
- `resume_thread.py`: Resumes LangGraph thread with parsed email response
- State persisted to `.imap_state.json`

## Key Patterns
- **LLM**: `gpt-4o-mini` via `ChatOpenAI`
- **MCP tools**: loaded via `MultiServerMCPClient` from `auth-service` registry
- **Local tools**: `send_email`, `broadcast`, `unicast` — enabled per business via `auth-service`
- **Subagent resolution**: dynamic via `BusinessAgentManager.get_subagent_by_name()`
- **Thread context**: preserved through all state transitions via `preserve_thread_context()`
- **Infinite loop guard**: same tool called 4x in a row → auto-terminate workflow
- **DSPy**: `MaterialAgentModule` in `src/dspy_sketch.py`; optimized weights in `optimized_material_agent.json`

## Dev Setup
```bash
# Start all services
docker compose up

# Start specific service
docker compose up langgraph-api

# Rebuild after code changes
docker compose build langgraph-api && docker compose up langgraph-api
```

## Environment
- `.env` file at repo root (loaded by `langgraph-api`)
- Key vars: `OPENAI_API_KEY`, `REDIS_URI`, `POSTGRES_URI`, `MCP_SERVER_URL`, `LANGSMITH_API_KEY`
- `BACKEND_URL` in langgraph defaults to `http://auth-service:4000`
