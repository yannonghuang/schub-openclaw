# === Base stage ===
FROM node:20-alpine AS base
WORKDIR /app
COPY package.json package-lock.json* ./
# Next.js tries to query pnpm for registry config if pnpm-lock.yaml exists.
# Enable pnpm via Corepack so runtime tools can find it.
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
#RUN npm ci
#RUN npm install

# === Development stage ===
FROM base AS dev
WORKDIR /app
#COPY --from=base /app/node_modules ./node_modules
#COPY . .
#RUN npm install
EXPOSE 3000
CMD ["npm", "run", "dev"]

# === Production build stage ===
FROM base AS builder
WORKDIR /app
COPY . .
RUN npm ci    # Install dependencies here
RUN npm run build

# === Production runtime stage ===
FROM node:20-alpine AS prod
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next .next
COPY --from=builder /app/public public
COPY --from=builder /app/package.json package.json
COPY --from=builder /app/node_modules node_modules
COPY --from=builder /app/next.config.js next.config.js
COPY --from=builder /app/next-i18next.config.js next-i18next.config.js
EXPOSE 3000
CMD ["npm", "start"]
