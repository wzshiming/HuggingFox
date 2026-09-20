# syntax=docker/dockerfile:1

ARG NPM_REGISTRY=https://registry.npmjs.org

FROM node:22-alpine AS build
ARG NPM_REGISTRY
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    COREPACK_NPM_REGISTRY=${NPM_REGISTRY} \
    npm_config_registry=${NPM_REGISTRY}
RUN corepack enable pnpm
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts
COPY . .
RUN pnpm build

FROM nginx:alpine
COPY --from=build /app/build/app /usr/share/nginx/html
COPY deploy/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --chmod=755 deploy/15-hub-upstream.envsh /docker-entrypoint.d/15-hub-upstream.envsh
EXPOSE 80
