FROM node:24-alpine AS base
RUN corepack enable && corepack prepare pnpm@11.23.0 --activate
WORKDIR /repo

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages ./packages
COPY services ./services
COPY apps ./apps
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @velnes/api build

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /repo/services/api/dist ./dist
COPY --from=build /repo/services/api/package.json ./package.json
EXPOSE 3001
CMD ["node", "dist/index.js"]
