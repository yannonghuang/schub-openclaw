# Private Cloud Deployment Guide

Deploys the full schub-openclaw stack (nginx, PostgreSQL, Redis, auth-service, frontend, openclaw agents, switch-service, adaptor, audit-service, mcp-server, allocator-backend, allocator-frontend) onto a single Linux VM using Docker Compose and self-signed TLS.

Two deployment modes are supported:

| Mode | When to use | Source code on VM? | Command |
|------|-------------|-------------------|---------|
| **Source-based** (Steps 1–8 below) | Dev / first-time setup | Yes — build runs on the VM | `make dev-build` |
| **Image-based** (see [Image-Based Deployment](#image-based-deployment-no-source-code-on-vm)) | Production / repeatable deploys | No — pull pre-built images | `make prod-pull` |

---

## Prerequisites

Fresh Ubuntu 22.04+ / Debian 12+ server with internet access.

### Docker Engine + Compose v2

> **Important:** Install Docker Engine via the official script, not via `snap`. The snap package is an older version that lacks Compose v2 and causes iptables conflicts.

```bash
# Remove snap Docker if present
sudo snap remove docker 2>/dev/null || true

# Install Docker Engine (includes Compose v2 plugin)
curl -fsSL https://get.docker.com | sudo sh

# Allow the current user to run docker without sudo
sudo usermod -aG docker $USER
newgrp docker          # activate group in current shell (or log out/in)

# Verify
docker compose version  # must show v2.x
```

> **If Docker socket is missing** after install (`/var/run/docker.sock: no such file or directory`):
> ```bash
> sudo systemctl stop docker docker.socket
> sudo systemctl start docker.socket
> sudo systemctl start docker
> ```

> **If you see "iptables-legacy tables present"** after switching from snap to apt Docker (port forwarding broken):
> ```bash
> sudo iptables-legacy -F && sudo iptables-legacy -X
> sudo iptables-legacy -t nat -F && sudo iptables-legacy -t nat -X
> sudo systemctl restart docker
> # If port forwarding still fails, use host networking for the registry:
> docker run -d --network=host --restart=always --name registry registry:2
> ```

### Other tools

```bash
sudo apt install -y libnss3-tools curl make

# mkcert (self-signed TLS)
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

The root CA is at `~/.local/share/mkcert/rootCA.pem` (Linux) or `~/Library/Application Support/mkcert/rootCA.pem` (macOS).

**On each client machine** that needs to trust the certificate:

```bash
# Copy rootCA.pem from the server, then:

# macOS
sudo security add-trusted-cert -d -r trustRoot \
  -k /Library/Keychains/System.keychain rootCA.pem

# Linux
sudo cp rootCA.pem /usr/local/share/ca-certificates/schub-rootCA.crt
sudo update-ca-certificates

# Windows: import rootCA.pem into "Trusted Root Certification Authorities" via certmgr.msc
```

> To verify trusted CAs on macOS: open **Keychain Access → System → Certificates**, or run:
> ```bash
> security find-certificate -a /Library/Keychains/System.keychain | grep "labl"
> ```

---

## Step 3 — Configure Environment

`.env.dev` ships with sensible defaults for local/dev use. Edit it and fill in at minimum:

```bash
nano .env.dev
```

| Variable | Description |
|----------|-------------|
| `FRONTEND_URL` | Full URL of the server, e.g. `https://192.168.x.x` |
| `OPENCLAW_TOKEN` | Generate with `openssl rand -hex 24` |
| `ANTHROPIC_API_KEY` | Your Anthropic API key |
| `SMTP_HOST/PORT/USER/PASS/FROM` | Outbound email (order/planning approval emails) |
| `IMAP_HOST/PORT/USER/PASS` | Inbound email (HITL reply polling) |
| `POSTGRES_PASSWORD` | DB password — can leave as `postgres` on an isolated LAN |

---

## Step 4 — Create Docker Volumes

```bash
make volumes-dev
```

This creates `schub_db-data` and `schub_pgadmin-data` as **external named volumes**.

> **Why external volumes?** Plain (non-external) volumes are auto-named by Compose and will be silently deleted by `docker compose down -v`. External volumes are never deleted by Compose — you must remove them explicitly. Always use external volumes for databases.

---

## Step 5 — Build and Start

```bash
make dev-build       # build all images from source and start in foreground
# or
make dev-d           # start without rebuilding (detached)
```

Check that all services are running:

```bash
make ps
```

To tail logs during startup:

```bash
make logs
```

---

## Step 6 — Seed the Database

Wait for `auth-service` to be healthy, then:

```bash
make seed-db
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
sudo ufw allow 443/tcp     # HTTPS (main UI + API — includes /allocator/ path)
sudo ufw enable
```

> **Note:** Do not expose port 5000 publicly if you are running a private Docker registry — restrict it to your LAN or keep it behind a VPN.

---

## Verification

| Check | Command |
|-------|---------|
| All services healthy | `make ps` |
| Main UI | Open `https://$SERVER_HOST` in a browser |
| Allocator UI | Sign in, then open `https://$SERVER_HOST/allocator/` |
| Auth API | `curl -sk https://$SERVER_HOST/auth/health` |
| Allocator API | `curl -sk https://$SERVER_HOST:8000/health` |
| Agent traces | Trigger a material event in the UI; confirm trace messages appear |
| Email HITL | Send a test message; verify openclaw receives the IMAP reply |
| Allocator smoke test | `SERVER_HOST=$SERVER_HOST ./scripts/smoke_test_kotlin.sh` |

## Common Operations

| Action | Dev machine | VM (prod) |
|--------|------------|-----------|
| Start (foreground) | `make dev` | — |
| Start (detached) | `make dev-d` | `make prod` |
| Pull and start | — | `make prod-pull` |
| Rebuild and start | `make dev-build` | `make push` then `make prod-pull` |
| Stop containers | `make down` | `make down-prod` |
| Tail logs | `make logs` | `make logs-prod` |
| Show running services | `make ps` | `make ps-prod` |
| Open psql shell | `make psql` | `docker compose --env-file .env.prod -f docker-compose.yml -f docker-compose.prod.yml exec db psql -U postgres -d schub` |

---

## Updating (source-based)

```bash
git pull
make dev-build      # rebuild changed images and restart
```

---

---

## Image-Based Deployment (no source code on VM)

### Docker registry

Run a private registry on the VM (recommended — both machines can reach the VM's IP reliably):

```bash
# On the VM — use host networking to avoid Docker iptables issues
docker run -d --network=host --restart=always --name registry registry:2
```

Verify from the build machine:
```bash
curl http://192.168.x.x:5000/v2/    # should return {}
```

**The build machine also needs to trust the plain HTTP registry.** In Docker Desktop → Settings → Docker Engine, add:
```json
"insecure-registries": ["192.168.x.x:5000"]
```
Click **Apply & Restart**. On Linux build machines, add the same to `/etc/docker/daemon.json` and `sudo systemctl restart docker`.

> **If push times out from macOS (`context deadline exceeded`):** Docker Desktop's internal VM may not route to the host's own LAN IP. Run the registry on the VM (not the Mac) and push to the VM's IP instead.

---

### On the build machine (your dev machine, run once per release)

Set `REGISTRY` in `.env.dev` to point to the VM's registry:

```dotenv
REGISTRY=192.168.x.x:5000/   # trailing slash required
TAG=latest
```

Then build and push all images:

```bash
make push
```

---

### On the VM (no source code needed)

Copy only these files to the VM:

```
docker-compose.yml
docker-compose.prod.yml
nginx.conf.template
Makefile
.env.prod               (fill in from .env.example — see below)
certs/                  (TLS cert — generate with mkcert as in Step 2 above)
```

Create `.env.prod` from the template:

```bash
cp .env.example .env.prod
nano .env.prod
```

Fill in all values, including:

```dotenv
FRONTEND_URL=https://192.168.x.x     # VM's LAN IP or hostname
REGISTRY=192.168.x.x:5000/           # same registry used when building
TAG=latest
ALLOCATOR_CSV_PATH=/opt/allocator-csv
OPENCLAW_TOKEN=<generate with openssl rand -hex 24>
ANTHROPIC_API_KEY=<your key>
# ... SMTP, IMAP, POSTGRES_PASSWORD, etc.
```

Copy your allocator CSV data:
```bash
sudo mkdir -p /opt/allocator-csv
sudo cp /path/to/your/csv/*.csv /opt/allocator-csv/
```

Create external volumes (first time only):
```bash
make volumes-prod
```

Pull images and start:
```bash
make prod-pull
make ps-prod
```

Seed the database (first time only):
```bash
make seed-db
```

### Updating to a new release

On the build machine:
```bash
make push          # rebuilds and pushes with REGISTRY/TAG from .env.dev
```

On the VM:
```bash
make prod-pull     # pulls new images and restarts
```

> **Note:** The `openclaw-init` service re-copies agent instructions (AGENTS.md) and skills from the new image into the workspace volume on every `up`, so agent updates are picked up automatically. Runtime state (credentials, memory, sessions) in the volume is preserved.

---

## Troubleshooting

### `docker compose` not found / `unknown flag: --env-file`
The system has an old Docker (e.g. installed via snap). Remove it and install Docker Engine v2:
```bash
sudo snap remove docker
curl -fsSL https://get.docker.com | sudo sh
```

### `dial unix /var/run/docker.sock: no such file or directory`
The Docker daemon is not running. Start it:
```bash
sudo systemctl stop docker docker.socket
sudo systemctl start docker.socket && sudo systemctl start docker
ls -la /var/run/docker.sock   # should now exist
```

### Port not reachable from outside even though container is running
Caused by iptables-legacy rules left over from snap Docker conflicting with the new apt Docker:
```bash
sudo iptables-legacy -F && sudo iptables-legacy -X
sudo iptables-legacy -t nat -F && sudo iptables-legacy -t nat -X
sudo systemctl restart docker
```
If the issue persists, run services with `--network=host` (e.g. the registry container).

### nginx 504 — containers can't reach each other (inter-container networking broken)
Symptom: `curl http://<container-ip>:3000` works from the VM host but not from inside another container on the same Docker network. `nginx` logs show `upstream timed out (110)`.

Root cause: `iptables-legacy` (left over from snap Docker) has `policy DROP` on its FORWARD chain. Modern apt Docker uses `iptables-nft`, but the kernel still evaluates the legacy tables first — so all container-to-container traffic is silently dropped before Docker's nft rules run.

Diagnose:
```bash
sudo iptables-legacy -L FORWARD -n 2>/dev/null
# If you see "policy DROP" with no ACCEPT rules → this is the cause
```

Fix — set the legacy FORWARD policy to ACCEPT and flush all legacy rules:
```bash
sudo iptables-legacy -P FORWARD ACCEPT   # immediate fix — containers can talk again

# Full flush so it doesn't reappear after restart:
sudo iptables-legacy -F
sudo iptables-legacy -X
sudo iptables-legacy -t nat -F
sudo iptables-legacy -t nat -X
sudo iptables-legacy -t mangle -F
sudo iptables-legacy -t mangle -X
sudo iptables-legacy -P INPUT ACCEPT
sudo iptables-legacy -P FORWARD ACCEPT
sudo iptables-legacy -P OUTPUT ACCEPT
```

Verify networking is restored (no restart needed):
```bash
docker exec schub-openclaw-nginx-1 curl -s --max-time 5 http://frontend-service:3000 | head -1
# should return HTML immediately
```

### Push fails with `https://` error to a plain HTTP registry
Docker is trying TLS on an HTTP-only registry. Add the registry to insecure-registries in Docker's daemon config and restart Docker (see registry setup above).

### `docker: command not found` on macOS after switching from OrbStack to Docker Desktop
OrbStack leaves broken symlinks at `/usr/local/bin/docker` and `/usr/local/bin/docker-credential-osxkeychain`. Fix:
```bash
sudo rm /usr/local/bin/docker
sudo rm /usr/local/bin/docker-credential-osxkeychain
sudo ln -s /Applications/Docker.app/Contents/Resources/bin/docker /usr/local/bin/docker
sudo ln -s /Applications/Docker.app/Contents/Resources/bin/docker-credential-osxkeychain /usr/local/bin/docker-credential-osxkeychain
```
Also switch Docker context:
```bash
docker context use desktop-linux
```

### Database appears empty after restarting the stack
Check which volume is actually mounted:
```bash
docker inspect <db-container> --format '{{json .Mounts}}'
```
The dev stack uses `schub_db-data` (external). If the volume name changed (e.g. after restructuring compose files), data may be in an old volume. Use `docker volume ls` to find it and update the volume declaration in `docker-compose.dev.yml` to point to the correct volume name with `external: true`.

### `make down` / `make ps` / `make logs` fails with "no such file: .env.dev" on the VM
These targets use the dev env file. On the VM (prod), use the prod variants:
- `make ps-prod`, `make logs-prod`, `make down-prod`

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
