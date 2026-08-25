# Build from the monorepo root: docker build -f apps/api/Dockerfile .
# Uses `turbo prune` so the image only contains what apps/api actually needs.

FROM node:20.13.0-alpine AS base
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

FROM base AS runner
WORKDIR /app
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nestjs
COPY --from=installer /app .
USER nestjs
EXPOSE 4000
ENV PORT=4000
# nest build outputs to dist/src/main.js here (rootDir inference from this
# project's tsconfig), not the dist/main.js some Nest examples assume.
CMD ["node", "apps/api/dist/src/main.js"]
