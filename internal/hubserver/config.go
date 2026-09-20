package hubserver

import (
	"fmt"
	"net"
	"time"
)

// Config mirrors the upstream hfd command flags for local storage; the zero value disables SSH and every mirror.
type Config struct {
	Addr    string // HTTP listen address
	HostURL string // external base URL; inferred from Addr when empty

	SSHAddr        string // SSH listen address; empty disables the SSH server
	SSHHostKeyFile string // PEM host key; empty stores a generated key under DataDir

	DataDir string

	Username string
	Password string // enables HTTP basic auth and SSH password auth
	Token    string // enables the static bearer token
	SignKey  string // signs per-request tokens and xet CAS grants; empty disables signed bearer tokens and uses a per-process CAS key

	ProxyToken              string
	PullMirrorURL           string
	PushMirrorURL           string
	ProxyCacheTTL           time.Duration
	ProxyConcurrencyPerFile int
	ProxyCacheSize          int64
}

// DefaultConfig returns the upstream hfd defaults except the sign key, whose well-known upstream value would let anyone mint accepted bearer tokens.
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
