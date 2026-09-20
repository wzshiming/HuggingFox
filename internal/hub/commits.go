package hub

import (
	"fmt"
	"net/http"
	"net/url"
	"strconv"
)

const (
	defaultCommitsLimit = 50
	maxCommitsLimit     = 1000
)

type commitAuthor struct {
	User string `json:"user"`
}

type commitInfo struct {
	ID      string         `json:"id"`
	Title   string         `json:"title"`
	Message string         `json:"message"`
	Authors []commitAuthor `json:"authors"`
	Date    string         `json:"date"`
}

// One history walk yields both X-Total-Count and page p.
func (h *Handler) handleCommits(w http.ResponseWriter, r *http.Request) {
	t, err := target(r)
	if err != nil {
		respond(w, err, http.StatusBadRequest)
		return
	}
	q := r.URL.Query()
	limit, page := defaultCommitsLimit, 0
	if v := q.Get("limit"); v != "" {
		if limit, err = strconv.Atoi(v); err != nil || limit <= 0 {
			respond(w, fmt.Errorf("Invalid limit parameter: %s", v), http.StatusBadRequest)
			return
		}
		limit = min(limit, maxCommitsLimit)
	}
	if v := q.Get("p"); v != "" {
		if page, err = strconv.Atoi(v); err != nil || page < 0 {
			respond(w, fmt.Errorf("Invalid page parameter: %s", v), http.StatusBadRequest)
			return
		}
	}
	repo, ok := h.openRepo(w, r, t)
	if !ok {
		return
	}
	hash, err := repo.ResolveRevision(t.rev)
	if err != nil {
		status, rerr := revisionError(t.rev, err)
		if refs, err := repo.Refs(); status == http.StatusNotFound && err == nil && len(refs) == 0 && t.rev == repo.DefaultBranch() {
			// An unborn default branch has no commits rather than no revision.
			w.Header().Set("X-Total-Count", "0")
			respond(w, []commitInfo{}, http.StatusOK)
			return
		}
		respond(w, rerr, status)
		return
	}
	all, err := repo.Commits(hash, nil)
	if err != nil {
		respond(w, fmt.Errorf("failed to list commits for %q: %v", t.rev, err), http.StatusInternalServerError)
		return
	}
	total := len(all)
	// Comparing against total/limit keeps page*limit from overflowing on a huge p.
	start := total
	if page <= total/limit {
		start = page * limit
	}
	end := min(start+limit, total)
	w.Header().Set("X-Total-Count", strconv.Itoa(total))
	if end < total {
		w.Header().Set("Link", nextLink(r, func(q url.Values) {
			q.Set("p", strconv.Itoa(page+1))
			q.Set("limit", strconv.Itoa(limit))
		}))
	}
	items := make([]commitInfo, 0, end-start)
	for i := start; i < end; i++ {
		c := &all[i]
		items = append(items, commitInfo{
			ID:      c.Hash().String(),
			Title:   c.Title(),
			Message: c.Message(),
			Authors: []commitAuthor{{User: c.Author().Name()}},
			Date:    hubTime(c.Author().When()),
		})
	}
	respond(w, items, http.StatusOK)
}
