// Package hub answers the Hub API routes the pinned hfd lacks or answers too thinly (repository listing, tag facets, quick search, commit pages, paths-info, tree listings, the commit parent precondition) ahead of its backends.
package hub

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/gorilla/mux"
	"github.com/matrixhub-ai/hfd/pkg/permission"
	"github.com/matrixhub-ai/hfd/pkg/repository"
	"github.com/matrixhub-ai/hfd/pkg/storage"
)

// Options wires the handler; Storage is required, Next answers every request not handled here (nil answers 404).
type Options struct {
	Storage    *storage.Storage
	Permission permission.PermissionHookFunc
	PreOpen    func(ctx context.Context, repoName string, write bool) error
	Next       http.Handler
}

// Handler serves the routes registered in New and hands everything else, method mismatches included, to Options.Next.
type Handler struct {
	opts   Options
	router *mux.Router
	tips   tipCache
}

// New builds the handler; revisions arrive percent-encoded so a slash inside a branch name stays one path segment.
func New(opts Options) *Handler {
	if opts.Storage == nil {
		panic("hub: Options.Storage is required")
	}
	if opts.Next == nil {
		opts.Next = http.NotFoundHandler()
	}
	h := &Handler{opts: opts, router: mux.NewRouter().UseEncodedPath(), tips: tipCache{entries: map[string]tipEntry{}}}
	r := h.router
	r.HandleFunc("/api/{repoType:models|datasets|spaces}", h.handleList).Methods(http.MethodGet)
	r.HandleFunc("/api/{repoType:models|datasets}-tags-by-type", h.handleTagsByType).Methods(http.MethodGet)
	r.HandleFunc("/api/quicksearch", h.handleQuicksearch).Methods(http.MethodGet)
	r.HandleFunc("/api/{repoType:models|datasets|spaces}/{namespace}/{repo}/commits/{rev}", h.handleCommits).Methods(http.MethodGet)
	r.HandleFunc("/api/{repoType:models|datasets|spaces}/{namespace}/{repo}/paths-info/{rev}", h.handlePathsInfo).Methods(http.MethodPost)
	r.HandleFunc("/api/{repoType:models|datasets|spaces}/{namespace}/{repo}/tree/{rev}", h.handleTree).Methods(http.MethodGet)
	r.HandleFunc("/api/{repoType:models|datasets|spaces}/{namespace}/{repo}/tree/{rev}/{path:.*}", h.handleTree).Methods(http.MethodGet)
	r.HandleFunc("/api/{repoType:models|datasets|spaces}/{namespace}/{repo}/commit/{rev}", h.handleCommit).Methods(http.MethodPost)
	r.NotFoundHandler, r.MethodNotAllowedHandler = opts.Next, opts.Next
	return h
}

// ServeHTTP implements http.Handler.
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	h.router.ServeHTTP(w, r)
}

// respond encodes v before writing so an encoding failure becomes a 500 rather than a truncated 200; errors and strings become {"error": ...}.
func respond(w http.ResponseWriter, v any, status int) {
	switch t := v.(type) {
	case error:
		v = map[string]string{"error": t.Error()}
	case string:
		v = map[string]string{"error": t}
	}
	body, err := json.Marshal(v)
	if err != nil {
		body, status = []byte(`{"error":"failed to encode response"}`), http.StatusInternalServerError
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	if status >= http.StatusBadRequest {
		w.Header().Set("X-Content-Type-Options", "nosniff")
	}
	w.WriteHeader(status)
	_, _ = w.Write(body)
}

func (h *Handler) allow(w http.ResponseWriter, r *http.Request, op permission.Operation, name string, c permission.Context) bool {
	return permission.Guard{
		Hook:    h.opts.Permission,
		Respond: func(w http.ResponseWriter, msg string, sc int) { respond(w, msg, sc) },
	}.Allow(w, r, op, name, c)
}

// repoTarget is the repository a route addresses: hub id and hfd storage name (datasets/ and spaces/ prefixed).
type repoTarget struct {
	repoType, id, name, rev string
}

// target decodes the route variables and refuses namespace or repo values that are not one plain path element.
func target(r *http.Request) (repoTarget, error) {
	vars := mux.Vars(r)
	var parts [3]string
	for i, key := range []string{"namespace", "repo", "rev"} {
		v, err := url.PathUnescape(vars[key])
		if err != nil {
			return repoTarget{}, fmt.Errorf("invalid %s: %w", key, err)
		}
		parts[i] = v
	}
	if !validSegment(parts[0]) || !validSegment(parts[1]) {
		return repoTarget{}, errors.New("invalid repository name")
	}
	t := repoTarget{repoType: vars["repoType"], id: parts[0] + "/" + parts[1], rev: parts[2]}
	t.name = t.id
	if t.repoType != "models" {
		t.name = t.repoType + "/" + t.id
	}
	return t, nil
}

func validSegment(s string) bool {
	return s != "" && s != "." && s != ".." && !strings.Contains(s, "/")
}

// openRepo runs the read permission check and the pre-open hook (which may pull a mirror) before opening; failures are written here.
func (h *Handler) openRepo(w http.ResponseWriter, r *http.Request, t repoTarget) (*repository.Repository, bool) {
	if !h.allow(w, r, permission.OperationReadRepo, t.name, permission.Context{Ref: t.rev}) {
		return nil, false
	}
	repoPath := repository.ResolvePath(t.name)
	if repoPath == "" {
		respond(w, fmt.Errorf("repository %q not found", t.name), http.StatusNotFound)
		return nil, false
	}
	if h.opts.PreOpen != nil {
		if err := h.opts.PreOpen(r.Context(), t.name, false); err != nil {
			respondOpenError(w, t.name, err)
			return nil, false
		}
	}
	repo, err := repository.Open(h.opts.Storage.RepositoriesFS(), repoPath)
	if err != nil {
		respondOpenError(w, t.name, err)
		return nil, false
	}
	return repo, true
}

func respondOpenError(w http.ResponseWriter, name string, err error) {
	if errors.Is(err, repository.ErrRepositoryNotExists) {
		respond(w, fmt.Errorf("repository %q not found", name), http.StatusNotFound)
		return
	}
	respond(w, fmt.Errorf("failed to open repository %q: %v", name, err), http.StatusInternalServerError)
}

// revisionError maps a ResolveRevision failure to its response: 404 when go-git cannot parse, find or walk the revision (main~999 runs out of parents as io.EOF), 500 for anything else.
func revisionError(rev string, err error) (int, error) {
	// go-git's invalid-revision error type is internal, so its message prefix is the only handle.
	if errors.Is(err, repository.ErrRevisionNotFound) || errors.Is(err, io.EOF) || strings.HasPrefix(err.Error(), "Revision invalid") {
		return http.StatusNotFound, fmt.Errorf("revision %q not found", rev)
	}
	return http.StatusInternalServerError, fmt.Errorf("failed to resolve revision %q: %v", rev, err)
}

// origin rebuilds the external base URL for Link headers; a forwarded proto counts only when it is a real scheme.
func origin(r *http.Request) string {
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	if p := r.Header.Get("X-Forwarded-Proto"); p == "http" || p == "https" {
		scheme = p
	}
	return scheme + "://" + r.Host
}

// nextLink builds the rel="next" Link value for the same route with the query adjusted by set.
func nextLink(r *http.Request, set func(q url.Values)) string {
	q := r.URL.Query()
	set(q)
	return "<" + origin(r) + r.URL.EscapedPath() + "?" + q.Encode() + `>; rel="next"`
}
