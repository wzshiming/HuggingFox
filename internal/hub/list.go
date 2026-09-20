package hub

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"

	"github.com/gorilla/mux"
	"github.com/matrixhub-ai/hfd/pkg/permission"
	"github.com/matrixhub-ai/hfd/pkg/repository"
)

// listFields holds per repository type the Hub's default projection, what full=true adds, and every expand[] option the Hub accepts; accepted options this hub cannot fill are omitted.
var listFields = map[string]struct{ base, full, expand []string }{
	"models": {
		base:   []string{"modelId", "private", "downloads", "likes", "tags", "pipeline_tag", "library_name", "createdAt"},
		full:   []string{"author", "sha", "lastModified", "siblings", "gated"},
		expand: []string{"author", "baseModels", "cardData", "childrenModelCount", "config", "createdAt", "disabled", "downloads", "downloadsAllTime", "evalResults", "gated", "gguf", "inference", "inferenceProviderMapping", "lastModified", "library_name", "likes", "mask_token", "model-index", "pipeline_tag", "private", "resourceGroup", "safetensors", "sha", "siblings", "spaces", "tags", "transformersInfo", "trendingScore", "usedStorage", "widgetData", "xetEnabled"},
	},
	"datasets": {
		base:   []string{"author", "private", "downloads", "likes", "tags", "createdAt", "lastModified", "sha", "gated", "disabled", "description", "paperswithcode_id"},
		full:   []string{"cardData"},
		expand: []string{"author", "cardData", "citation", "createdAt", "description", "disabled", "downloads", "downloadsAllTime", "gated", "lastModified", "likes", "mainSize", "paperswithcode_id", "private", "resourceGroup", "sha", "siblings", "tags", "trendingScore", "usedStorage", "xetEnabled"},
	},
	"spaces": {
		base:   []string{"private", "likes", "tags", "createdAt", "sdk"},
		full:   []string{"author", "sha", "lastModified", "siblings", "cardData"},
		expand: []string{"author", "cardData", "createdAt", "datasets", "disabled", "lastModified", "likes", "models", "private", "region", "resourceGroup", "runtime", "sdk", "sha", "siblings", "subdomain", "tags", "trendingScore", "usedStorage", "xetEnabled"},
	},
}

// metaFields are the projection keys that need the README/config metadata.
var metaFields = []string{"tags", "pipeline_tag", "library_name", "sdk", "description", "paperswithcode_id", "cardData", "datasets", "models"}

// listQuery is the parsed GET /api/{type} query.
type listQuery struct {
	repoType, author, search string
	filters, pipelines       []string
	fields                   map[string]bool
	sort                     string
	asc                      bool
	limit, offset            int
}

// The Hub pages at most this many repositories; the default applies without a limit parameter.
const maxListLimit = 1000

func parseListQuery(r *http.Request) (listQuery, error) {
	q := r.URL.Query()
	lq := listQuery{
		repoType:  mux.Vars(r)["repoType"],
		author:    q.Get("author"),
		search:    strings.ToLower(q.Get("search")),
		filters:   q["filter"],
		pipelines: q["pipeline_tag"],
		fields:    map[string]bool{},
		limit:     maxListLimit,
	}
	spec := listFields[lq.repoType]
	expand := append(q["expand[]"], q["expand"]...)
	full, _ := strconv.ParseBool(q.Get("full"))
	switch {
	case len(expand) > 0:
		for _, name := range expand {
			if !slices.Contains(spec.expand, name) {
				return lq, fmt.Errorf("Invalid option: expected one of %s", `"`+strings.Join(spec.expand, `"|"`)+`"`)
			}
			lq.fields[name] = true
		}
	case full:
		for _, name := range spec.full {
			lq.fields[name] = true
		}
		fallthrough
	default:
		for _, name := range spec.base {
			lq.fields[name] = true
		}
	}
	switch lq.sort = q.Get("sort"); lq.sort {
	case "", "likes", "downloads", "trendingScore", "trending_score", "createdAt", "lastModified":
	default:
		return lq, fmt.Errorf("Invalid sort parameter: %s", lq.sort)
	}
	switch d := q.Get("direction"); d {
	case "", "-1":
	case "1":
		lq.asc = true
	default:
		return lq, fmt.Errorf("Invalid direction parameter: %s", d)
	}
	if v := q.Get("limit"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n <= 0 {
			return lq, fmt.Errorf("Invalid limit parameter: %s", v)
		}
		lq.limit = min(n, maxListLimit)
	}
	if c := q.Get("cursor"); c != "" {
		var err error
		if lq.offset, err = decodeCursor(c); err != nil {
			return lq, err
		}
	}
	return lq, nil
}

func (lq listQuery) wants(names ...string) bool {
	return slices.ContainsFunc(names, func(name string) bool { return lq.fields[name] })
}

func (lq listQuery) sortsByDate() bool {
	return lq.sort == "createdAt" || lq.sort == "lastModified"
}

type cursor struct {
	Offset int `json:"offset"`
}

func encodeCursor(offset int) string {
	data, _ := json.Marshal(cursor{Offset: offset})
	return base64.RawURLEncoding.EncodeToString(data)
}

func decodeCursor(s string) (int, error) {
	data, err := base64.RawURLEncoding.DecodeString(strings.TrimRight(s, "="))
	var c cursor
	if err == nil {
		err = json.Unmarshal(data, &c)
	}
	if err != nil || c.Offset < 0 {
		return 0, errors.New("Invalid cursor")
	}
	return c.Offset, nil
}

