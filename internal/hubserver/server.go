// Package hubserver assembles the pinned hfd hub (git, LFS, hub API, xet CAS, SSH) with the web UI as the HTTP chain tail.
package hubserver

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/matrixhub-ai/hfd/pkg/authenticate"
	backendssh "github.com/matrixhub-ai/hfd/pkg/backend/ssh"
	"github.com/matrixhub-ai/hfd/pkg/mirror"
	"github.com/matrixhub-ai/hfd/pkg/permission"
	"github.com/matrixhub-ai/hfd/pkg/server"
	pkgssh "github.com/matrixhub-ai/hfd/pkg/ssh"
	"github.com/matrixhub-ai/hfd/pkg/storage"
	xetauth "github.com/wzshiming/xet/auth"
	xetclient "github.com/wzshiming/xet/client"
	xetmirror "github.com/wzshiming/xet/mirror"
	xetstorage "github.com/wzshiming/xet/storage"

	"github.com/wzshiming/HuggingFox/internal/hub"
	"github.com/wzshiming/HuggingFox/internal/webui"
)

// Server is the assembled hub: one HTTP handler chain and an optional SSH git server sharing storage, policy and hooks.
type Server struct {
	cfg           Config
	handler       http.Handler
	ssh           *backendssh.Server
	mirror        *mirror.Mirror
	shutdownGrace time.Duration
}

// New wires local storage under cfg.DataDir and the hfd chain with webFS as its tail; nothing listens until Serve.
func New(ctx context.Context, cfg Config, webFS fs.FS) (*Server, error) {
	hostURL, err := cfg.hostURL()
	if err != nil {
		return nil, err
	}
	cfg.HostURL = hostURL
	dataDir, err := filepath.Abs(cfg.DataDir)
	if err != nil {
		return nil, fmt.Errorf("resolve data directory %q: %w", cfg.DataDir, err)
	}
	cfg.DataDir = dataDir
	chunksDir := filepath.Join(dataDir, "xet", "chunks")
	if err := os.MkdirAll(chunksDir, 0o755); err != nil {
		return nil, fmt.Errorf("create data directory: %w", err)
	}

	st := storage.NewStorage(storage.WithRootDir(dataDir))
	xs, err := xetstorage.NewFileStorage(xetstorage.WithBasePath(filepath.Join(dataDir, "xet", "storage")))
	if err != nil {
		return nil, fmt.Errorf("create xet storage: %w", err)
	}
	xetC, err := newXETClient(cfg, chunksDir)
	if err != nil {
		return nil, fmt.Errorf("create xet client: %w", err)
	}
	engine, err := newXETMirror(cfg, xs, xetC)
	if err != nil {
		return nil, fmt.Errorf("create xet mirror engine: %w", err)
	}
	issuer, err := xetauth.NewIssuer([]byte(cfg.SignKey), time.Hour, nil)
	if err != nil {
		return nil, fmt.Errorf("create xet issuer: %w", err)
	}
	hooks := &server.Hooks{ProxyToken: cfg.ProxyToken, PullTTL: cfg.ProxyCacheTTL}
	m, err := newMirror(ctx, cfg, st, xs, hooks, xetC, engine, issuer.Sign)
	if err != nil {
		return nil, fmt.Errorf("create mirror: %w", err)
	}
	hooks.Mirror = m

	opts := server.Options{
		Storage:        st,
		XETStorage:     xs,
		Mirror:         m,
		Authenticators: newAuthenticators(cfg),
		CASAuthorizer:  issuer,
		Permission:     permission.Logged(permission.All(permission.PullMirrorReadOnly(m), permission.SplitReadWrite(permission.AllowAll(), permission.RequireAuthenticated()))),
		PreOpen:        hooks.PreOpen,
		PreReceive:     hooks.PreReceive,
		PostReceive:    hooks.PostReceive,
		AccessLog:      os.Stderr,
		HostURL:        cfg.HostURL,
		Next:           webui.Handler(webFS),
	}
	opts.Authenticate = hubAPI(opts)
	s := &Server{cfg: cfg, handler: server.NewHTTPHandler(opts), mirror: m, shutdownGrace: 5 * time.Second}
	if cfg.SSHAddr != "" {
		signer, err := hostKey(ctx, cfg)
		if err != nil {
			return nil, fmt.Errorf("prepare SSH server: %w", err)
		}
		s.ssh = server.NewSSHServer(opts, signer)
	}
	return s, nil
}

// Handler returns the HTTP chain: hfd routes first, web UI last.
func (s *Server) Handler() http.Handler {
	return s.handler
}

