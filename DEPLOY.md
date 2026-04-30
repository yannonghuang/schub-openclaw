# Private Cloud Deployment Guide

Deploys the full schub-openclaw stack (nginx, PostgreSQL, Redis, auth-service, frontend, openclaw agents, switch-service, adaptor, audit-service, mcp-server, allocator-backend, allocator-frontend) onto a single Linux VM using Docker Compose and self-signed TLS.

Two deployment modes are supported:

| Mode | When to use | Source code on VM? | Command |
|------|-------------|-------------------|---------|
| **Source-based** (Steps 1–6 below) | Dev / first-time setup | Yes — build runs on the VM | `make dev-build` |
| **Image-based** (see [Image-Based Deployment](#image-based-deployment-no-source-code-on-vm)) | Production / repeatable deploys | No — pull pre-built images | `make prod-pull` |

---

## Prerequisites

Target host: a bare-metal or VM Linux server with internet access for pulling
base images and (optionally) reaching Anthropic / SMTP / IMAP endpoints.

### Operating system

| Item | Requirement |
|------|-------------|
| OS family | Linux, x86_64 (64-bit) |
| Tested distributions | Ubuntu 22.04 / 24.04 LTS, Debian 12 |
| Also expected to work | RHEL 9, Rocky Linux 9, AlmaLinux 9 (adjust `apt` → `dnf`) |
| Kernel | 5.15+ (required by Docker 24+) |
| systemd | Required (supervises the Docker daemon) |
| Locale | `en_US.UTF-8` or any UTF-8 locale (CSV imports assume UTF-8) |
| Timezone | `UTC` recommended |

macOS and Windows are supported only as **build / dev machines**, not as
production hosts.

### Hardware (single-host install)

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| CPU | 4 cores (x86_64) | 8 cores |
| RAM | 8 GB | 16 GB (allocation / planning engines are memory-heavy on large cases) |
| Disk | 50 GB SSD | 200 GB NVMe SSD (Postgres + run history + image layers grow over time) |
| Network | 100 Mbps | 1 Gbps LAN |
| Filesystem | `ext4` or `xfs` (avoid NFS for the Postgres volume) |

### Required host tools

All application runtimes (Node, JDK, Python, Postgres, Redis) run **inside
containers** — you do NOT install them on the host. Only the following host
tools are required:

| Tool | Minimum version | Purpose | Required? |
|------|-----------------|---------|-----------|
| `docker` (Engine) | 24.0+ | Runs every service | yes |
| `docker compose` (plugin) | v2.20+ | Orchestrates `docker-compose*.yml` | yes |
| `make` | 4.0+ | Entry point for every workflow (`make dev-build`, `make prod-pull`, …) | yes |
| `git` | 2.30+ | Clone / update source-based deploys (skip for image-based) | source-based only |
| `curl` | any | Installer scripts, health checks | yes |
| `openssl` | 1.1.1+ | Generate `OPENCLAW_TOKEN` and other secrets | yes |
| `mkcert` | 1.4+ | Self-signed TLS cert for internal HTTPS (Step 2) | yes |
| `libnss3-tools` | — | Dependency of `mkcert` on Debian/Ubuntu | yes (apt) |
| `ufw` / `firewalld` | — | Host firewall (Step 7) | yes |
| `bash` | 4+ | Runs `scripts/*.sh` (e.g. `smoke_test_kotlin.sh`) | yes |

### Network & ports

Only 22 (SSH) and 443 (HTTPS) need to be reachable from LAN clients. Every
other service port is on the internal Docker network. If you run the optional
private Docker registry on the VM, expose port 5000 to the build machine only.

See the [Service Reference](#service-reference) table at the bottom for the
full list of container ports and whether they are published to the host.

Outbound HTTPS (443) required from the Prod VM at runtime:

- **Docker Hub** — pulls `nginx`, `redis`, `pgvector/pgvector`, `dpage/pgadmin4`, and `registry:2` (base images referenced directly by compose; not in your private registry):
  - `registry-1.docker.io` — registry API
  - `auth.docker.io` — token exchange
  - `production.cloudflare.docker.com` — layer blob CDN (layers aren't served from the registry host itself)
- `api.anthropic.com` — always, for openclaw gateway LLM calls. Under the default `LLM_PROVIDER=openclaw`, allocator impact-assessment + planning-copilot traffic piggybacks on the same egress (allocator → openclaw gateway in-network, gateway → Anthropic). Only when `LLM_PROVIDER=anthropic` does the allocator call `api.anthropic.com` directly.
- `api.openai.com` — **conditional**: only when `LLM_PROVIDER=openai`, for allocator impact-assessment + planning-copilot.
- Your SMTP host (587 or 465) and IMAP host (993) — HITL email relay
- **Conditional**: `slack.com` / `api.telegram.org` only if `SLACK_BOT_TOKEN` / `TELEGRAM_BOT_TOKEN` are set
- **Conditional**: `ghcr.io`, `pkg-containers.githubusercontent.com` only if `REGISTRY=ghcr.io/yourorg/` (not needed when using the private VM registry)

One-time outbound HTTPS required **before** Docker is installed (host bootstrap):

- `get.docker.com`, `download.docker.com` — Docker Engine installer
- `github.com`, `objects.githubusercontent.com` — mkcert binary download
- `deb.debian.org`, `security.debian.org` — `apt install libnss3-tools curl make`

> The Prod VM does **not** need PyPI / npmjs / Maven Central / Gradle egress — all `pip install`, `npm ci`, and `./gradlew shadowJar` steps run on the build machine, not on the VM.

### 系统要求（简明中文版）

生产环境部署仅支持 **Linux x86_64** 主机，所有应用运行时均在容器内，无需在主机安装。

**操作系统**：Ubuntu 22.04/24.04 LTS 或 Debian 12（已测试）；RHEL/Rocky/Alma 9（预期可用）。内核 5.15+，systemd，UTF-8 locale，建议 UTC 时区。

**硬件（单机部署）**：

| 资源 | 最低配置 | 推荐配置 |
|------|----------|----------|
| CPU | 4 核 | 8 核 |
| 内存 | 8 GB | 16 GB |
| 磁盘 | 50 GB SSD | 200 GB NVMe SSD |
| 网络 | 100 Mbps | 1 Gbps 局域网 |
| 文件系统 | ext4 / xfs（Postgres 卷不要用 NFS） | 同左 |

**必装主机工具**：`docker` (24.0+)、`docker compose` v2 (2.20+)、`make` (4.0+)、`git`、`curl`、`openssl`、`mkcert`、`libnss3-tools`、`ufw` 或 `firewalld`、`bash`。

**网络端口**：对外仅需开放 22 (SSH) 与 443 (HTTPS)；其他服务端口全部在 Docker 内部网络。私有镜像仓库（可选）端口 5000 仅对构建机开放。

**生产 VM 运行时出站访问**（443/tcp）：

- **Docker Hub**（拉取 `nginx`、`redis`、`pgvector/pgvector`、`dpage/pgadmin4`、`registry:2` 等基础镜像，这些未进入私有镜像仓库，compose 直接引用）：`registry-1.docker.io`（API）、`auth.docker.io`（鉴权）、`production.cloudflare.docker.com`（层数据 CDN，层不是从 registry 主机直出）
- `api.anthropic.com`：始终需要——openclaw 网关的 LLM 出站。默认 `LLM_PROVIDER=openclaw` 时，allocator 的影响评估与规划副驾驶经内部网关 `http://openclaw:18789` 间接复用这条通道（allocator → openclaw → Anthropic）；仅当 `LLM_PROVIDER=anthropic` 时，allocator 才会直接调用 `api.anthropic.com`。
- `api.openai.com`：**条件项**——仅当 `LLM_PROVIDER=openai` 时，allocator 的影响评估与规划副驾驶才会调用此地址。
- SMTP 主机（587/465）与 IMAP 主机（993）——HITL 邮件往返
- **条件项**：`slack.com` / `api.telegram.org` 仅当设置了 `SLACK_BOT_TOKEN` / `TELEGRAM_BOT_TOKEN`
- **条件项**：`ghcr.io`、`pkg-containers.githubusercontent.com` 仅当 `REGISTRY=ghcr.io/yourorg/`（使用 VM 本地私有仓库时无需）

**主机引导阶段（Docker 安装前）一次性出站**：`get.docker.com`、`download.docker.com`（Docker 安装脚本）；`github.com`、`objects.githubusercontent.com`（mkcert 二进制）；`deb.debian.org`、`security.debian.org`（apt 安装 libnss3-tools / curl / make）。

> 生产 VM **不需要** PyPI / npmjs / Maven Central / Gradle 出站——所有 `pip install`、`npm ci`、`./gradlew shadowJar` 都在构建机上完成。

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
| `ANTHROPIC_API_KEY` | Anthropic credential for OpenClaw. Accepts a real API key (`sk-ant-api03-*`) or a Claude Pro OAuth token (`sk-ant-oat01-*`). Also used by the allocator when `LLM_PROVIDER=anthropic`, but in that mode only a real API key works. |
| `LLM_PROVIDER` | Allocator LLM provider: `openclaw` (default — routes through the gateway; works with OAuth tokens), `anthropic` (direct `api.anthropic.com`, requires a real API key), or `openai` (direct `api.openai.com`). |
| `OPENAI_API_KEY` | Optional — only required when `LLM_PROVIDER=openai` |
| `SMTP_HOST/PORT/USER/PASS/FROM` | Outbound email (order/planning approval emails) |
| `IMAP_HOST/PORT/USER/PASS` | Inbound email (HITL reply polling) |
| `POSTGRES_PASSWORD` | DB password — can leave as `postgres` on an isolated LAN |

---

## Step 4 — Build and Start

```bash
make dev-build       # build all images from source and start in foreground
# or
make dev-d           # start without rebuilding (detached)
```

Compose auto-creates the named volumes (`schub_db-data`, `schub_pgadmin-data`) on the first `up`; no separate setup step is needed. (`make volumes-dev` is still available as an idempotent helper if you prefer to create them explicitly first.)

> **Volume safety note:** these are non-external named volumes. `docker compose down -v` (the `-v` flag) will delete them along with all DB data. Plain `docker compose down` is safe — it stops containers but leaves volumes intact. Avoid `down -v` on machines with data you want to keep.

Check that all services are running:

```bash
make ps
```

To tail logs during startup:

```bash
make logs
```

---

## Step 5 — Seed the Database

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

## Step 6 — Configure Firewall

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

## Switching the Allocator LLM Provider

The allocator-backend image has all three provider paths compiled in (`openclaw`, `anthropic`, `openai`). Switching is an env flip + container restart — **no rebuild**.

| Mode | When to use | Requires |
|------|-------------|----------|
| `openclaw` (default) | Stay inside the stack; reuse whatever OpenClaw is configured for. Works with a Claude Pro OAuth token (`sk-ant-oat01-*`). | `OPENCLAW_TOKEN` (already set for the gateway) |
| `anthropic` | Call `api.anthropic.com` directly — bypass the gateway. | A real Anthropic API key (`sk-ant-api03-*`) in `ANTHROPIC_API_KEY`. OAuth tokens do **not** work here. Prod VM must have egress to `api.anthropic.com`. |
| `openai` | Call `api.openai.com` directly. | `OPENAI_API_KEY` in `.env.prod`. Prod VM must have egress to `api.openai.com`. |

**To switch (on the VM):**

```bash
# Edit .env.prod — set or change:
#   LLM_PROVIDER=openai         # or anthropic, or openclaw
#   OPENAI_API_KEY=sk-...       # only if switching to openai
#   ANTHROPIC_API_KEY=sk-...    # real API key if switching to anthropic; any value works for openclaw mode

docker compose --env-file .env.prod -f docker-compose.yml -f docker-compose.prod.yml up -d allocator-backend
```

**To revert to the default:** remove (or comment out) the `LLM_PROVIDER=` line in `.env.prod` and restart `allocator-backend`. Compose's `${LLM_PROVIDER:-openclaw}` default takes over.

> OpenClaw's own LLM calls always go through `ANTHROPIC_API_KEY` regardless of this setting. `LLM_PROVIDER` only affects the allocator's impact-assessment + planning-copilot calls.

---

## Updating (source-based)

```bash
git pull
make dev-build      # rebuild changed images and restart
```

---

## Database: Replicating Dev Data to Prod

There are two independent databases: `schub` (auth, materials, locations, orders) and `allocator` (cases, allocation runs).

### Approach A — Re-seed from scripts (first-time / clean prod)

Runs the same deterministic seed scripts used in dev:

```bash
# On the VM
make seed-db-prod
```

Then load allocator CSV data (CSVs must already be at `ALLOCATOR_CSV_PATH`):

```bash
export SERVER_HOST=192.168.x.x

# Create a case
curl -sk https://$SERVER_HOST:8000/cases \
  -H 'Content-Type: application/json' -d '{"name":"Default"}'

# Import CSV files
curl -sk -X POST https://$SERVER_HOST:8000/cases/1/import-csv \
  -H 'Content-Type: application/json' -d '{}'
```

### Approach B — pg_dump / restore (promote real dev data to prod)

Use this when you have business data in dev (users, orders, overrides, etc.) that you want to replicate exactly.

**1. Dump on dev machine:**

```bash
docker compose --env-file .env.dev -f docker-compose.yml -f docker-compose.dev.yml \
  exec db pg_dump -U postgres -d schub --no-owner --no-acl \
  > schub_$(date +%Y%m%d).sql
```

For the allocator database:

```bash
docker compose --env-file .env.dev -f docker-compose.yml -f docker-compose.dev.yml \
  exec db pg_dump -U postgres -d allocator --no-owner --no-acl \
  > allocator_$(date +%Y%m%d).sql
```

**2. Copy dump files to the VM:**

```bash
scp schub_$(date +%Y%m%d).sql allocator_$(date +%Y%m%d).sql user@$SERVER_HOST:~/
```

**3. Restore on the VM:**

```bash
# Stop services that hold connections (keep db running)
docker compose --env-file .env.prod -f docker-compose.yml -f docker-compose.prod.yml \
  stop auth-service openclaw adaptor audit-service allocator-backend allocator-frontend

# Restore schub
docker compose --env-file .env.prod -f docker-compose.yml -f docker-compose.prod.yml \
  exec -T db psql -U postgres -d schub < ~/schub_YYYYMMDD.sql

# Restore allocator
docker compose --env-file .env.prod -f docker-compose.yml -f docker-compose.prod.yml \
  exec -T db psql -U postgres -d allocator < ~/allocator_YYYYMMDD.sql

# Restart stopped services
docker compose --env-file .env.prod -f docker-compose.yml -f docker-compose.prod.yml \
  up -d
```

> **Note:** `--no-owner --no-acl` keeps the dump portable across environments. The restore connects as `postgres` which owns all objects anyway.

> **Warning:** Restoring overwrites all existing prod data. Take a prod dump first if there is data worth preserving.

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
ANTHROPIC_API_KEY=<your key — sk-ant-api03-* or sk-ant-oat01-*>
LLM_PROVIDER=openclaw                # default — allocator goes through openclaw gateway (OAuth token OK)
                                     #   set to "anthropic" to call api.anthropic.com directly (requires a real sk-ant-api03-* key)
                                     #   set to "openai" to call api.openai.com directly (requires OPENAI_API_KEY)
# OPENAI_API_KEY=<your key>          # only required when LLM_PROVIDER=openai
# ... SMTP, IMAP, POSTGRES_PASSWORD, etc.
```

Copy your allocator CSV data:
```bash
sudo mkdir -p /opt/allocator-csv
sudo cp /path/to/your/csv/*.csv /opt/allocator-csv/
```

Pull images and start:
```bash
make prod-pull
make ps-prod
```

> Volumes (`schub_db-data`, `schub_pgadmin-data`, `schub_openclaw-workspace`) are auto-created by compose on first `up`; no separate setup step is needed. `make volumes-prod` is still available as an idempotent helper if you prefer to create them explicitly first. As with dev, plain `make down-prod` is safe; `docker compose down -v` will delete the volumes and the data.

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
Both stacks pin the volume to a stable name (`name: schub_db-data` in compose) so existing data is preserved across `up`/`down`/rebuilds. If the data appears empty, the most likely cause is that someone ran `docker compose down -v` (the `-v` flag deletes volumes), or that an *older* version of the compose file used a different volume name and your data is in that old volume. Use `docker volume ls` to find it; you can re-attach by changing the `name:` in `docker-compose.dev.yml` to match.

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
