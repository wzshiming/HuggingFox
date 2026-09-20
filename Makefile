GO ?= go
PNPM ?= pnpm

.PHONY: build run test

build:
	$(PNPM) build
	$(GO) build -o bin/huggingfox ./cmd/huggingfox

run: build
	./bin/huggingfox

test:
	$(GO) test ./...
	$(PNPM) test