// hubAPI is hfd's authentication layer with the hub API extensions behind it, so listing, tags, quick search, commits, paths-info and tree listings answer ahead of hfd's backends under the same access log and validators.
func hubAPI(opts server.Options) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return authenticate.NewHandler(
			authenticate.WithNext(hub.New(hub.Options{Storage: opts.Storage, Permission: opts.Permission, PreOpen: opts.PreOpen, Next: next})),
			authenticate.WithBasicAuthValidator(opts.Authenticators.BasicAuth),
			authenticate.WithTokenValidator(opts.Authenticators.Token),
			authenticate.WithTokenSignValidator(opts.Authenticators.TokenSign),
		)
	}
}

// Serve binds both listeners before serving; on ctx cancel or the first listener failure it drains HTTP for shutdownGrace, closes every remaining connection and returns that failure (nil on cancel).
func (s *Server) Serve(ctx context.Context) error {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	var lc net.ListenConfig
	httpLn, err := lc.Listen(ctx, "tcp", s.cfg.Addr)
	if err != nil {
		return fmt.Errorf("listen HTTP %s: %w", s.cfg.Addr, err)
	}
	var sshLn *trackedListener
	if s.ssh != nil {
		ln, err := lc.Listen(ctx, "tcp", s.cfg.SSHAddr)
		if err != nil {
			_ = httpLn.Close()
			return fmt.Errorf("listen SSH %s: %w", s.cfg.SSHAddr, err)
		}
		sshLn = newTrackedListener(ln)
	}

	httpSrv := &http.Server{
		Handler:           s.handler,
		ReadHeaderTimeout: 30 * time.Second,
		BaseContext:       func(net.Listener) context.Context { return ctx },
	}
	errs := make(chan error, 2)
	running := 1
	go func() { errs <- fmt.Errorf("HTTP server: %w", httpSrv.Serve(httpLn)) }()
	attrs := []any{"http", httpLn.Addr().String(), "data", s.cfg.DataDir}
	if sshLn != nil {
		running++
		go func() { errs <- fmt.Errorf("SSH server: %w", s.ssh.Serve(ctx, sshLn)) }()
		attrs = append(attrs, "ssh", sshLn.Addr().String())
	}
	slog.InfoContext(ctx, "Serving", attrs...)

	var failure error
	select {
	case <-ctx.Done():
	case failure = <-errs:
		running--
		cancel()
	}
	shutdownCtx, release := context.WithTimeout(context.Background(), s.shutdownGrace)
	defer release()
	if err := httpSrv.Shutdown(shutdownCtx); err != nil {
		_ = httpSrv.Close()
	}
	if sshLn != nil {
		_ = sshLn.Close()
	}
	for ; running > 0; running-- {
		<-errs
	}
	s.mirror.Wait()
	return failure
}

// trackedListener closes accepted connections with the listener, because the hfd SSH server only closes them once a handshake finishes.
type trackedListener struct {
	net.Listener
	mu     sync.Mutex
	conns  map[*trackedConn]struct{}
	closed bool
}

func newTrackedListener(ln net.Listener) *trackedListener {
	return &trackedListener{Listener: ln, conns: map[*trackedConn]struct{}{}}
}

