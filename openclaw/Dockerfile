FROM ghcr.io/openclaw/openclaw:latest

# Install supergateway — bridges HTTP/SSE MCP servers to stdio for bundle-mcp
USER root
RUN npm install -g supergateway && apt-get update -qq && apt-get install -y -qq gettext-base
# Allow node user to create symlinks in /app/skills at runtime
RUN chmod 777 /app/skills

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

USER node
ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "openclaw.mjs", "gateway", "--allow-unconfigured"]
