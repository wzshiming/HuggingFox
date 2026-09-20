package hub

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/go-git/go-billy/v6"
	"github.com/go-git/go-billy/v6/helper/chroot"
	"github.com/go-git/go-git/v6"
	"github.com/go-git/go-git/v6/plumbing"
	"github.com/go-git/go-git/v6/plumbing/cache"
	"github.com/go-git/go-git/v6/storage/filesystem"
	"github.com/matrixhub-ai/hfd/pkg/permission"
	"github.com/matrixhub-ai/hfd/pkg/repository"
	"github.com/matrixhub-ai/hfd/pkg/storage"
)

func newHub(t *testing.T, opts Options) (*Handler, *storage.Storage) {
	t.Helper()
	st := storage.NewStorage(storage.WithRootDir(t.TempDir()))
	opts.Storage = st
	return New(opts), st
}

// seed commits files onto main of repoName (hfd storage name), creating the repository when needed; a non-zero when dates the commit.
func seed(t *testing.T, st *storage.Storage, repoName string, files map[string]string, when time.Time) string {
	t.Helper()
	return seedBranch(t, st, repoName, "main", files, when)
}

func seedBranch(t *testing.T, st *storage.Storage, repoName, branch string, files map[string]string, when time.Time) string {
	t.Helper()
	ctx := context.Background()
	fs := st.RepositoriesFS()
	repoPath := repository.ResolvePath(repoName)
	repo, err := repository.Open(fs, repoPath)
	if err != nil {
		if repo, err = repository.Init(ctx, fs, repoPath, "main"); err != nil {
			t.Fatalf("init %s: %v", repoName, err)
		}
	}
	var ops []repository.CommitOperation
	for _, path := range slices.Sorted(func(yield func(string) bool) {
		for p := range files {
			if !yield(p) {
				return
			}
		}
	}) {
		ops = append(ops, repository.CommitOperation{Type: repository.CommitOperationAdd, Path: path, Content: []byte(files[path])})
	}
	hash, err := repo.CreateCommit(ctx, branch, "Add "+strings.Join(slices.Collect(func(yield func(string) bool) {
		for _, op := range ops {
			if !yield(op.Path) {
				return
			}
		}
	}), ", ")+"\n\nSeeded by the test.\n", "Alice", "alice@example.com", ops, "")
	if err != nil {
		t.Fatalf("commit %s: %v", repoName, err)
	}
	if when.IsZero() {
		return hash
	}
	return redate(t, fs, repoPath, branch, when)
}

