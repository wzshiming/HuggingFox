package hub

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"testing"

	"github.com/matrixhub-ai/hfd/pkg/permission"
)

const lfsPointer = "version https://git-lfs.github.com/spec/v1\noid sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855\nsize 12345\n"

func pathsInfo(t *testing.T, h http.Handler, target, contentType, body string) ([]map[string]any, *http.Response) {
	t.Helper()
	rec := do(t, h, http.MethodPost, target, body, "Content-Type", contentType)
	var entries []map[string]any
	decode(t, rec, http.StatusOK, &entries)
	return entries, rec.Result()
}

func byPath(entries []map[string]any) map[string]map[string]any {
	out := map[string]map[string]any{}
	for _, e := range entries {
		out[e["path"].(string)] = e
	}
	return out
}

func TestPathsInfoEntriesAndForms(t *testing.T) {
	var checks, opened []string
	h, st := newHub(t, Options{
		Permission: recordChecks(&checks, func(op permission.Operation, name string) (bool, error) { return name != "alice/secret", nil }),
		PreOpen:    func(_ context.Context, name string, write bool) error { opened = append(opened, name); return nil },
	})
	sha1 := seed(t, st, "alice/m1", map[string]string{"README.md": "r"}, day1)
	sha2 := seed(t, st, "alice/m1", map[string]string{"sub/a.txt": "aa"}, day2)
	sha3 := seed(t, st, "alice/m1", map[string]string{"model.bin": lfsPointer}, day3)
	seedBranch(t, st, "alice/m1", "feature/x", map[string]string{"f.txt": "f"}, day1)
	seed(t, st, "datasets/alice/d1", map[string]string{"data.csv": "1,2"}, day1)

	body := `{"paths":["README.md","sub","sub/a.txt","model.bin","missing.txt","sub/none","README.md/x","sub/./a.txt"],"expand":true}`
	entries, _ := pathsInfo(t, h, "/api/models/alice/m1/paths-info/main", "application/json", body)
	var paths []string
	for _, e := range entries {
		paths = append(paths, e["path"].(string))
	}
	if want := []string{"README.md", "sub", "sub/a.txt", "model.bin"}; !slices.Equal(paths, want) {
		t.Fatalf("paths %v, want %v", paths, want)
	}
	got := byPath(entries)
	readme := got["README.md"]
	if readme["type"] != "file" || readme["size"] != float64(1) || len(readme["oid"].(string)) != 40 || readme["lfs"] != nil {
		t.Errorf("README %v", readme)
	}
	if lc := readme["lastCommit"].(map[string]any); lc["id"] != sha1 || lc["title"] != "Add README.md" || lc["date"] != "2024-01-01T12:00:00.000Z" {
		t.Errorf("README lastCommit %v", lc)
	}
	sub := got["sub"]
	if sub["type"] != "directory" || len(sub["oid"].(string)) != 40 || sub["oid"] == readme["oid"] || sub["lastCommit"].(map[string]any)["id"] != sha2 {
		t.Errorf("sub %v", sub)
	}
	if a := got["sub/a.txt"]; a["type"] != "file" || a["size"] != float64(2) || a["lastCommit"].(map[string]any)["id"] != sha2 {
		t.Errorf("sub/a.txt %v", a)
	}
	bin := got["model.bin"]
	lfs, _ := bin["lfs"].(map[string]any)
	if bin["size"] != float64(12345) || lfs == nil || lfs["oid"] != "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" || lfs["size"] != float64(12345) || lfs["pointerSize"] != float64(len(lfsPointer)) || bin["lastCommit"].(map[string]any)["id"] != sha3 {
		t.Errorf("model.bin %v", bin)
	}
	if !slices.Contains(checks, "read_repo alice/m1  main") || !slices.Contains(opened, "alice/m1") {
		t.Errorf("checks %v opened %v", checks, opened)
	}

	entries, _ = pathsInfo(t, h, "/api/models/alice/m1/paths-info/main", "application/json", `{"paths":["README.md"]}`)
	if len(entries) != 1 || entries[0]["lastCommit"] != nil {
		t.Errorf("without expand %v", entries)
	}
	entries, _ = pathsInfo(t, h, "/api/models/alice/m1/paths-info/main", "application/json", `{"paths":["README.md"]}`+"\n")
	if len(entries) != 1 {
		t.Errorf("trailing newline %v", entries)
	}
	entries, _ = pathsInfo(t, h, "/api/models/alice/m1/paths-info/main", "application/json", `{"paths":[]}`)
	if len(entries) != 0 {
		t.Errorf("no paths %v", entries)
	}

	form := url.Values{"paths": {"README.md", "sub/a.txt"}, "expand": {"True"}}.Encode()
	entries, _ = pathsInfo(t, h, "/api/models/alice/m1/paths-info/main", "application/x-www-form-urlencoded", form)
	if len(entries) != 2 || entries[1]["path"] != "sub/a.txt" || entries[0]["lastCommit"] == nil {
		t.Errorf("form %v", entries)
	}
	entries, _ = pathsInfo(t, h, "/api/models/alice/m1/paths-info/"+url.PathEscape("feature/x"), "application/json", `{"paths":["f.txt","README.md"]}`)
	if len(entries) != 1 || entries[0]["path"] != "f.txt" {
		t.Errorf("slash rev %v", entries)
	}
	entries, _ = pathsInfo(t, h, "/api/datasets/alice/d1/paths-info/main", "application/json", `{"paths":["data.csv"]}`)
	if len(entries) != 1 || !slices.Contains(opened, "datasets/alice/d1") {
		t.Errorf("dataset %v opened %v", entries, opened)
	}

	for _, tc := range []struct {
		target, contentType, body string
		status                    int
	}{
		{"/api/models/alice/m1/paths-info/nope", "application/json", `{"paths":["README.md"]}`, http.StatusNotFound},
		{"/api/models/alice/missing/paths-info/main", "application/json", `{"paths":["README.md"]}`, http.StatusNotFound},
		{"/api/models/alice/secret/paths-info/main", "application/json", `{"paths":["README.md"]}`, http.StatusForbidden},
		{"/api/models/alice/m1/paths-info/main", "application/json", `{"paths":`, http.StatusBadRequest},
		{"/api/models/alice/m1/paths-info/main", "application/json", `{"paths":["../x"]}`, http.StatusBadRequest},
		{"/api/models/alice/m1/paths-info/main", "application/json", `{"paths":["sub/../../x"]}`, http.StatusBadRequest},
		{"/api/models/alice/m1/paths-info/main", "application/json", `{"paths":["/README.md"]}`, http.StatusBadRequest},
		{"/api/models/alice/m1/paths-info/main", "application/json", `{"paths":[""]}`, http.StatusBadRequest},
		{"/api/models/alice/m1/paths-info/main", "application/json", `{"paths":["."]}`, http.StatusBadRequest},
		{"/api/models/alice/m1/paths-info/main", "application/json", `{"paths":` + string(mustJSON(slices.Repeat([]string{"x"}, 1001))) + `}`, http.StatusBadRequest},
		{"/api/models/alice/m1/paths-info/main", "application/json", `{"paths":["` + strings.Repeat("a", 2<<20) + `"]}`, http.StatusBadRequest},
		{"/api/models/alice/m1/paths-info/main", "application/json", `{"paths":["README.md"]} garbage`, http.StatusBadRequest},
		{"/api/models/alice/m1/paths-info/main", "application/json", `{"paths":["README.md"]}{"paths":["sub"]}`, http.StatusBadRequest},
		{"/api/models/alice/m1/paths-info/main", "application/json", `{"paths":["README.md"]}` + strings.Repeat(" ", 1<<20), http.StatusBadRequest},
		{"/api/models/%2E%2E/m1/paths-info/main", "application/json", `{"paths":["README.md"]}`, http.StatusBadRequest},
	} {
		rec := do(t, h, http.MethodPost, tc.target, tc.body, "Content-Type", tc.contentType)
		if rec.Code != tc.status || !strings.Contains(rec.Body.String(), `"error"`) {
			t.Errorf("%s %s: %d %s", tc.target, tc.body[:min(len(tc.body), 40)], rec.Code, rec.Body.String()[:min(rec.Body.Len(), 120)])
		}
	}
	if slices.Contains(opened, "alice/secret") {
		t.Errorf("denied repository was opened: %v", opened)
	}
}

