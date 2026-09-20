package hub

import (
	"context"
	"errors"
	"net/http"
	"slices"
	"strings"
	"testing"

	"github.com/go-git/go-billy/v6/helper/chroot"
	"github.com/go-git/go-git/v6"
	"github.com/go-git/go-git/v6/plumbing"
	"github.com/go-git/go-git/v6/plumbing/cache"
	"github.com/go-git/go-git/v6/storage/filesystem"
	"github.com/matrixhub-ai/hfd/pkg/permission"
	"github.com/matrixhub-ai/hfd/pkg/repository"
	"github.com/matrixhub-ai/hfd/pkg/storage"
)

func pathsOf(entries []map[string]any) []string {
	var paths []string
	for _, e := range entries {
		paths = append(paths, e["path"].(string))
	}
	return paths
}

func TestTreeListsChildrenInTreeOrder(t *testing.T) {
	h, st := newHub(t, Options{})
	seed(t, st, "alice/m1", map[string]string{"README.md": "r", "docs/a.txt": "aa", "docs/guide/intro.txt": "intro", "model.bin": lfsPointer}, day1)
	seed(t, st, "alice/empty", map[string]string{"README.md": "r"}, day1)
	commitDelete(t, st, "alice/empty", "README.md", day2)

	for target, want := range map[string][]string{
		"/api/models/alice/m1/tree/main":            {"README.md", "docs", "model.bin"},
		"/api/models/alice/m1/tree/main/":           {"README.md", "docs", "model.bin"},
		"/api/models/alice/m1/tree/main/docs":       {"docs/a.txt", "docs/guide"},
		"/api/models/alice/m1/tree/main/docs/":      {"docs/a.txt", "docs/guide"},
		"/api/models/alice/m1/tree/main/docs/guide": {"docs/guide/intro.txt"},
	} {
		if got := pathsOf(listItems(t, h, target)); !slices.Equal(got, want) {
			t.Errorf("%s: paths %v, want %v", target, got, want)
		}
	}
	got := byPath(listItems(t, h, "/api/models/alice/m1/tree/main"))
	readme := got["README.md"]
	if readme["type"] != "file" || readme["size"] != float64(1) || len(readme["oid"].(string)) != 40 || readme["lfs"] != nil || readme["lastCommit"] != nil {
		t.Errorf("README %v", readme)
	}
	if docs := got["docs"]; docs["type"] != "directory" || docs["size"] != float64(0) || len(docs["oid"].(string)) != 40 || docs["oid"] == readme["oid"] || docs["lfs"] != nil {
		t.Errorf("docs %v", docs)
	}
	bin := got["model.bin"]
	if lfs, _ := bin["lfs"].(map[string]any); bin["size"] != float64(12345) || lfs == nil || lfs["oid"] != "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" || lfs["size"] != float64(12345) || lfs["pointerSize"] != float64(len(lfsPointer)) {
		t.Errorf("model.bin %v", bin)
	}
	if rec := do(t, h, http.MethodGet, "/api/models/alice/empty/tree/main", ""); rec.Code != http.StatusOK || strings.TrimSpace(rec.Body.String()) != "[]" {
		t.Errorf("empty tree: %d %s", rec.Code, rec.Body)
	}
	for _, target := range []string{"/api/models/alice/m1/tree/main/nope", "/api/models/alice/m1/tree/main/README.md", "/api/models/alice/m1/tree/main/docs/a.txt/x", "/api/models/alice/m1/tree/main/docs/nope"} {
		if rec := do(t, h, http.MethodGet, target, ""); rec.Code != http.StatusNotFound || !strings.Contains(rec.Body.String(), `"error"`) {
			t.Errorf("%s: %d %s", target, rec.Code, rec.Body)
		}
	}
}

