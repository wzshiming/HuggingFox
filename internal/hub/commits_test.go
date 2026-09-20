package hub

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"testing"

	"github.com/matrixhub-ai/hfd/pkg/permission"
	"github.com/matrixhub-ai/hfd/pkg/storage"
)

func commitTitles(items []map[string]any) []string {
	var titles []string
	for _, it := range items {
		titles = append(titles, it["title"].(string))
	}
	return titles
}

func TestCommitsPagesWithTotalCountAndLink(t *testing.T) {
	var checks, opened []string
	h, st := newHub(t, Options{
		Permission: recordChecks(&checks, func(op permission.Operation, name string) (bool, error) { return name != "alice/secret", nil }),
		PreOpen: func(_ context.Context, name string, write bool) error {
			opened = append(opened, fmt.Sprintf("%s %v", name, write))
			return nil
		},
	})
	seed(t, st, "alice/m1", map[string]string{"README.md": "r"}, day1)
	seed(t, st, "alice/m1", map[string]string{"a.txt": "a"}, day2)
	sha3 := seed(t, st, "alice/m1", map[string]string{"b.txt": "b"}, day3)
	seedBranch(t, st, "alice/m1", "feature/x", map[string]string{"f1.txt": "1"}, day1)
	seedBranch(t, st, "alice/m1", "feature/x", map[string]string{"f2.txt": "2"}, day2)
	seed(t, st, "datasets/alice/d1", map[string]string{"README.md": "d"}, day1)
	if _, err := repositoryInit(st, "alice/empty"); err != nil {
		t.Fatal(err)
	}

	var items []map[string]any
	rec := do(t, h, http.MethodGet, "/api/models/alice/m1/commits/main", "")
	decode(t, rec, http.StatusOK, &items)
	if got, want := commitTitles(items), []string{"Add b.txt", "Add a.txt", "Add README.md"}; !slices.Equal(got, want) || rec.Header().Get("X-Total-Count") != "3" || rec.Header().Get("Link") != "" {
		t.Errorf("main: %v total %q link %q", got, rec.Header().Get("X-Total-Count"), rec.Header().Get("Link"))
	}
	first := items[0]
	if got, want := keysOf(first), []string{"authors", "date", "id", "message", "title"}; !slices.Equal(got, want) {
		t.Errorf("commit keys %v", got)
	}
	if first["id"] != sha3 || first["date"] != "2024-03-01T12:00:00.000Z" || first["message"] != "Add b.txt\n\nSeeded by the test.\n" || first["authors"].([]any)[0].(map[string]any)["user"] != "Alice" {
		t.Errorf("commit %v", first)
	}
	if !slices.Contains(checks, "read_repo alice/m1  main") || !slices.Contains(opened, "alice/m1 false") {
		t.Errorf("checks %v opened %v", checks, opened)
	}

	rec = do(t, h, http.MethodGet, "/api/models/alice/m1/commits/main?limit=2", "")
	decode(t, rec, http.StatusOK, &items)
	if len(items) != 2 || rec.Header().Get("X-Total-Count") != "3" {
		t.Fatalf("page 0: %d items total %q", len(items), rec.Header().Get("X-Total-Count"))
	}
	_, u := nextCursor(t, rec.Header().Get("Link"))
	if u.Path != "/api/models/alice/m1/commits/main" || u.Query().Get("p") != "1" || u.Query().Get("limit") != "2" {
		t.Errorf("link %s", u)
	}
	rec = do(t, h, http.MethodGet, u.RequestURI(), "")
	decode(t, rec, http.StatusOK, &items)
	if got := commitTitles(items); !slices.Equal(got, []string{"Add README.md"}) || rec.Header().Get("Link") != "" || rec.Header().Get("X-Total-Count") != "3" {
		t.Errorf("page 1: %v link %q", got, rec.Header().Get("Link"))
	}
	rec = do(t, h, http.MethodGet, "/api/models/alice/m1/commits/main?p=9223372036854775807&limit=50", "")
	decode(t, rec, http.StatusOK, &items)
	if len(items) != 0 || rec.Header().Get("X-Total-Count") != "3" || rec.Header().Get("Link") != "" {
		t.Errorf("huge page: %v", items)
	}

	rec = do(t, h, http.MethodGet, "/api/models/alice/m1/commits/"+url.PathEscape("feature/x")+"?limit=1", "")
	decode(t, rec, http.StatusOK, &items)
	if got := commitTitles(items); !slices.Equal(got, []string{"Add f2.txt"}) || rec.Header().Get("X-Total-Count") != "2" {
		t.Errorf("slash branch: %v total %q", got, rec.Header().Get("X-Total-Count"))
	}
	if _, u = nextCursor(t, rec.Header().Get("Link")); !strings.Contains(u.EscapedPath(), "/commits/feature%2Fx") {
		t.Errorf("slash branch link %s", u.String())
	}

	rec = do(t, h, http.MethodGet, "/api/datasets/alice/d1/commits/main", "")
	decode(t, rec, http.StatusOK, &items)
	if len(items) != 1 || !slices.Contains(opened, "datasets/alice/d1 false") || !slices.Contains(checks, "read_repo datasets/alice/d1  main") {
		t.Errorf("dataset commits %v opened %v", items, opened)
	}
	rec = do(t, h, http.MethodGet, "/api/models/alice/empty/commits/main", "")
	decode(t, rec, http.StatusOK, &items)
	if len(items) != 0 || rec.Header().Get("X-Total-Count") != "0" {
		t.Errorf("empty repo: %v total %q", items, rec.Header().Get("X-Total-Count"))
	}

	for target, want := range map[string]int{
		"/api/models/alice/m1/commits/nope":         http.StatusNotFound,
		"/api/models/alice/empty/commits/other":     http.StatusNotFound,
		"/api/models/alice/missing/commits/main":    http.StatusNotFound,
		"/api/datasets/alice/m1/commits/main":       http.StatusNotFound,
		"/api/models/alice/secret/commits/main":     http.StatusForbidden,
		"/api/models/alice/m1/commits/main?p=-1":    http.StatusBadRequest,
		"/api/models/alice/m1/commits/main?p=x":     http.StatusBadRequest,
		"/api/models/alice/m1/commits/main?limit=0": http.StatusBadRequest,
		"/api/models/alice/m1/commits/main?limit=y": http.StatusBadRequest,
		"/api/models/%2E%2E/m1/commits/main":        http.StatusBadRequest,
		"/api/models/alice/a%2Fb/commits/main":      http.StatusBadRequest,
	} {
		rec := do(t, h, http.MethodGet, target, "")
		if rec.Code != want || !strings.Contains(rec.Body.String(), `"error"`) {
			t.Errorf("%s: %d %s", target, rec.Code, rec.Body)
		}
	}
	if slices.ContainsFunc(opened, func(s string) bool { return strings.HasPrefix(s, "alice/secret") }) {
		t.Errorf("denied repository was opened: %v", opened)
	}
}

