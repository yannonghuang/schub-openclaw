DEV_FILES  = --env-file .env.dev  -f docker-compose.yml -f docker-compose.dev.yml
PROD_FILES = --env-file .env.prod -f docker-compose.yml -f docker-compose.prod.yml

.PHONY: dev dev-d dev-build prod prod-pull build push down down-prod logs logs-prod ps ps-prod seed-db psql

# ── Development ───────────────────────────────────────────────────────────────

dev:                          ## Start dev stack (foreground, hot-reload)
	docker compose $(DEV_FILES) up

dev-d:                        ## Start dev stack (detached)
	docker compose $(DEV_FILES) up -d

dev-build:                    ## Rebuild and start dev stack
	docker compose $(DEV_FILES) up --build

# ── Production ────────────────────────────────────────────────────────────────

prod:                         ## Start prod stack from pre-built images (detached)
	docker compose $(PROD_FILES) up -d

prod-pull:                    ## Pull latest images then start prod stack
	docker compose $(PROD_FILES) pull
	docker compose $(PROD_FILES) up -d
	docker compose $(PROD_FILES) restart nginx

# ── Build & push ──────────────────────────────────────────────────────────────

build:                        ## Build all images (reads REGISTRY/TAG from .env.dev or env)
	docker compose $(DEV_FILES) build

push:                         ## Build and push all images to registry (reads REGISTRY/TAG from .env.dev)
	@set -a && . ./.env.dev && set +a && PATH="/usr/local/bin:$$PATH" ./scripts/build-push.sh

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
	docker volume create schub_pgadmin-data
	docker volume create schub_openclaw-workspace

help:                         ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*##' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*##"}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'
