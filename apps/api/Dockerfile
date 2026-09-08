# Build from the monorepo root: docker build -f apps/api/Dockerfile .
# Uses `turbo prune` so the image only contains what apps/api actually needs.

FROM node:20.19.0-alpine AS base
RUN apk add --no-cache libc6-compat openssl

FROM base AS builder
WORKDIR /app
RUN npm install -g turbo@2.10.11
COPY . .
RUN turbo prune api --docker

FROM base AS installer
WORKDIR /app
COPY --from=builder /app/out/json/ .
RUN npm install
COPY --from=builder /app/out/full/ .
RUN npx turbo run build --filter=api...

# Part F item #7 — PdfRendererService launches a real headless Chromium
# (playwright-core) at runtime. Playwright's bundled Chromium build does
# NOT support musl libc (Alpine) — verified by actually building and
# running this stage, not assumed from playwright-core's own docs alone.
# The builder/installer stages above stay Alpine (they only compile
# TypeScript, never launch a browser); only the runtime needs glibc.
FROM node:20.19.0-slim AS runner
WORKDIR /app
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nestjs
COPY --from=installer /app .
# PLAYWRIGHT_BROWSERS_PATH pins the browser cache to a fixed, absolute
# path shared by every user. Without it, Playwright resolves the cache
# under $HOME — which differs between the root user the RUN below executes
# as and the unprivileged `nestjs` user CMD runs as (an `adduser --system`
# account has no real home directory) — so the browser installed here
# would be invisible at runtime. Verified empirically, not assumed: the
# first version of this fix built cleanly but failed at container runtime
# with exactly this "Executable doesn't exist" error before this line was
# added — a real gap a successful `docker build` alone did not catch.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
# --with-deps installs Chromium's OS-level shared-library dependencies
# (fonts, libnss3, libatk, ...) via apt — must run as root, before USER
# below. Uses playwright-core's own bundled CLI (apps/api's actual
# dependency) rather than the separate `playwright` package this app
# doesn't otherwise need. chown so the unprivileged `nestjs` user (which
# did not do this install) can still read/execute the browser at runtime.
RUN npx playwright-core install --with-deps chromium \
  && chown -R nestjs:nodejs /ms-playwright
USER nestjs
EXPOSE 4000
ENV PORT=4000
# nest build outputs to dist/src/main.js here (rootDir inference from this
# project's tsconfig), not the dist/main.js some Nest examples assume.
CMD ["node", "apps/api/dist/src/main.js"]
