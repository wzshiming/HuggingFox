package hub

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"slices"
	"strconv"

	"github.com/gorilla/mux"
	"github.com/matrixhub-ai/hfd/pkg/repository"
)

// handleTree serves GET /api/{type}/{ns}/{repo}/tree/{rev}[/{path}]: the children of path in tree order, or every descendant in pre-order with recursive=true; the revision is one encoded segment and the path is decoded once.
func (h *Handler) handleTree(w http.ResponseWriter, r *http.Request) {
	t, err := target(r)
	if err != nil {
		respond(w, err, http.StatusBadRequest)
		return
	}
	raw, err := url.PathUnescape(mux.Vars(r)["path"])
	if err != nil {
		respond(w, fmt.Errorf("invalid path: %w", err), http.StatusBadRequest)
		return
	}
	dir, ok := cleanRepoPath(raw)
	if !ok {
		respond(w, fmt.Errorf("invalid path %q", raw), http.StatusBadRequest)
		return
	}
	recursive, err := queryFlag(r.URL.Query(), "recursive")
	if err != nil {
		respond(w, err, http.StatusBadRequest)
		return
	}
	expand, err := queryFlag(r.URL.Query(), "expand")
	if err != nil {
		respond(w, err, http.StatusBadRequest)
		return
	}
	repo, ok := h.openRepo(w, r, t)
	if !ok {
		return
	}
	hash, err := repo.ResolveRevision(t.rev)
	if err != nil {
		status, err := revisionError(t.rev, err)
		respond(w, err, status)
		return
	}
	listed := map[string][]*repository.TreeEntry{}
	if dir != "" {
		siblings, err := treeAt(repo, hash, parentDir(dir), listed)
		if err != nil {
			respond(w, fmt.Errorf("failed to read %q at %q: %v", dir, t.rev, err), http.StatusInternalServerError)
			return
		}
		if !slices.ContainsFunc(siblings, func(e *repository.TreeEntry) bool {
			return e.Path() == dir && e.Type() == repository.EntryTypeDirectory
		}) {
			respond(w, fmt.Errorf("directory %q not found at %q", dir, t.rev), http.StatusNotFound)
			return
		}
	}
	out, err := listTree(r.Context(), repo, hash, dir, recursive, expand, listed, []pathInfo{})
	if err != nil {
		respond(w, fmt.Errorf("failed to read %q at %q: %v", t.name, t.rev, err), http.StatusInternalServerError)
		return
	}
	respond(w, out, http.StatusOK)
}

// queryFlag parses one of the HF boolean query parameters (true/1/false/0 and case variants); absent or empty means false.
func queryFlag(q url.Values, name string) (bool, error) {
	v := q.Get(name)
	if v == "" {
		return false, nil
	}
	b, err := strconv.ParseBool(v)
	if err != nil {
		return false, fmt.Errorf("Invalid %s parameter: %s", name, v)
	}
	return b, nil
}

// listTree appends the described entries of dir to out, descending into each directory right after it when recursive.
func listTree(ctx context.Context, repo *repository.Repository, hash, dir string, recursive, expand bool, listed map[string][]*repository.TreeEntry, out []pathInfo) ([]pathInfo, error) {
	entries, err := treeAt(repo, hash, dir, listed)
	if err != nil {
		return nil, err
	}
	for _, e := range entries {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		info, err := describe(ctx, repo, hash, e, expand)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", e.Path(), err)
		}
		out = append(out, info)
		if recursive && e.Type() == repository.EntryTypeDirectory {
			if out, err = listTree(ctx, repo, hash, e.Path(), recursive, expand, listed, out); err != nil {
				return nil, err
			}
		}
	}
	return out, nil
}