func (l *trackedListener) Accept() (net.Conn, error) {
	conn, err := l.Listener.Accept()
	if err != nil {
		return nil, err
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.closed {
		_ = conn.Close()
		return nil, net.ErrClosed
	}
	c := &trackedConn{Conn: conn, ln: l}
	l.conns[c] = struct{}{}
	return c, nil
}

func (l *trackedListener) Close() error {
	err := l.Listener.Close()
	l.mu.Lock()
	defer l.mu.Unlock()
	l.closed = true
	for c := range l.conns {
		_ = c.Conn.Close()
	}
	return err
}

type trackedConn struct {
	net.Conn
	ln *trackedListener
}

func (c *trackedConn) Close() error {
	c.ln.mu.Lock()
	delete(c.ln.conns, c)
	c.ln.mu.Unlock()
	return c.Conn.Close()
}

func newAuthenticators(cfg Config) *authenticate.Authenticators {
	auth := &authenticate.Authenticators{}
	if cfg.Password != "" {
		auth.BasicAuth = authenticate.NewSimpleBasicAuthValidator(cfg.Username, cfg.Password)
	}
	if cfg.Token != "" {
		auth.Token = authenticate.NewSimpleTokenValidator(cfg.Username, cfg.Token)
	}
	if cfg.SignKey != "" {
		auth.TokenSign = authenticate.NewTokenSignValidator([]byte(cfg.SignKey))
	}
	return auth
}

func newXETClient(cfg Config, chunksDir string) (*xetclient.Client, error) {
	opts := []xetclient.Options{xetclient.WithCacheDir(chunksDir)}
	if cfg.ProxyConcurrencyPerFile > 0 {
		opts = append(opts, xetclient.WithConcurrency(cfg.ProxyConcurrencyPerFile))
	}
	if cfg.ProxyCacheSize > 0 {
		opts = append(opts, xetclient.WithCacheSize(cfg.ProxyCacheSize))
	}
	return xetclient.NewClient(opts...)
}

// newXETMirror returns nil without a pull mirror; the hfd mirror treats a nil engine as "no upstream".
func newXETMirror(cfg Config, xs xetstorage.Storage, xetC *xetclient.Client) (*xetmirror.Mirror, error) {
	if cfg.PullMirrorURL == "" {
		return nil, nil
	}
	return xetmirror.NewMirror(
		xetmirror.WithStorage(xs),
		xetmirror.WithUpstream(strings.TrimSuffix(cfg.PullMirrorURL, "/")),
		xetmirror.WithUpstreamToken(cfg.ProxyToken),
		xetmirror.WithCacheDir(filepath.Join(cfg.DataDir, "xet", "mirror")),
		xetmirror.WithClient(xetC),
	)
}

func newMirror(ctx context.Context, cfg Config, st *storage.Storage, xs xetstorage.Storage, hooks *server.Hooks, xetC *xetclient.Client, engine *xetmirror.Mirror, mint func(xetauth.Grant) (string, int64, error)) (*mirror.Mirror, error) {
	opts := []mirror.Option{
		mirror.WithXETStorage(xs),
		mirror.WithXETClient(xetC),
		mirror.WithXETMirror(engine),
		mirror.WithMintToken(mint),
		mirror.WithExternalURL(cfg.HostURL),
		mirror.WithDataDir(filepath.Join(cfg.DataDir, "xet")),
		mirror.WithConcurrency(cfg.ProxyConcurrencyPerFile),
		mirror.WithPreReceiveHookFunc(hooks.PreReceive),
		mirror.WithPostReceiveHookFunc(hooks.PostReceive),
		mirror.WithRepositoriesFS(st.RepositoriesFS()),
		mirror.WithGitOutputFunc(hooks.GitOutput),
		mirror.WithSyncUserInfoFunc(hooks.SyncUserInfo),
		mirror.WithMirrorRefFilterFunc(hooks.MirrorRefFilter),
	}
	if base := strings.TrimSuffix(cfg.PullMirrorURL, "/"); base != "" {
		slog.InfoContext(ctx, "Pull mirror enabled")
		opts = append(opts, mirror.WithMirrorSourceFunc(remoteFor(base)))
	}
	if base := strings.TrimSuffix(cfg.PushMirrorURL, "/"); base != "" {
		slog.InfoContext(ctx, "Push mirror enabled")
		opts = append(opts, mirror.WithMirrorDestinationFunc(remoteFor(base)))
	}
	return mirror.NewMirror(opts...)
}

func remoteFor(base string) func(context.Context, string) (string, bool, error) {
	return func(_ context.Context, repoName string) (string, bool, error) {
		return base + "/" + strings.TrimPrefix(repoName, "/"), true, nil
	}
}

// hostKey loads cfg.SSHHostKeyFile, or loads/generates DataDir/ssh_host_rsa_key so restarts keep the same host identity.
func hostKey(ctx context.Context, cfg Config) (pkgssh.Signer, error) {
	path := cfg.SSHHostKeyFile
	if path == "" {
		path = filepath.Join(cfg.DataDir, "ssh_host_rsa_key")
	}
	data, err := os.ReadFile(path)
	if err == nil {
		signer, err := pkgssh.ParseHostKeyFile(data)
		if err != nil {
			return nil, fmt.Errorf("parse SSH host key %q: %w", path, err)
		}
		return signer, nil
	}
	if cfg.SSHHostKeyFile != "" || !errors.Is(err, fs.ErrNotExist) {
		return nil, fmt.Errorf("read SSH host key %q: %w", path, err)
	}
	signer, err := pkgssh.GenerateAndSaveHostKey(path, pkgssh.KeyTypeRSA)
	if err != nil {
		return nil, fmt.Errorf("generate SSH host key %q: %w", path, err)
	}
	slog.InfoContext(ctx, "Generated SSH host key", "path", path)
	return signer, nil
}
