package hubserver

import (
	"fmt"
	"net"
	"time"
)

// Config mirrors the upstream hfd command flags for local storage.
type Config struct {
	Addr    string
	HostURL string

	SSHAddr        string
	SSHHostKeyFile string

	DataDir string

	Username string
	Password string
	Token    string
	SignKey  string // empty: no signed bearer tokens, per-process xet CAS key

	ProxyToken              string
	PullMirrorURL           string
	PushMirrorURL           string
	ProxyCacheTTL           time.Duration
	ProxyConcurrencyPerFile int
	ProxyCacheSize          int64
}

// Upstream hfd defaults, minus the sign key: its well-known value would let anyone mint tokens.
func DefaultConfig() Config {
	return Config{
		Addr:                    ":8080",
		SSHAddr:                 ":2222",
		DataDir:                 "./data",
		Username:                "admin",
		ProxyCacheTTL:           time.Minute,
		ProxyConcurrencyPerFile: 2,
		ProxyCacheSize:          10 << 30,
	}
}

func (c Config) hostURL() (string, error) {
	if c.HostURL != "" {
		return c.HostURL, nil
	}
	host, port, err := net.SplitHostPort(c.Addr)
	if err != nil {
		return "", fmt.Errorf("invalid listen address %q: %w", c.Addr, err)
	}
	if host == "" {
		host = "localhost"
	}
	return "http://" + net.JoinHostPort(host, port), nil
}
