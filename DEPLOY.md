# Private Cloud Deployment Guide

Deploys the full schub-openclaw stack (nginx, PostgreSQL, Redis, auth-service, frontend, openclaw agents, switch-service, adaptor, audit-service, mcp-server, allocator-backend, allocator-frontend) onto a single Linux VM using Docker Compose and self-signed TLS.

Two deployment modes are supported:

| Mode | When to use | Source code on VM? |
|------|-------------|-------------------|
| **Source-based** (Steps 1–9 below) | Dev / first-time setup | Yes — `docker compose build` runs on the VM |
| **Image-based** (see [Image-Based Deployment](#image-based-deployment-no-source-code-on-vm)) | Production / repeatable deploys | No — pull pre-built images from a registry |

---

## Prerequisites

Fresh Ubuntu 22.04+ / Debian 12+ server with internet access.

```bash
# Docker Engine + Compose v2
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
# Log out and back in so the group takes effect

# mkcert (self-signed TLS)
sudo apt install -y libnss3-tools curl
curl -L https://github.com/FiloSottile/mkcert/releases/latest/download/mkcert-linux-amd64 \
  -o /usr/local/bin/mkcert && chmod +x /usr/local/bin/mkcert
mkcert -install
```

---

## Step 1 — Clone Repositories

Both repos must sit as siblings in the same directory. The allocator CSV data is mounted from `../allocator_inno_kotlin/csv`.

```bash
git clone https://github.com/yannonghuang/schub-openclaw.git
git clone https://github.com/yannonghuang/allocator_inno_kotlin.git

# Directory layout must be:
#   ~/schub-openclaw/
#   ~/allocator_inno_kotlin/

cd schub-openclaw
```

---

## Step 2 — Generate TLS Certificate

Replace `192.168.x.x` with your VM's actual LAN IP or internal hostname.

```bash
export SERVER_HOST=192.168.x.x        # e.g. 192.168.1.50 or myserver.local
mkdir -p certs
mkcert -cert-file certs/server.pem -key-file certs/server-key.pem \
  $SERVER_HOST localhost 127.0.0.1
```

**On each client machine** that needs to trust the certificate:

```bash
# Copy the CA root cert from the server:
#   ~/.local/share/mkcert/rootCA.pem  (Linux)
#   ~/Library/Application Support/mkcert/rootCA.pem  (macOS)

# Then on the client:
mkcert -install          # macOS / Linux — installs into browser/system trust store
# Windows: import rootCA.pem into "Trusted Root Certification Authorities" via certmgr.msc
```

---

## Step 3 — Configure Environment

```bash
cp .env.example .env
```

Edit `.env` and fill in at minimum:

| Variable | Description |
|----------|-------------|
| `FRONTEND_URL` | Full URL of the server, e.g. `https://192.168.x.x` |
| `OPENCLAW_TOKEN` | Generate with `openssl rand -hex 24` |
| `ANTHROPIC_API_KEY` | Your Anthropic API key |
| `SMTP_HOST/PORT/USER/PASS/FROM` | Outbound email (order/planning approval emails) |
| `IMAP_HOST/PORT/USER/PASS` | Inbound email (HITL reply polling) |
| `POSTGRES_PASSWORD` | DB password — can leave as `postgres` on an isolated LAN |

---

## Step 4 — Create External Docker Volumes

These are declared `external: true` in `docker-compose.yml` and must exist before the first run.

```bash
docker volume create schub_db-data
docker volume create schub_pgadmin-data
```

---

## Step 5 — Build and Start

```bash
docker compose pull          # pull base images (nginx, postgres, redis, pgadmin)
docker compose build         # build all custom service images
docker compose up -d         # start everything in the background
docker compose ps            # verify all services show "running" or "healthy"
```

To tail logs during startup:

```bash
docker compose logs -f
```

---

## Step 6 — Seed the Database

Wait for `auth-service` to be running, then seed the `schub` database:

```bash
docker compose exec auth-service python seed_db.py
docker compose exec auth-service python seed_materials.py
docker compose exec auth-service python seed_locations.py
docker compose exec auth-service python seed_transportations.py
```

The `allocator` database is created automatically by `db-init-allocator` and schema-migrated by the Kotlin backend on startup. Load CSV data via the API:

```bash
# Create a case (note the returned id)
curl -sk https://$SERVER_HOST:8000/cases \
  -H 'Content-Type: application/json' -d '{"name":"Default"}'

# Import CSV files (uses CSV_ROOT_PATH=/data/csv already mounted)
curl -sk -X POST https://$SERVER_HOST:8000/cases/1/import-csv \
  -H 'Content-Type: application/json' -d '{}'
```

---

## Step 7 — Configure Firewall

Expose only HTTPS to LAN clients. All internal service ports remain on the Docker network.

```bash
sudo ufw allow 22/tcp      # SSH
sudo ufw allow 443/tcp     # HTTPS (main UI + API)
sudo ufw allow 3001/tcp    # Allocator UI (optional — expose if needed)
sudo ufw enable
```

---

## Verification

| Check | Command |
|-------|---------|
| All services healthy | `docker compose ps` |
| Main UI | Open `https://$SERVER_HOST` in a browser |
| Allocator UI | Open `https://$SERVER_HOST:3001` |
| Auth API | `curl -sk https://$SERVER_HOST/auth/health` |
| Allocator API | `curl -sk https://$SERVER_HOST:8000/health` |
| Agent traces | Trigger a material event in the UI; confirm trace messages appear |
| Email HITL | Send a test message; verify openclaw receives the IMAP reply |
| Allocator smoke test | `SERVER_HOST=$SERVER_HOST ./scripts/smoke_test_kotlin.sh` |

---

## Updating

```bash
git pull
docker compose build
docker compose up -d        # rolling restart — running containers replaced one by one
```

---

---

## Image-Based Deployment (no source code on VM)

### On the build machine (your dev machine, run once per release)

```bash
cd schub-openclaw

# Set your registry (e.g. Docker Hub, GHCR, or a self-hosted registry)
export REGISTRY=ghcr.io/yourorg/    # trailing slash required
export TAG=1.0.0                     # or "latest"

./scripts/build-push.sh
```

To use a self-hosted private registry on the VM itself:
```bash
# On the VM — start a local registry
docker run -d -p 5000:5000 --restart=always --name registry registry:2

# On the dev machine
export REGISTRY=192.168.x.x:5000/
export TAG=latest
./scripts/build-push.sh
```

### On the VM (no source code needed)

Copy only these files to the VM:
```
docker-compose.prod.yml
nginx.conf.template
.env                        (fill in from .env.example)
certs/                      (TLS cert — generate with mkcert as in Step 2 above)
```

Copy your allocator CSV data:
```bash
sudo mkdir -p /opt/allocator-csv
sudo cp /path/to/your/csv/*.csv /opt/allocator-csv/
# Or set ALLOCATOR_CSV_PATH in .env to point to wherever your CSVs live
```

Add to `.env`:
```dotenv
REGISTRY=ghcr.io/yourorg/   # same registry used when building
TAG=1.0.0
ALLOCATOR_CSV_PATH=/opt/allocator-csv
```

Create volumes (first time only):
```bash
docker volume create schub_db-data
docker volume create schub_pgadmin-data
docker volume create schub_openclaw-workspace
```

Pull images and start:
```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml ps
```

Seed the database (first time only — same as Step 6 above):
```bash
docker compose -f docker-compose.prod.yml exec auth-service python seed_db.py
docker compose -f docker-compose.prod.yml exec auth-service python seed_materials.py
docker compose -f docker-compose.prod.yml exec auth-service python seed_locations.py
docker compose -f docker-compose.prod.yml exec auth-service python seed_transportations.py
```

### Updating to a new release

```bash
# On build machine:
TAG=1.1.0 REGISTRY=ghcr.io/yourorg/ ./scripts/build-push.sh

# On VM:
TAG=1.1.0 docker compose -f docker-compose.prod.yml pull
TAG=1.1.0 docker compose -f docker-compose.prod.yml up -d
```

> **Note:** The `openclaw-init` service re-copies agent instructions (AGENTS.md) and skills from the new image into the workspace volume on every `up`, so agent updates are picked up automatically. Runtime state (credentials, memory, sessions) in the volume is preserved.

---

## Service Reference

| Service | Host port | Purpose |
|---------|-----------|---------|
| nginx | 443 | TLS reverse proxy — main entry point |
| frontend-service | — (via nginx) | schub-openclaw Next.js UI |
| auth-service | 4000 | Business logic / session API |
| openclaw | 18789 | AI agent gateway |
| switch-service | 6000 | WebSocket / SSE pub-sub hub |
| adaptor | — | IMAP poll → HITL relay |
| audit-service | 9000 | Audit trail (Redis-backed) |
| mcp-server | 9500 | MCP engine gateway |
| allocator-backend | 8000 | Kotlin allocation engine |
| allocator-frontend | 3001 | Allocator Next.js UI |
| db (PostgreSQL) | 5432 | Shared database (`schub` + `allocator`) |
| redis | 6379 | Cache + message bus |
| pgadmin | 10000 | DB admin UI (dev/ops tool) |