// commitDelete removes p from main of repoName in one commit dated when.
func commitDelete(t *testing.T, st *storage.Storage, repoName, p string, when time.Time) string {
	t.Helper()
	fs := st.RepositoriesFS()
	repoPath := repository.ResolvePath(repoName)
	repo, err := repository.Open(fs, repoPath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.CreateCommit(context.Background(), "main", "Delete "+p, "Alice", "alice@example.com", []repository.CommitOperation{{Type: repository.CommitOperationDelete, Path: p}}, ""); err != nil {
		t.Fatal(err)
	}
	return redate(t, fs, repoPath, "main", when)
}

// removeObject deletes the loose object h of repoName so reading it fails the way a damaged store does.
func removeObject(t *testing.T, st *storage.Storage, repoName, h string) {
	t.Helper()
	if err := st.RepositoriesFS().Remove(path.Join(repository.ResolvePath(repoName), "objects", h[:2], h[2:])); err != nil {
		t.Fatal(err)
	}
}

// reopen builds a handler on a new Storage over root so repositories are opened afresh instead of served from caches.
func reopen(root string) *Handler {
	return New(Options{Storage: storage.NewStorage(storage.WithRootDir(root))})
}

// repositoryInit creates repoName with an unborn main branch.
func repositoryInit(st *storage.Storage, repoName string) (*repository.Repository, error) {
	return repository.Init(context.Background(), st.RepositoriesFS(), repository.ResolvePath(repoName), "main")
}

// redate rewrites the tip of branch with when as author and committer time, keeping tree, parents and message.
func redate(t *testing.T, fs billy.Filesystem, repoPath, branch string, when time.Time) string {
	t.Helper()
	r, err := git.Open(filesystem.NewStorage(chroot.New(fs, repoPath), cache.NewObjectLRUDefault()), nil)
	if err != nil {
		t.Fatal(err)
	}
	ref, err := r.Reference(plumbing.NewBranchReferenceName(branch), true)
	if err != nil {
		t.Fatal(err)
	}
	c, err := r.CommitObject(ref.Hash())
	if err != nil {
		t.Fatal(err)
	}
	c.Author.When, c.Committer.When = when, when
	obj := r.Storer.NewEncodedObject()
	if err := c.Encode(obj); err != nil {
		t.Fatal(err)
	}
	hash, err := r.Storer.SetEncodedObject(obj)
	if err != nil {
		t.Fatal(err)
	}
	if err := r.Storer.SetReference(plumbing.NewHashReference(ref.Name(), hash)); err != nil {
		t.Fatal(err)
	}
	return hash.String()
}

func do(t *testing.T, h http.Handler, method, target, body string, hdr ...string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, target, strings.NewReader(body))
	for i := 0; i+1 < len(hdr); i += 2 {
		req.Header.Set(hdr[i], hdr[i+1])
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func decode(t *testing.T, rec *httptest.ResponseRecorder, want int, v any) {
	t.Helper()
	if rec.Code != want {
		t.Fatalf("status %d, want %d: %s", rec.Code, want, rec.Body)
	}
	if !strings.HasPrefix(rec.Header().Get("Content-Type"), "application/json") {
		t.Fatalf("content type %q", rec.Header().Get("Content-Type"))
	}
	if err := json.Unmarshal(rec.Body.Bytes(), v); err != nil {
		t.Fatalf("decode %s: %v", rec.Body, err)
	}
}

func listItems(t *testing.T, h http.Handler, target string) []map[string]any {
	t.Helper()
	var items []map[string]any
	decode(t, do(t, h, http.MethodGet, target, ""), http.StatusOK, &items)
	return items
}

func listIDs(t *testing.T, h http.Handler, target string) []string {
	t.Helper()
	var ids []string
	for _, item := range listItems(t, h, target) {
		ids = append(ids, item["id"].(string))
	}
	return ids
}

func keysOf(m map[string]any) []string {
	return slices.Sorted(func(yield func(string) bool) {
		for k := range m {
			if !yield(k) {
				return
			}
		}
	})
}

var (
	day1 = time.Date(2024, 1, 1, 12, 0, 0, 0, time.UTC)
	day2 = time.Date(2024, 2, 1, 12, 0, 0, 0, time.UTC)
	day3 = time.Date(2024, 3, 1, 12, 0, 0, 0, time.UTC)
)

func recordChecks(checks *[]string, allow func(op permission.Operation, name string) (bool, error)) permission.PermissionHookFunc {
	return func(ctx context.Context, op permission.Operation, name string, c permission.Context) (bool, error) {
		*checks = append(*checks, op.String()+" "+name+" "+c.Author+" "+c.Ref)
		if allow == nil {
			return true, nil
		}
		return allow(op, name)
	}
}

func TestListEnumeratesTypedRootsAndScopesAuthor(t *testing.T) {
	var checks []string
	h, st := newHub(t, Options{Permission: recordChecks(&checks, nil)})
	seed(t, st, "bob/m2", map[string]string{"README.md": "# m2\n"}, time.Time{})
	seed(t, st, "alice/m1", map[string]string{"README.md": "# m1\n"}, time.Time{})
	seed(t, st, "datasets/alice/d1", map[string]string{"README.md": "# d1\n"}, time.Time{})
	seed(t, st, "spaces/alice/s1", map[string]string{"README.md": "# s1\n"}, time.Time{})

	for target, want := range map[string][]string{
		"/api/models":                         {"alice/m1", "bob/m2"},
		"/api/datasets":                       {"alice/d1"},
		"/api/spaces":                         {"alice/s1"},
		"/api/models?author=alice":            {"alice/m1"},
		"/api/models?author=datasets":         nil,
		"/api/models?author=..":               nil,
		"/api/models?author=.":                nil,
		"/api/models?author=alice%2Fm1":       nil,
		"/api/models?author=nobody":           nil,
		"/api/models?search=M1":               {"alice/m1"},
		"/api/models?search=BOB":              {"bob/m2"},
		"/api/datasets?author=alice":          {"alice/d1"},
		"/api/models?author=alice&search=zzz": nil,
	} {
		if got := listIDs(t, h, target); !slices.Equal(got, want) {
			t.Errorf("%s: ids %v, want %v", target, got, want)
		}
	}
	if !slices.Contains(checks, "list_repos models alice ") || !slices.Contains(checks, "list_repos datasets  ") {
		t.Errorf("permission checks %v", checks)
	}
	if got := listItems(t, h, "/api/datasets?author=nobody"); got == nil {
		t.Error("empty list must be a JSON array")
	}
}

func TestListPermissionDeniedAndHookError(t *testing.T) {
	h, _ := newHub(t, Options{Permission: recordChecks(new([]string), func(op permission.Operation, name string) (bool, error) {
		if name == "datasets" {
			return false, context.DeadlineExceeded
		}
		return name != "models", nil
	})})
	var body map[string]string
	decode(t, do(t, h, http.MethodGet, "/api/models", ""), http.StatusForbidden, &body)
	if body["error"] != "permission denied" {
		t.Errorf("denied body %v", body)
	}
	decode(t, do(t, h, http.MethodGet, "/api/datasets", ""), http.StatusInternalServerError, &body)
	if rec := do(t, h, http.MethodGet, "/api/spaces", ""); rec.Code != http.StatusOK {
		t.Errorf("spaces: %d", rec.Code)
	}
}

func TestStorageFailuresAreServerErrors(t *testing.T) {
	root := t.TempDir()
	st := storage.NewStorage(storage.WithRootDir(root))
	seed(t, st, "alice/m1", map[string]string{"README.md": modelCard, "sub/keep": "keep"}, day1)
	seed(t, st, "bob/m2", map[string]string{"README.md": "# m2\n"}, day1)
	repo, err := repository.Open(st.RepositoriesFS(), repository.ResolvePath("alice/m1"))
	if err != nil {
		t.Fatal(err)
	}
	hashOf := func(dir, name string) string {
		entries, err := repo.Tree("main", dir, nil)
		if err != nil {
			t.Fatal(err)
		}
		i := slices.IndexFunc(entries, func(e *repository.TreeEntry) bool { return e.Path() == name })
		if i < 0 {
			t.Fatalf("%q not in %q", name, dir)
		}
		return entries[i].Hash().String()
	}
	subTree, keepBlob := hashOf("", "sub"), hashOf("sub", "sub/keep")

	const target = "/api/models/alice/m1/paths-info/main"
	entries, _ := pathsInfo(t, reopen(root), target, "application/json", `{"paths":["sub/keep","nope.txt","sub/nope","README.md/x","README.md/x/y","nope/x"]}`)
	if len(entries) != 1 || entries[0]["path"] != "sub/keep" {
		t.Fatalf("intact store: %v", entries)
	}

	removeObject(t, st, "alice/m1", keepBlob)
	if rec := do(t, reopen(root), http.MethodPost, target, `{"paths":["sub/keep"]}`, "Content-Type", "application/json"); rec.Code != http.StatusInternalServerError || !strings.Contains(rec.Body.String(), `"error"`) {
		t.Errorf("missing blob: %d %s", rec.Code, rec.Body)
	}
	removeObject(t, st, "alice/m1", subTree)
	if rec := do(t, reopen(root), http.MethodPost, target, `{"paths":["sub/keep"]}`, "Content-Type", "application/json"); rec.Code != http.StatusInternalServerError || !strings.Contains(rec.Body.String(), `"error"`) {
		t.Errorf("missing subtree: %d %s", rec.Code, rec.Body)
	}

	config, err := st.RepositoriesFS().Create("/alice/m1.git/config")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := config.Write([]byte("[malformed")); err != nil {
		t.Fatal(err)
	}
	if err := config.Close(); err != nil {
		t.Fatal(err)
	}
	for _, target := range []string{"/api/models", "/api/models?author=alice", "/api/models-tags-by-type", "/api/models/alice/m1/commits/main"} {
		if rec := do(t, reopen(root), http.MethodGet, target, ""); rec.Code != http.StatusInternalServerError || !strings.Contains(rec.Body.String(), `"error"`) {
			t.Errorf("%s with a malformed config: %d %s", target, rec.Code, rec.Body)
		}
	}
	if got := listIDs(t, reopen(root), "/api/models?author=bob"); !slices.Equal(got, []string{"bob/m2"}) {
		t.Errorf("intact repository alone: %v", got)
	}
}

func TestUnmatchedRoutesFallThroughToNext(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Next", r.Method+" "+r.URL.Path)
		w.WriteHeader(http.StatusTeapot)
	})
	h, _ := newHub(t, Options{Next: next})
	for _, tc := range []struct{ method, target string }{
		{http.MethodPut, "/api/models"},
		{http.MethodGet, "/api/models/alice/m1"},
		{http.MethodPost, "/api/models/alice/m1/tree/main"},
		{http.MethodGet, "/api/models/alice/m1/treesize/main"},
		{http.MethodPost, "/api/models/alice/m1/commits/main"},
		{http.MethodGet, "/api/models/alice/m1/paths-info/main"},
		{http.MethodGet, "/alice/m1/resolve/main/README.md"},
		{http.MethodGet, "/api/spaces-tags-by-type"},
		{http.MethodGet, "/api/whoami-v2"},
	} {
		rec := do(t, h, tc.method, tc.target, "")
		if rec.Code != http.StatusTeapot || rec.Header().Get("X-Next") != tc.method+" "+tc.target {
			t.Errorf("%s %s: %d %q", tc.method, tc.target, rec.Code, rec.Header().Get("X-Next"))
		}
	}
}

func TestNilNextAnswersNotFoundEverywhere(t *testing.T) {
	h, st := newHub(t, Options{})
	tip := seed(t, st, "alice/m1", map[string]string{"README.md": "# Demo\n"}, day1)
	for _, tc := range []struct{ method, target, body string }{
		{http.MethodPost, "/api/models/alice/m1/commit/main", commitBody(tip)},
		{http.MethodPost, "/api/models/alice/m1/commit/main", commitBody("")},
		{http.MethodPost, "/api/models/alice/nope/commit/main", commitBody(tip)},
		{http.MethodGet, "/api/whoami-v2", ""},
	} {
		if rec := do(t, h, tc.method, tc.target, tc.body, "Content-Type", "application/x-ndjson"); rec.Code != http.StatusNotFound {
			t.Errorf("%s %s without Next: %d", tc.method, tc.target, rec.Code)
		}
	}
}