func TestTreeRecursiveAndExpand(t *testing.T) {
	var checks, opened []string
	h, st := newHub(t, Options{
		Permission: recordChecks(&checks, nil),
		PreOpen:    func(_ context.Context, name string, write bool) error { opened = append(opened, name); return nil },
	})
	sha1 := seed(t, st, "alice/m1", map[string]string{"README.md": "r"}, day1)
	sha2 := seed(t, st, "alice/m1", map[string]string{"docs/a.txt": "aa", "docs/guide/intro.txt": "intro"}, day2)
	sha3 := seed(t, st, "alice/m1", map[string]string{"model.bin": lfsPointer}, day3)

	for target, want := range map[string][]string{
		"/api/models/alice/m1/tree/main?recursive=true":         {"README.md", "docs", "docs/a.txt", "docs/guide", "docs/guide/intro.txt", "model.bin"},
		"/api/models/alice/m1/tree/main/docs?recursive=1":       {"docs/a.txt", "docs/guide", "docs/guide/intro.txt"},
		"/api/models/alice/m1/tree/main/docs/?recursive=True":   {"docs/a.txt", "docs/guide", "docs/guide/intro.txt"},
		"/api/models/alice/m1/tree/main?recursive=false":        {"README.md", "docs", "model.bin"},
		"/api/models/alice/m1/tree/main?recursive=":             {"README.md", "docs", "model.bin"},
		"/api/models/alice/m1/tree/" + sha2 + "?recursive=true": {"README.md", "docs", "docs/a.txt", "docs/guide", "docs/guide/intro.txt"},
	} {
		if got := pathsOf(listItems(t, h, target)); !slices.Equal(got, want) {
			t.Errorf("%s: paths %v, want %v", target, got, want)
		}
	}
	got := byPath(listItems(t, h, "/api/models/alice/m1/tree/main?recursive=true&expand=true"))
	for p, want := range map[string]string{"README.md": sha1, "docs": sha2, "docs/a.txt": sha2, "docs/guide": sha2, "docs/guide/intro.txt": sha2, "model.bin": sha3} {
		if lc, _ := got[p]["lastCommit"].(map[string]any); lc == nil || lc["id"] != want {
			t.Errorf("%s lastCommit %v, want %s", p, got[p]["lastCommit"], want)
		}
	}
	if lc, _ := got["docs"]["lastCommit"].(map[string]any); lc["title"] != "Add docs/a.txt, docs/guide/intro.txt" || lc["date"] != "2024-02-01T12:00:00.000Z" {
		t.Errorf("docs lastCommit %v", lc)
	}
	if docs := got["docs"]; docs["type"] != "directory" || docs["size"] != float64(0) || len(docs["oid"].(string)) != 40 {
		t.Errorf("docs %v", docs)
	}
	for _, e := range listItems(t, h, "/api/models/alice/m1/tree/main?recursive=true&expand=false") {
		if _, ok := e["lastCommit"]; ok {
			t.Errorf("lastCommit without expand: %v", e)
		}
	}
	if !slices.Contains(checks, "read_repo alice/m1  main") || !slices.Contains(opened, "alice/m1") {
		t.Errorf("checks %v opened %v", checks, opened)
	}
	for _, target := range []string{"/api/models/alice/flags/tree/main?recursive=maybe", "/api/models/alice/flags/tree/main?expand=2", "/api/models/alice/flags/tree/main?recursive=true&expand=yes"} {
		if rec := do(t, h, http.MethodGet, target, ""); rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), `"error"`) {
			t.Errorf("%s: %d %s", target, rec.Code, rec.Body)
		}
	}
	// A rejected flag never reaches the permission hook or pulls a mirror.
	if slices.ContainsFunc(checks, func(c string) bool { return strings.Contains(c, "alice/flags") }) || slices.Contains(opened, "alice/flags") {
		t.Errorf("invalid flags reached checks %v opened %v", checks, opened)
	}
}

