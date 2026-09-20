package hub

import (
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/matrixhub-ai/hfd/pkg/permission"
)

var quickTypes = map[string]string{"model": "models", "dataset": "datasets", "space": "spaces"}

const (
	defaultQuickLimit = 5
	maxQuickLimit     = 100
)

// orgs and users are always empty: this hub has no accounts to search.
func (h *Handler) handleQuicksearch(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	needle := strings.ToLower(q.Get("q"))
	limit := defaultQuickLimit
	if v := q.Get("limit"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n <= 0 {
			respond(w, fmt.Errorf("Invalid limit parameter: %s", v), http.StatusBadRequest)
			return
		}
		limit = min(n, maxQuickLimit)
	}
	types := []string{"models", "datasets", "spaces"}
	if typ := q.Get("type"); typ != "" && typ != "all" {
		repoType, ok := quickTypes[typ]
		if !ok {
			respond(w, fmt.Errorf("Invalid type parameter: %s", typ), http.StatusBadRequest)
			return
		}
		types = []string{repoType}
	}
	out := map[string]any{"q": q.Get("q"), "orgs": []any{}, "users": []any{}}
	for repoType := range quickTypes {
		out[quickTypes[repoType]], out[quickTypes[repoType]+"Count"] = []map[string]any{}, 0
	}
	fsys := h.opts.Storage.RepositoriesFS()
	for _, repoType := range types {
		if needle == "" {
			break
		}
		err := h.opts.Permission.Check(r.Context(), permission.OperationListRepos, repoType, permission.Context{})
		if errors.Is(err, permission.ErrDenied) {
			continue
		}
		if err != nil {
			respond(w, err, http.StatusInternalServerError)
			return
		}
		refs, err := listRepos(r.Context(), fsys, repoType, "")
		if err != nil {
			respond(w, err, http.StatusInternalServerError)
			return
		}
		hits, count := []map[string]any{}, 0
		for _, ref := range refs {
			if !strings.Contains(strings.ToLower(ref.id), needle) {
				continue
			}
			if count++; len(hits) < limit {
				hits = append(hits, map[string]any{"id": ref.id, "private": false})
			}
		}
		out[repoType], out[repoType+"Count"] = hits, count
	}
	respond(w, out, http.StatusOK)
}
