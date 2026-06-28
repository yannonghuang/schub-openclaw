DEV_FILES  = --env-file .env.dev  -f docker-compose.yml -f docker-compose.dev.yml
PROD_FILES = --env-file .env.prod -f docker-compose.yml -f docker-compose.prod.yml

.PHONY: dev dev-d dev-build prod prod-pull build push push-all mirror-base down down-prod logs logs-prod ps ps-prod seed-db psql

# ── Development ───────────────────────────────────────────────────────────────

# Derive JVM proxy system properties for the allocator-backend Gradle build from
# the shell proxy env (java.net ignores HTTP(S)_PROXY). localhost/127.0.0.1 is
# rewritten to host.docker.internal so the build container can reach a proxy on
# the host. Mirrors scripts/build-push.sh. Override by exporting GRADLE_PROXY_OPTS;
# leave the proxy env unset for direct egress.
define DERIVE_GRADLE_PROXY
export GRADLE_PROXY_OPTS="$${GRADLE_PROXY_OPTS:-}"; \
if [ -z "$$GRADLE_PROXY_OPTS" ]; then \
  _proxy="$${HTTPS_PROXY:-$${https_proxy:-$${HTTP_PROXY:-$${http_proxy:-}}}}"; \
  if [ -n "$$_proxy" ]; then \
    _hp="$${_proxy#*://}"; _hp="$${_hp%%/*}"; _host="$${_hp%%:*}"; _port="$${_hp##*:}"; \
    [ "$$_port" = "$$_hp" ] && _port=8080; \
    case "$$_host" in localhost|127.0.0.1|0.0.0.0) _host=host.docker.internal ;; esac; \
    export GRADLE_PROXY_OPTS="-Dhttp.proxyHost=$$_host -Dhttp.proxyPort=$$_port -Dhttps.proxyHost=$$_host -Dhttps.proxyPort=$$_port -Dhttp.nonProxyHosts=localhost|127.0.0.1|host.docker.internal"; \
    echo "==> Gradle build proxy derived from env: $$_host:$$_port (override via GRADLE_PROXY_OPTS=)"; \
  fi; \
fi
endef

dev:                          ## Start dev stack (foreground, hot-reload)
	docker compose $(DEV_FILES) up

dev-d:                        ## Start dev stack (detached)
	docker compose $(DEV_FILES) up -d

dev-build:                    ## Rebuild and start dev stack (busts compile layer, caches deps)
	@$(DERIVE_GRADLE_PROXY); \
	docker compose $(DEV_FILES) build --build-arg CACHEBUST=$$(date +%s) && docker compose $(DEV_FILES) up

# ── Production ────────────────────────────────────────────────────────────────

prod:                         ## Start prod stack from pre-built images (detached)
	docker compose $(PROD_FILES) up -d

prod-pull:                    ## Pull latest images, start prod stack, prune superseded images
	docker compose $(PROD_FILES) pull
	docker compose $(PROD_FILES) up -d
	docker compose $(PROD_FILES) restart nginx
	docker image prune -af   # reclaim images this pull superseded (volume-safe; see DEPLOY.md)

# ── Build & push ──────────────────────────────────────────────────────────────

build:                        ## Build all images (reads REGISTRY/TAG from .env.dev or env)
	docker compose $(DEV_FILES) build

push:                         ## Build only changed images, then tag+push all + mirror base images
	@set -a && . ./.env.dev && set +a && PATH="/usr/local/bin:$$PATH" ./scripts/build-push.sh

push-all:                     ## Force a full rebuild of every image, then push (use after base/dep bumps)
	@set -a && . ./.env.dev && set +a && PATH="/usr/local/bin:$$PATH" FORCE=1 ./scripts/build-push.sh

mirror-base:                  ## Mirror upstream base images (nginx/redis/pgvector) into the registry
	@set -a && . ./.env.dev && set +a && ./scripts/mirror-base.sh

# ── Common ────────────────────────────────────────────────────────────────────

down:                         ## Stop and remove containers (dev stack)
	docker compose $(DEV_FILES) down

down-prod:                    ## Stop and remove containers (prod stack)
	docker compose $(PROD_FILES) down

logs:                         ## Tail logs (dev stack)
	docker compose $(DEV_FILES) logs -f

logs-prod:                    ## Tail logs (prod stack)
	docker compose $(PROD_FILES) logs -f

ps:                           ## Show running services (dev stack)
	docker compose $(DEV_FILES) ps

ps-prod:                      ## Show running services (prod stack)
	docker compose $(PROD_FILES) ps

seed-db:                      ## Seed the schub database (run once after first start)
	docker compose $(DEV_FILES) exec auth-service python seed_db.py
	docker compose $(DEV_FILES) exec auth-service python seed_materials.py
	docker compose $(DEV_FILES) exec auth-service python seed_locations.py
	docker compose $(DEV_FILES) exec auth-service python seed_transportations.py

seed-db-prod:                 ## Seed the schub database on prod VM (run once after first start)
	docker compose $(PROD_FILES) exec auth-service python seed_db.py
	docker compose $(PROD_FILES) exec auth-service python seed_materials.py
	docker compose $(PROD_FILES) exec auth-service python seed_locations.py
	docker compose $(PROD_FILES) exec auth-service python seed_transportations.py

psql:                         ## Open a psql shell on the schub database
	docker compose $(DEV_FILES) exec db psql -U postgres -d schub

volumes-dev:                  ## Create local named volumes for dev (first-time setup)
	docker volume create schub_db-data
	docker volume create schub_pgadmin-data

volumes-prod:                 ## Create external named volumes for prod (first-time setup)
	docker volume create schub_db-data
	docker volume create schub_openclaw-workspace

help:                         ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*##' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*##"}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'