// setRef points the full reference name at hash, e.g. refs/convert/parquet, which hfd's branch and tag helpers cannot create.
func setRef(t *testing.T, st *storage.Storage, repoName, name, hash string) {
	t.Helper()
	r, err := git.Open(filesystem.NewStorage(chroot.New(st.RepositoriesFS(), repository.ResolvePath(repoName)), cache.NewObjectLRUDefault()), nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := r.Storer.SetReference(plumbing.NewHashReference(plumbing.ReferenceName(name), plumbing.NewHash(hash))); err != nil {
		t.Fatal(err)
	}
}

func TestTreeDecodesRevisionAndPathOnce(t *testing.T) {
	var checks []string
	h, st := newHub(t, Options{Permission: recordChecks(&checks, nil)})
	main := seed(t, st, "alice/m1", map[string]string{"README.md": "r", "d#1/q?.txt": "q", "d#1/x%y.txt": "x", "feature/docs/z.txt": "z"}, day1)
	seedBranch(t, st, "alice/m1", "feature/docs", map[string]string{"f.txt": "f"}, day1)
	setRef(t, st, "alice/m1", "refs/convert/parquet", main)
	repo, err := repository.Open(st.RepositoriesFS(), repository.ResolvePath("alice/m1"))
	if err != nil {
		t.Fatal(err)
	}
	if err := repo.CreateTag("release/1.0", "feature/docs"); err != nil {
		t.Fatal(err)
	}

	for target, want := range map[string][]string{
		"/api/models/alice/m1/tree/feature%2Fdocs":                          {"f.txt"},
		"/api/models/alice/m1/tree/release%2F1.0":                           {"f.txt"},
		"/api/models/alice/m1/tree/refs%2Fconvert%2Fparquet":                {"README.md", "d#1", "feature"},
		"/api/models/alice/m1/tree/refs%2Fconvert%2Fparquet/d%231":          {"d#1/q?.txt", "d#1/x%y.txt"},
		"/api/models/alice/m1/tree/main/feature/docs":                       {"feature/docs/z.txt"},
		"/api/models/alice/m1/tree/main/d%231?expand=true":                  {"d#1/q?.txt", "d#1/x%y.txt"},
		"/api/models/alice/m1/tree/main/%2E/d%231/":                         {"d#1/q?.txt", "d#1/x%y.txt"},
		"/api/models/alice/m1/tree/main/feature%2Fdocs":                     {"feature/docs/z.txt"},
		"/api/models/alice/m1/tree/" + main[:7] + "/feature?recursive=true": {"feature/docs", "feature/docs/z.txt"},
	} {
		if got := pathsOf(listItems(t, h, target)); !slices.Equal(got, want) {
			t.Errorf("%s: paths %v, want %v", target, got, want)
		}
	}
	if !slices.Contains(checks, "read_repo alice/m1  feature/docs") || !slices.Contains(checks, "read_repo alice/m1  refs/convert/parquet") {
		t.Errorf("checks %v", checks)
	}
	for target, status := range map[string]int{
		// A raw slash never joins segments into a revision: "feature" is not a ref, whatever branch shares the prefix.
		"/api/models/alice/m1/tree/feature/docs":             http.StatusNotFound,
		"/api/models/alice/m1/tree/feature/docs/z.txt":       http.StatusNotFound,
		"/api/models/alice/m1/tree/main/d%231/x%25y.txt":     http.StatusNotFound,
		"/api/models/alice/m1/tree/main/d%231/x%2525y.txt":   http.StatusNotFound,
		"/api/models/alice/m1/tree/nope":                     http.StatusNotFound,
		"/api/models/alice/m1/tree/main~999":                 http.StatusNotFound,
		"/api/models/alice/m1/tree/main/%2E%2E/x":            http.StatusBadRequest,
		"/api/models/alice/m1/tree/main/d%231/..%2F..%2Fetc": http.StatusBadRequest,
		"/api/models/alice/m1/tree/main/%2Fetc":              http.StatusBadRequest,
		"/api/models/%2E%2E/m1/tree/main":                    http.StatusBadRequest,
		"/api/models/alice/m1%2Fx/tree/main":                 http.StatusBadRequest,
	} {
		rec := do(t, h, http.MethodGet, target, "")
		if rec.Code != status || !strings.Contains(rec.Body.String(), `"error"`) {
			t.Errorf("%s: %d %s, want %d", target, rec.Code, rec.Body, status)
		}
	}
}

func TestTreeKeepsRepositoryTypesApart(t *testing.T) {
	var checks, opened []string
	h, st := newHub(t, Options{
		Permission: recordChecks(&checks, nil),
		PreOpen:    func(_ context.Context, name string, write bool) error { opened = append(opened, name); return nil },
	})
	seed(t, st, "alice/same", map[string]string{"m.txt": "m"}, day1)
	seed(t, st, "datasets/alice/same", map[string]string{"d.csv": "1", "sub/x": "x"}, day1)
	seed(t, st, "spaces/alice/same", map[string]string{"app.py": "a"}, day1)

	for target, want := range map[string][]string{
		"/api/models/alice/same/tree/main":       {"m.txt"},
		"/api/datasets/alice/same/tree/main":     {"d.csv", "sub"},
		"/api/datasets/alice/same/tree/main/sub": {"sub/x"},
		"/api/spaces/alice/same/tree/main":       {"app.py"},
	} {
		if got := pathsOf(listItems(t, h, target)); !slices.Equal(got, want) {
			t.Errorf("%s: paths %v, want %v", target, got, want)
		}
	}
	for _, target := range []string{"/api/models/alice/same/tree/main/sub", "/api/spaces/alice/same/tree/main/sub", "/api/datasets/alice/same/tree/main/m.txt"} {
		if rec := do(t, h, http.MethodGet, target, ""); rec.Code != http.StatusNotFound {
			t.Errorf("%s: %d %s", target, rec.Code, rec.Body)
		}
	}
	for _, name := range []string{"alice/same", "datasets/alice/same", "spaces/alice/same"} {
		if !slices.Contains(checks, "read_repo "+name+"  main") || !slices.Contains(opened, name) {
			t.Errorf("%s: checks %v opened %v", name, checks, opened)
		}
	}
}

func TestTreePermissionOpenAndStorageErrors(t *testing.T) {
	root := t.TempDir()
	st := storage.NewStorage(storage.WithRootDir(root))
	var opened []string
	h := New(Options{
		Storage: st,
		Permission: recordChecks(new([]string), func(op permission.Operation, name string) (bool, error) {
			if name == "alice/broken" {
				return false, context.DeadlineExceeded
			}
			return name != "alice/secret", nil
		}),
		PreOpen: func(_ context.Context, name string, write bool) error {
			opened = append(opened, name)
			if name == "alice/unreachable" {
				return errors.New("upstream down")
			}
			return nil
		},
	})
	seed(t, st, "alice/m1", map[string]string{"README.md": "r", "sub/keep": "k"}, day1)
	if _, err := repositoryInit(st, "alice/unborn"); err != nil {
		t.Fatal(err)
	}
	for target, status := range map[string]int{
		"/api/models/alice/secret/tree/main":      http.StatusForbidden,
		"/api/models/alice/broken/tree/main":      http.StatusInternalServerError,
		"/api/models/alice/unreachable/tree/main": http.StatusInternalServerError,
		"/api/models/alice/missing/tree/main":     http.StatusNotFound,
		"/api/models/alice/unborn/tree/main":      http.StatusNotFound,
	} {
		rec := do(t, h, http.MethodGet, target, "")
		if rec.Code != status || !strings.Contains(rec.Body.String(), `"error"`) {
			t.Errorf("%s: %d %s, want %d", target, rec.Code, rec.Body, status)
		}
	}
	if slices.Contains(opened, "alice/secret") || slices.Contains(opened, "alice/broken") || !slices.Contains(opened, "alice/missing") {
		t.Errorf("opened %v", opened)
	}

	subTree := byPath(listItems(t, h, "/api/models/alice/m1/tree/main"))["sub"]["oid"].(string)
	keepBlob := byPath(listItems(t, h, "/api/models/alice/m1/tree/main/sub"))["sub/keep"]["oid"].(string)
	removeObject(t, st, "alice/m1", keepBlob)
	for target, status := range map[string]int{
		"/api/models/alice/m1/tree/main":                http.StatusOK,
		"/api/models/alice/m1/tree/main/sub":            http.StatusInternalServerError,
		"/api/models/alice/m1/tree/main?recursive=true": http.StatusInternalServerError,
	} {
		if rec := do(t, reopen(root), http.MethodGet, target, ""); rec.Code != status || (status != http.StatusOK && !strings.Contains(rec.Body.String(), `"error"`)) {
			t.Errorf("%s without the blob: %d %s, want %d", target, rec.Code, rec.Body, status)
		}
	}
	removeObject(t, st, "alice/m1", subTree)
	for _, target := range []string{"/api/models/alice/m1/tree/main/sub", "/api/models/alice/m1/tree/main?recursive=true"} {
		if rec := do(t, reopen(root), http.MethodGet, target, ""); rec.Code != http.StatusInternalServerError || !strings.Contains(rec.Body.String(), `"error"`) {
			t.Errorf("%s without the subtree: %d %s", target, rec.Code, rec.Body)
		}
	}
}

func TestTreeDirectoryLastCommitFollowsTreeChanges(t *testing.T) {
	h, st := newHub(t, Options{})
	sha1 := seed(t, st, "alice/m1", map[string]string{"README.md": "r"}, day1)
	sha2 := seed(t, st, "alice/m1", map[string]string{"sub/keep": "k", "sub/drop": "d", "other/f": "f"}, day2)
	// The deletion is the newest commit yet carries an older author date than the addition.
	sha3 := commitDelete(t, st, "alice/m1", "sub/drop", day1)

	got := byPath(listItems(t, h, "/api/models/alice/m1/tree/main?recursive=true&expand=true"))
	if len(got) != 5 || got["sub/drop"] != nil {
		t.Fatalf("entries %v", got)
	}
	for p, want := range map[string]string{"sub": sha3, "other": sha2, "README.md": sha1, "sub/keep": sha2, "other/f": sha2} {
		if lc, _ := got[p]["lastCommit"].(map[string]any); lc == nil || lc["id"] != want {
			t.Errorf("%s lastCommit %v, want %s", p, got[p]["lastCommit"], want)
		}
	}
	if lc, _ := got["sub"]["lastCommit"].(map[string]any); lc["title"] != "Delete sub/drop" || lc["date"] != "2024-01-01T12:00:00.000Z" {
		t.Errorf("sub lastCommit %v", lc)
	}
}
