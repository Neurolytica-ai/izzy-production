# syntax=docker/dockerfile:1

# ---- build ----------------------------------------------------------------
FROM node:22.14-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json vite.config.ts ./
COPY src ./src
COPY scripts ./scripts
COPY web ./web
RUN npm run build && npm run web:build

# ---- runtime --------------------------------------------------------------
FROM node:22.14-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Production dependencies only.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

# Compiled front end. Nginx mounts ./public from the host in the Compose setup,
# so this copy is what makes the image self-contained if it is ever run without
# that bind mount.
COPY --from=build /app/public ./public

# Migrations, post-seed DDL and the extracted seed data ship with the image so a
# deploy can run `npm run migrate` against Supabase without a checkout.
COPY db ./db

# tsx is a dev dependency, so the compiled scripts are what run in production.
# Node's own signal handling is enough; no init shim needed for a single process.
USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/src/server.js"]
