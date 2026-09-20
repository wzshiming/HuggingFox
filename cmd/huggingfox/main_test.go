package main

import (
	"testing"
	"time"

	"github.com/wzshiming/HuggingFox/internal/hubserver"
)

func TestParseFlagsDefaultsMatchDefaultConfig(t *testing.T) {
	cfg, err := parseFlags(nil)
	if err != nil {
		t.Fatal(err)
	}
	if cfg != hubserver.DefaultConfig() {
		t.Errorf("defaults drifted: %+v", cfg)
	}
}

func TestParseFlagsOverrides(t *testing.T) {
	cfg, err := parseFlags([]string{
		"-addr", "[::1]:9000", "-ssh-addr", "", "-data", "/tmp/hfx", "-username", "bob", "-password", "pw", "-token", "tk",
		"-sign-key", "sk", "-host-url", "https://hub.example", "-ssh-host-key", "/tmp/key", "-pull-mirror", "https://huggingface.co/",
		"-push-mirror", "https://push.example", "-proxy-token", "pt", "-proxy-cache-ttl", "90s", "-proxy-concurrency-per-file", "4", "-proxy-cache-size", "1024",
	})
	if err != nil {
		t.Fatal(err)
	}
	want := hubserver.Config{
		Addr: "[::1]:9000", SSHAddr: "", DataDir: "/tmp/hfx", Username: "bob", Password: "pw", Token: "tk", SignKey: "sk",
		HostURL: "https://hub.example", SSHHostKeyFile: "/tmp/key", PullMirrorURL: "https://huggingface.co/", PushMirrorURL: "https://push.example",
		ProxyToken: "pt", ProxyCacheTTL: 90 * time.Second, ProxyConcurrencyPerFile: 4, ProxyCacheSize: 1024,
	}
	if cfg != want {
		t.Errorf("got %+v\nwant %+v", cfg, want)
	}
}

func TestParseFlagsRejectsUnknown(t *testing.T) {
	if _, err := parseFlags([]string{"-s3-bucket", "x"}); err == nil {
		t.Error("unknown flag accepted")
	}
}
