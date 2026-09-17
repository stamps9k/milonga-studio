# ---- Build stage --------------------------------------------------------
# Full (non-slim) image: has the toolchain better-sqlite3 needs to compile
# its native binding from source if no prebuilt binary matches this
# platform, and runs the full npm install (incl. devDependencies) plus the
# Vite build.
FROM node:22 AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY . .
RUN npm run build

# Drop devDependencies from node_modules now that the build is done, but
# keep the already-compiled native binaries -- avoids a second install in
# the runtime stage, so builder and runtime never risk resolving different
# versions or rebuilding against a different platform.
RUN npm prune --omit=dev

# ---- Runtime stage --------------------------------------------------------
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/api ./api
COPY --from=builder /app/db/schema.sql ./db/schema.sql
COPY --from=builder /app/src/libs/dance ./src/libs/dance

# The actual database file is not baked into the image -- it's expected to
# be mounted (see docker-compose.yml) so data survives image rebuilds. If
# nothing is mounted, api/db.mts initializes a fresh one from schema.sql.
ENV API_PORT=58735
ENV DB_PATH=/app/db/milonga.sqlite
EXPOSE 58735

CMD ["npx", "tsx", "api/server.mts"]
