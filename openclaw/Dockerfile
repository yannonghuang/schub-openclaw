FROM ghcr.io/openclaw/openclaw:latest

# Install supergateway — bridges HTTP/SSE MCP servers to stdio for bundle-mcp
USER root
RUN npm install -g supergateway && apt-get update -qq && apt-get install -y -qq gettext-base
# Allow node user to create symlinks in /app/skills at runtime
RUN chmod 777 /app/skills

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Stage workspace config into a separate directory.
# The init container (docker-compose.prod.yml) copies these into the named
# workspace volume on each deploy, refreshing agent instructions and skills
# without touching runtime state (credentials, memory, sessions, identity).
COPY --chown=node:node agents/        /home/node/.openclaw-defaults/agents/
COPY --chown=node:node skills/        /home/node/.openclaw-defaults/skills/
COPY --chown=node:node openclaw.json.template /home/node/.openclaw-defaults/openclaw.json.template
COPY --chown=node:node canvas/        /home/node/.openclaw-defaults/canvas/
COPY --chown=node:node subagents/     /home/node/.openclaw-defaults/subagents/
COPY --chown=node:node telegram/      /home/node/.openclaw-defaults/telegram/
RUN mkdir -p /home/node/.openclaw-defaults && chown node:node /home/node/.openclaw-defaults

USER node
ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "openclaw.mjs", "gateway", "--allow-unconfigured"]