func TestRevisionExpressionsResolveOrAreNotFound(t *testing.T) {
	root := t.TempDir()
	st := storage.NewStorage(storage.WithRootDir(root))
	h := New(Options{Storage: st})
	sha1 := seed(t, st, "alice/m1", map[string]string{"README.md": "r"}, day1)
	seed(t, st, "alice/m1", map[string]string{"a.txt": "a"}, day2)
	seedBranch(t, st, "alice/m1", "feature/x", map[string]string{"f.txt": "f"}, day1)
	if _, err := repositoryInit(st, "alice/empty"); err != nil {
		t.Fatal(err)
	}

	var items []map[string]any
	rec := do(t, h, http.MethodGet, "/api/models/alice/m1/commits/"+url.PathEscape("HEAD^"), "")
	decode(t, rec, http.StatusOK, &items)
	if len(items) != 1 || items[0]["id"] != sha1 || rec.Header().Get("X-Total-Count") != "1" {
		t.Errorf("HEAD^: %v total %q", items, rec.Header().Get("X-Total-Count"))
	}
	entries, _ := pathsInfo(t, h, "/api/models/alice/m1/paths-info/"+url.PathEscape("main^"), "application/json", `{"paths":["README.md","a.txt"]}`)
	if len(entries) != 1 || entries[0]["path"] != "README.md" {
		t.Errorf("main^: %v", entries)
	}
	entries, _ = pathsInfo(t, h, "/api/models/alice/m1/paths-info/"+url.PathEscape("refs/heads/feature/x"), "application/json", `{"paths":["f.txt"]}`)
	if len(entries) != 1 {
		t.Errorf("slash ref: %v", entries)
	}
	rec = do(t, h, http.MethodGet, "/api/models/alice/empty/commits/main", "")
	decode(t, rec, http.StatusOK, &items)
	if len(items) != 0 || rec.Header().Get("X-Total-Count") != "0" {
		t.Errorf("unborn: %v total %q", items, rec.Header().Get("X-Total-Count"))
	}

	for _, tc := range []struct{ repo, rev string }{
		{"m1", "^"}, {"m1", "~"}, {"m1", "main..main"}, {"m1", "main...main"}, {"m1", "main~999"}, {"m1", "main^2"}, {"m1", "nope"}, {"m1", "refs/heads/nope"},
		{"empty", "^"}, {"empty", "main"},
	} {
		for _, route := range []struct{ method, target, body string }{
			{http.MethodGet, "/api/models/alice/" + tc.repo + "/commits/" + url.PathEscape(tc.rev), ""},
			{http.MethodPost, "/api/models/alice/" + tc.repo + "/paths-info/" + url.PathEscape(tc.rev), `{"paths":["README.md"]}`},
			{http.MethodPost, "/api/models/alice/" + tc.repo + "/paths-info/" + url.PathEscape(tc.rev), `{"paths":[]}`},
		} {
			if tc.repo == "empty" && tc.rev == "main" && route.method == http.MethodGet {
				continue
			}
			rec := do(t, h, route.method, route.target, route.body, "Content-Type", "application/json")
			if rec.Code != http.StatusNotFound || !strings.Contains(rec.Body.String(), `"error"`) {
				t.Errorf("%s %s %s: %d %s", route.method, route.target, route.body, rec.Code, rec.Body)
			}
		}
	}

	// A parent whose object is gone is a storage failure on both routes, not an unknown revision.
	removeObject(t, st, "alice/m1", sha1)
	for _, route := range []struct{ method, target, body string }{
		{http.MethodGet, "/api/models/alice/m1/commits/main~1", ""},
		{http.MethodPost, "/api/models/alice/m1/paths-info/main~1", `{"paths":[]}`},
	} {
		if rec := do(t, reopen(root), route.method, route.target, route.body, "Content-Type", "application/json"); rec.Code != http.StatusInternalServerError || !strings.Contains(rec.Body.String(), `"error"`) {
			t.Errorf("%s %s: %d %s", route.method, route.target, rec.Code, rec.Body)
		}
	}
}
