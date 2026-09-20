// Command huggingfox serves the hfd hub and the embedded web UI from one binary.
package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/wzshiming/HuggingFox"
	"github.com/wzshiming/HuggingFox/internal/hubserver"
)

func main() {
	cfg, err := parseFlags(os.Args[1:])
	if err != nil {
		if err != flag.ErrHelp {
			fmt.Fprintln(os.Stderr, err)
		}
		os.Exit(2)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	srv, err := hubserver.New(ctx, cfg, huggingfox.WebFS())
	if err != nil {
		slog.ErrorContext(ctx, "huggingfox: invalid configuration", "error", err)
		os.Exit(1)
	}
	if err := srv.Serve(ctx); err != nil {
		slog.ErrorContext(ctx, "huggingfox exited", "error", err)
		os.Exit(1)
	}
}

func parseFlags(args []string) (hubserver.Config, error) {
	cfg := hubserver.DefaultConfig()
	fs := flag.NewFlagSet("huggingfox", flag.ContinueOnError)
	fs.StringVar(&cfg.Addr, "addr", cfg.Addr, "HTTP listen address")
	fs.StringVar(&cfg.HostURL, "host-url", cfg.HostURL, "External URL of the server; inferred from -addr when empty")
	fs.StringVar(&cfg.SSHAddr, "ssh-addr", cfg.SSHAddr, "SSH git server listen address; empty disables SSH")
	fs.StringVar(&cfg.SSHHostKeyFile, "ssh-host-key", cfg.SSHHostKeyFile, "PEM SSH host key; when empty a key is generated under -data")
	fs.StringVar(&cfg.DataDir, "data", cfg.DataDir, "Directory holding repositories and LFS content")
	fs.StringVar(&cfg.Username, "username", cfg.Username, "Username for basic auth, the static token and SSH password auth")
	fs.StringVar(&cfg.Password, "password", cfg.Password, "Password for basic auth and SSH password auth")
	fs.StringVar(&cfg.Token, "token", cfg.Token, "Static bearer token")
	fs.StringVar(&cfg.SignKey, "sign-key", cfg.SignKey, "Key signing per-request tokens and xet CAS grants")
	fs.StringVar(&cfg.PullMirrorURL, "pull-mirror", cfg.PullMirrorURL, "Pull mirror source base URL (e.g. https://huggingface.co)")
	fs.StringVar(&cfg.PushMirrorURL, "push-mirror", cfg.PushMirrorURL, "Push mirror destination base URL")
	fs.StringVar(&cfg.ProxyToken, "proxy-token", cfg.ProxyToken, "Token for the pull mirror source")
	fs.DurationVar(&cfg.ProxyCacheTTL, "proxy-cache-ttl", cfg.ProxyCacheTTL, "How long a pulled repository is trusted before re-syncing")
	fs.IntVar(&cfg.ProxyConcurrencyPerFile, "proxy-concurrency-per-file", cfg.ProxyConcurrencyPerFile, "Concurrent chunk fetches per mirrored file")
	fs.Int64Var(&cfg.ProxyCacheSize, "proxy-cache-size", cfg.ProxyCacheSize, "Maximum bytes of the xet chunk cache")
	if err := fs.Parse(args); err != nil {
		return cfg, err
	}
	return cfg, nil
}