// handleList serves GET /api/{models|datasets|spaces}.
func (h *Handler) handleList(w http.ResponseWriter, r *http.Request) {
	lq, err := parseListQuery(r)
	if err != nil {
		respond(w, err, http.StatusBadRequest)
		return
	}
	if !h.allow(w, r, permission.OperationListRepos, lq.repoType, permission.Context{Author: lq.author}) {
		return
	}
	fsys := h.opts.Storage.RepositoriesFS()
	refs, err := listRepos(r.Context(), fsys, lq.repoType, lq.author)
	if err != nil {
		respond(w, err, http.StatusInternalServerError)
		return
	}
	// Filters and date sorts need every repository loaded; the projection only needs the page.
	filtering := len(lq.filters)+len(lq.pipelines) > 0
	var items []*listItem
	for _, ref := range refs {
		if lq.search != "" && !strings.Contains(strings.ToLower(ref.id), lq.search) {
			continue
		}
		it := &listItem{ref: ref}
		if it.repo, err = repository.Open(fsys, ref.path); err != nil {
			// Only a repository removed since enumeration is skipped; any other failure is a storage error.
			if errors.Is(err, repository.ErrRepositoryNotExists) {
				continue
			}
			respond(w, fmt.Errorf("failed to open repository %q: %v", ref.id, err), http.StatusInternalServerError)
			return
		}
		it.rev = it.repo.DefaultBranch()
		h.fill(it, lq.repoType, filtering, lq.sortsByDate(), lq.sort == "createdAt")
		if !matchesAll(it.meta.tags, lq.filters) || (len(lq.pipelines) > 0 && !slices.Contains(lq.pipelines, it.meta.pipelineTag)) {
			continue
		}
		items = append(items, it)
	}
	sortItems(items, lq.sort, lq.asc)
	if lq.offset >= len(items) {
		items = nil
	} else {
		items = items[lq.offset:]
	}
	if len(items) > lq.limit {
		items = items[:lq.limit]
		w.Header().Set("Link", nextLink(r, func(q url.Values) { q.Set("cursor", encodeCursor(lq.offset+lq.limit)) }))
	}
	out := make([]map[string]any, 0, len(items))
	for _, it := range items {
		h.fill(it, lq.repoType, lq.wants(metaFields...), lq.wants("sha", "lastModified", "createdAt"), lq.wants("createdAt"))
		out = append(out, it.project(lq.fields))
	}
	respond(w, out, http.StatusOK)
}

// fill loads the metadata and dates a later step needs, each at most once per item.
func (h *Handler) fill(it *listItem, repoType string, meta, tip, created bool) {
	if meta && !it.hasMeta {
		it.meta, it.hasMeta = readMeta(it.repo, it.rev, repoType), true
	}
	if (tip && !it.hasTip) || (created && !it.hasCreated) {
		it.dates = h.tips.dates(it.repo, it.ref.path, it.rev, created)
		it.hasTip, it.hasCreated = true, it.hasCreated || created
	}
}

// sortItems orders by key (dates; likes, downloads and trendingScore are all zero here), descending unless asc, ties by id.
func sortItems(items []*listItem, key string, asc bool) {
	slices.SortStableFunc(items, func(a, b *listItem) int {
		var c int
		switch key {
		case "createdAt":
			c = a.dates.createdAt.Compare(b.dates.createdAt)
		case "lastModified":
			c = a.dates.lastModified.Compare(b.dates.lastModified)
		}
		if !asc {
			c = -c
		}
		if c == 0 {
			c = strings.Compare(a.ref.id, b.ref.id)
		}
		return c
	})
}

// matchesAll reports whether every filter tag is present.
func matchesAll(tags, filters []string) bool {
	for _, f := range filters {
		if !slices.Contains(tags, f) {
			return false
		}
	}
	return true
}

// listItem is one enumerated repository with everything a projection may pick from.
type listItem struct {
	ref                         repoRef
	repo                        *repository.Repository
	rev                         string
	meta                        repoMeta
	dates                       repoDates
	hasMeta, hasTip, hasCreated bool
}

// project emits id, trendingScore and the requested fields this hub can fill; absent values are omitted, requested zero values stay.
func (it *listItem) project(fields map[string]bool) map[string]any {
	out := map[string]any{"id": it.ref.id, "trendingScore": 0}
	set := func(name string, v any) {
		if fields[name] {
			out[name] = v
		}
	}
	setText := func(name, v string) {
		if v != "" {
			set(name, v)
		}
	}
	author, _, _ := strings.Cut(it.ref.id, "/")
	set("modelId", it.ref.id)
	set("author", author)
	for _, name := range []string{"private", "gated", "disabled"} {
		set(name, false)
	}
	for _, name := range []string{"downloads", "likes"} {
		set(name, 0)
	}
	if fields["tags"] {
		out["tags"] = append([]string{}, it.meta.tags...)
	}
	setText("pipeline_tag", it.meta.pipelineTag)
	setText("library_name", it.meta.libraryName)
	setText("sdk", it.meta.sdk)
	setText("description", it.meta.description)
	if c := it.meta.card; c != nil {
		setText("paperswithcode_id", c.PapersWithCodeID)
		if len(c.Datasets) > 0 {
			set("datasets", c.Datasets)
		}
		if len(c.Models) > 0 {
			set("models", c.Models)
		}
	}
	if it.dates.sha != "" {
		set("sha", it.dates.sha)
		set("lastModified", hubTime(it.dates.lastModified))
		if !it.dates.createdAt.IsZero() {
			set("createdAt", hubTime(it.dates.createdAt))
		}
	}
	if fields["cardData"] && it.meta.cardData != nil {
		// A card the Hub cannot serialize (NaN, for one) is dropped from this item alone.
		if raw, err := it.meta.cardData.MarshalJSON(); err == nil {
			out["cardData"] = json.RawMessage(raw)
		}
	}
	if fields["siblings"] {
		out["siblings"] = siblings(it.repo, it.rev)
	}
	return out
}