func TestPathsInfoDirectoryLastCommitFollowsTreeChanges(t *testing.T) {
	h, st := newHub(t, Options{})
	sha1 := seed(t, st, "alice/m1", map[string]string{"README.md": "r"}, day1)
	sha2 := seed(t, st, "alice/m1", map[string]string{"sub/keep": "k", "sub/drop": "d", "other/f": "f"}, day2)
	// The deletion is the newest commit yet carries an older author date than the addition.
	sha3 := commitDelete(t, st, "alice/m1", "sub/drop", day1)

	entries, _ := pathsInfo(t, h, "/api/models/alice/m1/paths-info/main", "application/json", `{"paths":["sub","other","README.md","sub/keep","sub/drop"],"expand":true}`)
	got := byPath(entries)
	if len(got) != 4 || got["sub/drop"] != nil {
		t.Fatalf("entries %v", entries)
	}
	for p, want := range map[string]string{"sub": sha3, "other": sha2, "README.md": sha1, "sub/keep": sha2} {
		if lc := got[p]["lastCommit"].(map[string]any); lc["id"] != want {
			t.Errorf("%s lastCommit %v, want %s", p, lc, want)
		}
	}
	if lc := got["sub"]["lastCommit"].(map[string]any); lc["title"] != "Delete sub/drop" || lc["date"] != "2024-01-01T12:00:00.000Z" {
		t.Errorf("sub lastCommit %v", lc)
	}
}

func mustJSON(v any) []byte {
	b, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	return b
}
