# syntax=docker/dockerfile:1

ARG NPM_REGISTRY=https://registry.npmjs.org
ARG GOPROXY=https://proxy.golang.org,direct

FROM node:22-alpine AS web
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

FROM golang:1.26-alpine3.23 AS build
ARG GOPROXY
WORKDIR /src
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY . .
# .dockerignore drops the local build/ so only this stage's output is embedded.
COPY --from=web /app/build/app ./build/app
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/huggingfox ./cmd/huggingfox

FROM alpine:3.23
RUN apk add --no-cache ca-certificates
COPY --from=build /out/huggingfox /usr/local/bin/huggingfox
EXPOSE 8080 2222
ENTRYPOINT ["/usr/local/bin/huggingfox"]
CMD ["--data=/data"]
