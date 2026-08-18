FROM node:22-alpine AS build

WORKDIR /app/intent-router
RUN corepack enable
COPY intent-router/package.json intent-router/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY intent-router/tsconfig.json ./
COPY intent-router/src ./src
RUN pnpm build

FROM node:22-alpine AS runtime

ARG BUILD_VERSION=dev
ARG BUILD_ARCH=unknown

ENV NODE_ENV=production
WORKDIR /app/intent-router
RUN corepack enable
COPY intent-router/package.json intent-router/pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile
COPY --from=build /app/intent-router/dist ./dist
COPY intent-router/public ./public
COPY config /app/config
COPY contracts /app/contracts

LABEL io.hass.type="app" \
      io.hass.name="HUDK Home Intent Router" \
      io.hass.description="受限、可审计的家庭自然语言意图路由器" \
      io.hass.version="${BUILD_VERSION}" \
      io.hass.arch="${BUILD_ARCH}"

EXPOSE 8787
CMD ["node", "dist/app-entrypoint.js"]
