package hubserver

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"testing/fstest"
	"time"

	"github.com/matrixhub-ai/hfd/pkg/authenticate"
)

const indexHTML = "<!doctype html><html><body>fox</body></html>"

func webFS() fstest.MapFS {
	return fstest.MapFS{
		"index.html":                         {Data: []byte(indexHTML)},
		"_app/version.json":                  {Data: []byte(`{"version":"1"}`)},
		"_app/immutable/entry/app.abc123.js": {Data: []byte("console.log(1)")},
	}
}

func testConfig(t *testing.T) Config {
	t.Helper()
	return Config{
		Addr:     "127.0.0.1:0",
		HostURL:  "http://hub.test",
		DataDir:  t.TempDir(),
		Username: "tester",
		Password: "pa55",
		Token:    "t0k3n",
		SignKey:  "test-sign-key",
	}
}

func newTestServer(t *testing.T, cfg Config) *httptest.Server {
	t.Helper()
	srv, err := New(context.Background(), cfg, webFS())
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	ts := httptest.NewServer(srv.Handler())
	t.Cleanup(ts.Close)
	return ts
}

func request(t *testing.T, method, url, contentType string, payload string, hdr ...string) *http.Response {
	t.Helper()
	var body io.Reader
	if payload != "" {
		body = strings.NewReader(payload)
	}
	req, err := http.NewRequest(method, url, body)
	if err != nil {
		t.Fatal(err)
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	for i := 0; i+1 < len(hdr); i += 2 {
		req.Header.Set(hdr[i], hdr[i+1])
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { res.Body.Close() })
	return res
}

func readAll(t *testing.T, res *http.Response) string {
	t.Helper()
	b, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestWhoamiIdentity(t *testing.T) {
	ts := newTestServer(t, testConfig(t))
	if res := request(t, http.MethodGet, ts.URL+"/api/whoami-v2", "", ""); res.StatusCode != http.StatusUnauthorized {
		t.Errorf("anonymous whoami: %d", res.StatusCode)
	}
	if res := request(t, http.MethodGet, ts.URL+"/api/whoami-v2", "", "", "Authorization", "Bearer wrong"); res.StatusCode != http.StatusUnauthorized {
		t.Errorf("wrong token whoami: %d", res.StatusCode)
	}
	res := request(t, http.MethodGet, ts.URL+"/api/whoami-v2", "", "", "Authorization", "Bearer t0k3n")
	var who struct{ Name string }
	if err := json.NewDecoder(res.Body).Decode(&who); err != nil || res.StatusCode != http.StatusOK || who.Name != "tester" {
		t.Errorf("token whoami: status %d name %q err %v", res.StatusCode, who.Name, err)
	}
	res = request(t, http.MethodGet, ts.URL+"/api/whoami-v2", "", "", "Authorization", "Basic "+basic("tester", "pa55"))
	if res.StatusCode != http.StatusOK {
		t.Errorf("basic whoami: %d", res.StatusCode)
	}
}

func basic(user, pass string) string {
	req, _ := http.NewRequest(http.MethodGet, "http://x/", nil)
	req.SetBasicAuth(user, pass)
	return strings.TrimPrefix(req.Header.Get("Authorization"), "Basic ")
}

// Upstream's default sign key is public, so with writes gated on identity it must not authenticate unless an operator configured it.
func TestSignedTokensRequireExplicitSignKey(t *testing.T) {
	mint := func(key string) string {
		tok, err := authenticate.NewTokenSignValidator([]byte(key)).Sign(context.Background(), http.MethodGet, "/api/whoami-v2", authenticate.NewIdentity("tester", ""), time.Hour)
		if err != nil {
			t.Fatal(err)
		}
		return "Bearer " + tok
	}
	cfg := testConfig(t)
	cfg.SignKey = DefaultConfig().SignKey
	ts := newTestServer(t, cfg)
	if res := request(t, http.MethodGet, ts.URL+"/api/whoami-v2", "", "", "Authorization", mint("secret-sign-key")); res.StatusCode != http.StatusUnauthorized {
		t.Errorf("upstream default key accepted under DefaultConfig: %d", res.StatusCode)
	}
	if res := request(t, http.MethodGet, ts.URL+"/api/whoami-v2", "", "", "Authorization", "Bearer t0k3n"); res.StatusCode != http.StatusOK {
		t.Errorf("static token under DefaultConfig sign key: %d", res.StatusCode)
	}

	ts = newTestServer(t, testConfig(t))
	if res := request(t, http.MethodGet, ts.URL+"/api/whoami-v2", "", "", "Authorization", mint("secret-sign-key")); res.StatusCode != http.StatusUnauthorized {
		t.Errorf("foreign key accepted with explicit sign key: %d", res.StatusCode)
	}
	res := request(t, http.MethodGet, ts.URL+"/api/whoami-v2", "", "", "Authorization", mint("test-sign-key"))
	var who struct{ Name string }
	if err := json.NewDecoder(res.Body).Decode(&who); err != nil || res.StatusCode != http.StatusOK || who.Name != "tester" {
		t.Errorf("explicit sign key: status %d name %q err %v", res.StatusCode, who.Name, err)
	}
}

func TestHubAPIAndWebUIShareOneChain(t *testing.T) {
	ts := newTestServer(t, testConfig(t))
	res := request(t, http.MethodGet, ts.URL+"/api/models", "", "")
	if res.StatusCode != http.StatusOK || strings.TrimSpace(readAll(t, res)) != "[]" {
		t.Errorf("empty models list: %d", res.StatusCode)
	}
	res = request(t, http.MethodGet, ts.URL+"/api/nope", "", "")
	if res.StatusCode != http.StatusNotFound || !strings.HasPrefix(res.Header.Get("Content-Type"), "application/json") {
		t.Errorf("unknown API: %d %q", res.StatusCode, res.Header.Get("Content-Type"))
	}
	res = request(t, http.MethodGet, ts.URL+"/alice/repo/tree/main", "", "")
	if res.StatusCode != http.StatusOK || !strings.HasPrefix(res.Header.Get("Content-Type"), "text/html") || readAll(t, res) != indexHTML {
		t.Errorf("repo page: %d %q", res.StatusCode, res.Header.Get("Content-Type"))
	}
	res = request(t, http.MethodGet, ts.URL+"/_app/immutable/entry/app.abc123.js", "", "")
	if res.StatusCode != http.StatusOK || res.Header.Get("Cache-Control") != "public, max-age=31536000, immutable" {
		t.Errorf("immutable asset: %d %q", res.StatusCode, res.Header.Get("Cache-Control"))
	}
}

func TestSeededRepoServesListResolveAndGit(t *testing.T) {
	ts := newTestServer(t, testConfig(t))
	auth := []string{"Authorization", "Bearer t0k3n"}
	res := request(t, http.MethodPost, ts.URL+"/api/repos/create", "application/json", `{"type":"model","name":"tiny","organization":"alice"}`, auth...)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("create repo: %d %s", res.StatusCode, readAll(t, res))
	}
	ndjson := "{\"key\":\"header\",\"value\":{\"summary\":\"Initial commit\"}}\n" +
		"{\"key\":\"file\",\"value\":{\"content\":\"# Tiny\\n\",\"path\":\"README.md\",\"encoding\":\"utf-8\"}}\n"
	res = request(t, http.MethodPost, ts.URL+"/api/models/alice/tiny/commit/main", "application/x-ndjson", ndjson, auth...)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("commit: %d %s", res.StatusCode, readAll(t, res))
	}

	res = request(t, http.MethodGet, ts.URL+"/api/models", "", "")
	if res.StatusCode != http.StatusOK || !strings.Contains(readAll(t, res), `"alice/tiny"`) {
		t.Errorf("models list after seed: %d", res.StatusCode)
	}
	res = request(t, http.MethodGet, ts.URL+"/alice/tiny/resolve/main/README.md", "", "")
	if res.StatusCode != http.StatusOK || readAll(t, res) != "# Tiny\n" {
		t.Errorf("resolve: %d", res.StatusCode)
	}
	res = request(t, http.MethodGet, ts.URL+"/alice/tiny/resolve/main/README.md", "", "", "Range", "bytes=0-1")
	if res.StatusCode != http.StatusPartialContent || readAll(t, res) != "# " {
		t.Errorf("resolve range: %d", res.StatusCode)
	}
	res = request(t, http.MethodGet, ts.URL+"/alice/tiny.git/info/refs?service=git-upload-pack", "", "")
	if res.StatusCode != http.StatusOK || res.Header.Get("Content-Type") != "application/x-git-upload-pack-advertisement" {
		t.Errorf("git advertisement: %d %q", res.StatusCode, res.Header.Get("Content-Type"))
	}
	res = request(t, http.MethodGet, ts.URL+"/alice/tiny/tree/main", "", "")
	if res.StatusCode != http.StatusOK || !strings.HasPrefix(res.Header.Get("Content-Type"), "text/html") {
		t.Errorf("repo page after seed: %d %q", res.StatusCode, res.Header.Get("Content-Type"))
	}

	// The SDK's optimistic guard: a stale parentCommit is the hub's 412, a current one commits through hfd.
	res = request(t, http.MethodGet, ts.URL+"/api/models/alice/tiny/revision/main", "", "")
	var info struct{ SHA string }
	if err := json.NewDecoder(res.Body).Decode(&info); err != nil || len(info.SHA) != 40 {
		t.Fatalf("revision: %d %v", res.StatusCode, err)
	}
	guarded := func(parent, text string) *http.Response {
		body := "{\"key\":\"header\",\"value\":{\"summary\":\"Edit\",\"parentCommit\":\"" + parent + "\"}}\n" +
			"{\"key\":\"file\",\"value\":{\"content\":\"" + text + "\",\"path\":\"README.md\",\"encoding\":\"utf-8\"}}\n"
		return request(t, http.MethodPost, ts.URL+"/api/models/alice/tiny/commit/main", "application/x-ndjson", body, auth...)
	}
	if res := guarded(strings.Repeat("0", 40), "# Stale"); res.StatusCode != http.StatusPreconditionFailed || !strings.Contains(readAll(t, res), info.SHA) {
		t.Errorf("stale parent: %d", res.StatusCode)
	}
	if res := guarded(info.SHA, "# Current"); res.StatusCode != http.StatusOK {
		t.Errorf("current parent: %d %s", res.StatusCode, readAll(t, res))
	}
	if res := request(t, http.MethodGet, ts.URL+"/alice/tiny/resolve/main/README.md", "", ""); readAll(t, res) != "# Current" {
		t.Error("the stale commit must not have landed and the current one must have")
	}
}

// A client that stops sending short of its Content-Length must get hfd's 400, not a commit of whatever arrived: the hub's header peek has to hand the read error on rather than a clean end.
func TestCommitCutShortByTheClientIsRejected(t *testing.T) {
	ts := newTestServer(t, testConfig(t))
	auth := []string{"Authorization", "Bearer t0k3n"}
	res := request(t, http.MethodPost, ts.URL+"/api/repos/create", "application/json", `{"type":"model","name":"tiny","organization":"alice"}`, auth...)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("create repo: %d %s", res.StatusCode, readAll(t, res))
	}
	ndjson := "{\"key\":\"header\",\"value\":{\"summary\":\"Initial commit\"}}\n" +
		"{\"key\":\"file\",\"value\":{\"content\":\"# Tiny\\n\",\"path\":\"README.md\",\"encoding\":\"utf-8\"}}\n"
	if res = request(t, http.MethodPost, ts.URL+"/api/models/alice/tiny/commit/main", "application/x-ndjson", ndjson, auth...); res.StatusCode != http.StatusOK {
		t.Fatalf("commit: %d %s", res.StatusCode, readAll(t, res))
	}
	revision := func() string {
		res := request(t, http.MethodGet, ts.URL+"/api/models/alice/tiny/revision/main", "", "")
		var info struct{ SHA string }
		if err := json.NewDecoder(res.Body).Decode(&info); err != nil || len(info.SHA) != 40 {
			t.Fatalf("revision: %d %v", res.StatusCode, err)
		}
		return info.SHA
	}
	tip := revision()
	header := `{"key":"header","value":{"summary":"Edit","parentCommit":"` + tip + `"}}`
	op := `{"key":"file","value":{"content":"partial-upload","path":"README.md","encoding":"utf-8"}}`
	for _, payload := range []string{op, header, header + "\n" + op + "\n"} {
		conn, err := net.Dial("tcp", ts.Listener.Addr().String())
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { conn.Close() })
		io.WriteString(conn, "POST /api/models/alice/tiny/commit/main HTTP/1.1\r\nHost: hub.test\r\nAuthorization: Bearer t0k3n\r\nContent-Type: application/x-ndjson\r\nContent-Length: "+strconv.Itoa(len(payload)+len(op)+1)+"\r\n\r\n"+payload)
		conn.(*net.TCPConn).CloseWrite()
		conn.SetReadDeadline(time.Now().Add(5 * time.Second))
		res, err := http.ReadResponse(bufio.NewReader(conn), nil)
		if err != nil {
			t.Fatalf("%.24s... cut short: %v", payload, err)
		}
		if body := readAll(t, res); res.StatusCode != http.StatusBadRequest {
			t.Errorf("%.24s... cut short: %d %s", payload, res.StatusCode, body)
		}
		res.Body.Close()
	}
	if got := revision(); got != tip {
		t.Errorf("branch tip moved from %s to %s on cut-short commits", tip, got)
	}
	if res := request(t, http.MethodGet, ts.URL+"/alice/tiny/resolve/main/README.md", "", ""); readAll(t, res) != "# Tiny\n" {
		t.Error("README changed by a cut-short commit")
	}
}

// The web UI's folder navigation reads directories from the hub's tree route, which lists subdirectories with their tree hash where hfd's emitted blank entries.
func TestTreeListsNestedDirectories(t *testing.T) {
	ts := newTestServer(t, testConfig(t))
	auth := []string{"Authorization", "Bearer t0k3n"}
	res := request(t, http.MethodPost, ts.URL+"/api/repos/create", "application/json", `{"type":"model","name":"nested","organization":"alice"}`, auth...)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("create repo: %d %s", res.StatusCode, readAll(t, res))
	}
	ndjson := "{\"key\":\"header\",\"value\":{\"summary\":\"add docs\"}}\n" +
		"{\"key\":\"file\",\"value\":{\"content\":\"intro\\n\",\"path\":\"docs/guide/intro.txt\",\"encoding\":\"utf-8\"}}\n"
	res = request(t, http.MethodPost, ts.URL+"/api/models/alice/nested/commit/main", "application/x-ndjson", ndjson, auth...)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("commit: %d %s", res.StatusCode, readAll(t, res))
	}
	type entry struct{ Type, Path, OID string }
	for dir, want := range map[string]string{"": "docs", "/docs": "docs/guide"} {
		var entries []entry
		res := request(t, http.MethodGet, ts.URL+"/api/models/alice/nested/tree/main"+dir+"?expand=true", "", "")
		if err := json.NewDecoder(res.Body).Decode(&entries); err != nil || res.StatusCode != http.StatusOK {
			t.Fatalf("tree %q: %d %v", dir, res.StatusCode, err)
		}
		i := slices.IndexFunc(entries, func(e entry) bool { return e.Path == want })
		if i < 0 || entries[i].Type != "directory" || len(entries[i].OID) != 40 || slices.ContainsFunc(entries, func(e entry) bool { return e.Path == "" }) {
			t.Errorf("tree %q must list directory %q with its tree hash and no blank entries: %+v", dir, want, entries)
		}
	}
	var all []entry
	res = request(t, http.MethodGet, ts.URL+"/api/models/alice/nested/tree/main?recursive=true", "", "")
	if err := json.NewDecoder(res.Body).Decode(&all); err != nil || res.StatusCode != http.StatusOK {
		t.Fatalf("recursive tree: %d %v", res.StatusCode, err)
	}
	var paths []string
	for _, e := range all {
		paths = append(paths, e.Path)
	}
	if want := []string{".gitattributes", "docs", "docs/guide", "docs/guide/intro.txt"}; !slices.Equal(paths, want) {
		t.Errorf("recursive tree paths %v, want %v", paths, want)
	}
}

func TestHubAPIExtensionsAnswerAheadOfHFD(t *testing.T) {
	ts := newTestServer(t, testConfig(t))
	auth := []string{"Authorization", "Bearer t0k3n"}
	for _, repo := range []struct{ typ, name, readme string }{
		{"model", "tiny", "---\nlicense: mit\npipeline_tag: text-generation\n---\n# Tiny\n"},
		{"dataset", "data", "---\ntask_categories: [text-classification]\n---\n# Data\n\nSome rows.\n"},
	} {
		res := request(t, http.MethodPost, ts.URL+"/api/repos/create", "application/json", `{"type":"`+repo.typ+`","name":"`+repo.name+`","organization":"alice"}`, auth...)
		if res.StatusCode != http.StatusOK {
			t.Fatalf("create %s: %d %s", repo.name, res.StatusCode, readAll(t, res))
		}
		ndjson := "{\"key\":\"header\",\"value\":{\"summary\":\"Initial commit\"}}\n" +
			"{\"key\":\"file\",\"value\":{\"content\":" + strconv.Quote(repo.readme) + ",\"path\":\"README.md\",\"encoding\":\"utf-8\"}}\n"
		res = request(t, http.MethodPost, ts.URL+"/api/"+repo.typ+"s/alice/"+repo.name+"/commit/main", "application/x-ndjson", ndjson, auth...)
		if res.StatusCode != http.StatusOK {
			t.Fatalf("commit %s: %d %s", repo.name, res.StatusCode, readAll(t, res))
		}
	}

	var models []map[string]any
	res := request(t, http.MethodGet, ts.URL+"/api/models?expand[]=author&expand[]=sha&expand[]=pipeline_tag", "", "")
	if err := json.NewDecoder(res.Body).Decode(&models); err != nil || res.StatusCode != http.StatusOK || len(models) != 1 || models[0]["author"] != "alice" || models[0]["pipeline_tag"] != "text-generation" || len(models[0]["sha"].(string)) != 40 {
		t.Errorf("expanded list: %d %v %v", res.StatusCode, models, err)
	}
	var datasets []map[string]any
	res = request(t, http.MethodGet, ts.URL+"/api/datasets", "", "")
	if err := json.NewDecoder(res.Body).Decode(&datasets); err != nil || len(datasets) != 1 || datasets[0]["description"] != "Some rows." {
		t.Errorf("datasets list: %d %v %v", res.StatusCode, datasets, err)
	}
	var tags map[string][]map[string]any
	res = request(t, http.MethodGet, ts.URL+"/api/models-tags-by-type", "", "")
	if err := json.NewDecoder(res.Body).Decode(&tags); err != nil || res.StatusCode != http.StatusOK || len(tags["pipeline_tag"]) != 1 || len(tags["license"]) != 1 {
		t.Errorf("tags-by-type: %d %v %v", res.StatusCode, tags, err)
	}
	var quick map[string]any
	res = request(t, http.MethodGet, ts.URL+"/api/quicksearch?q=a", "", "")
	if err := json.NewDecoder(res.Body).Decode(&quick); err != nil || res.StatusCode != http.StatusOK || quick["modelsCount"] != float64(1) || quick["datasetsCount"] != float64(1) {
		t.Errorf("quicksearch: %d %v %v", res.StatusCode, quick, err)
	}
	// hfd's create seeds a .gitattributes commit, so the seeded README makes two.
	res = request(t, http.MethodGet, ts.URL+"/api/models/alice/tiny/commits/main", "", "")
	if res.StatusCode != http.StatusOK || res.Header.Get("X-Total-Count") != "2" || !strings.Contains(readAll(t, res), `"title":"Initial commit"`) {
		t.Errorf("commits: %d total %q", res.StatusCode, res.Header.Get("X-Total-Count"))
	}
	res = request(t, http.MethodPost, ts.URL+"/api/datasets/alice/data/paths-info/main", "application/json", `{"paths":["README.md","nope"],"expand":true}`)
	if body := readAll(t, res); res.StatusCode != http.StatusOK || !strings.Contains(body, `"path":"README.md"`) || !strings.Contains(body, `"lastCommit"`) || strings.Contains(body, "nope") {
		t.Errorf("paths-info: %d %s", res.StatusCode, body)
	}

	for _, target := range []string{"/api/models", "/api/quicksearch?q=a", "/api/models/alice/tiny/commits/main", "/api/models-tags-by-type", "/api/models/alice/tiny/tree/main"} {
		res := request(t, http.MethodGet, ts.URL+target, "", "", "Authorization", "Bearer wrong")
		if res.StatusCode != http.StatusUnauthorized || strings.Contains(res.Header.Get("Content-Type"), "html") {
			t.Errorf("%s with bad token: %d %q", target, res.StatusCode, res.Header.Get("Content-Type"))
		}
		if res := request(t, http.MethodGet, ts.URL+target, "", "", auth...); res.StatusCode != http.StatusOK {
			t.Errorf("%s with token: %d", target, res.StatusCode)
		}
	}
	for _, target := range []string{"/api/models/alice/tiny", "/api/models/alice/tiny/tree/main", "/api/models/alice/tiny/refs", "/alice/tiny/resolve/main/README.md", "/alice/tiny.git/info/refs?service=git-upload-pack", "/api/models/alice/tiny/revision/main"} {
		if res := request(t, http.MethodGet, ts.URL+target, "", ""); res.StatusCode != http.StatusOK || strings.Contains(res.Header.Get("Content-Type"), "html") {
			t.Errorf("hfd route %s: %d %q", target, res.StatusCode, res.Header.Get("Content-Type"))
		}
	}
	res = request(t, http.MethodGet, ts.URL+"/api/models/alice/tiny/commits/nope", "", "")
	if res.StatusCode != http.StatusNotFound || !strings.HasPrefix(res.Header.Get("Content-Type"), "application/json") {
		t.Errorf("missing revision: %d %q", res.StatusCode, res.Header.Get("Content-Type"))
	}
}

func TestProtocolAndAuthResponsesNeverFallBackToSPA(t *testing.T) {
	ts := newTestServer(t, testConfig(t))
	for _, tc := range []struct {
		method, target string
		hdr            []string
		status         int
	}{
		{http.MethodGet, "/alice/nope.git/info/refs?service=git-upload-pack", nil, http.StatusNotFound},
		{http.MethodGet, "/alice/nope/resolve/main/x.bin", nil, http.StatusNotFound},
		{http.MethodGet, "/api/whoami-v2", []string{"Authorization", "Basic " + basic("tester", "wrong")}, http.StatusUnauthorized},
		{http.MethodGet, "/alice/nope.git/info/refs?service=git-receive-pack", []string{"Authorization", "Basic " + basic("tester", "wrong")}, http.StatusUnauthorized},
		{http.MethodPost, "/alice/nope.git/info/lfs/objects/batch", []string{"Authorization", "Bearer wrong"}, http.StatusUnauthorized},
	} {
		res := request(t, tc.method, ts.URL+tc.target, "", "", tc.hdr...)
		if res.StatusCode != tc.status || strings.Contains(res.Header.Get("Content-Type"), "html") {
			t.Errorf("%s %s: status %d type %q", tc.method, tc.target, res.StatusCode, res.Header.Get("Content-Type"))
		}
	}
	res := request(t, http.MethodGet, ts.URL+"/alice/nope.git/info/refs?service=git-receive-pack", "", "", "Authorization", "Basic "+basic("tester", "wrong"))
	if !strings.HasPrefix(res.Header.Get("WWW-Authenticate"), "Basic") {
		t.Errorf("WWW-Authenticate %q", res.Header.Get("WWW-Authenticate"))
	}
}

func TestAnonymousReadsAllowedWritesRequireAuthentication(t *testing.T) {
	ts := newTestServer(t, testConfig(t))
	auth := []string{"Authorization", "Bearer t0k3n"}
	res := request(t, http.MethodPost, ts.URL+"/api/repos/create", "application/json", `{"type":"model","name":"tiny","organization":"alice"}`, auth...)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("create repo: %d %s", res.StatusCode, readAll(t, res))
	}
	ndjson := "{\"key\":\"header\",\"value\":{\"summary\":\"Initial commit\"}}\n" +
		"{\"key\":\"file\",\"value\":{\"content\":\"# Tiny\\n\",\"path\":\"README.md\",\"encoding\":\"utf-8\"}}\n"
	res = request(t, http.MethodPost, ts.URL+"/api/models/alice/tiny/commit/main", "application/x-ndjson", ndjson, auth...)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("commit: %d %s", res.StatusCode, readAll(t, res))
	}

	for _, tc := range []struct{ method, target, body string }{
		{http.MethodGet, "/api/models", ""},
		{http.MethodGet, "/api/models/alice/tiny", ""},
		{http.MethodGet, "/api/models/alice/tiny/tree/main", ""},
		{http.MethodGet, "/alice/tiny/resolve/main/README.md", ""},
		{http.MethodPost, "/api/models/alice/tiny/paths-info/main", `{"paths":["README.md"]}`},
	} {
		if res := request(t, tc.method, ts.URL+tc.target, "application/json", tc.body); res.StatusCode != http.StatusOK {
			t.Errorf("anonymous read %s %s: %d", tc.method, tc.target, res.StatusCode)
		}
	}

	for _, tc := range []struct{ method, target, contentType, body string }{
		{http.MethodPost, "/api/repos/create", "application/json", `{"type":"model","name":"anon","organization":"alice"}`},
		{http.MethodPost, "/api/models/alice/tiny/commit/main", "application/x-ndjson", strings.Replace(ndjson, "# Tiny", "# Anon", 1)},
		{http.MethodPost, "/api/models/alice/tiny/preupload/main", "application/json", `{"files":[{"path":"x.bin","size":1}]}`},
		{http.MethodPost, "/api/models/alice/tiny/branch/dev", "application/json", `{}`},
		{http.MethodPost, "/api/models/alice/tiny/tag/v1", "application/json", `{"tag":"v1"}`},
		{http.MethodPut, "/api/models/alice/tiny/settings", "application/json", `{"private":false}`},
		{http.MethodPost, "/api/models/alice/tiny/super-squash/main", "application/json", `{"message":"squash"}`},
		{http.MethodPost, "/api/repos/move", "application/json", `{"fromRepo":"alice/tiny","toRepo":"alice/moved","type":"model"}`},
		{http.MethodDelete, "/api/repos/delete", "application/json", `{"type":"model","name":"tiny","organization":"alice"}`},
		{http.MethodGet, "/alice/tiny.git/info/refs?service=git-receive-pack", "", ""},
	} {
		res := request(t, tc.method, ts.URL+tc.target, tc.contentType, tc.body)
		if res.StatusCode != http.StatusForbidden || strings.Contains(res.Header.Get("Content-Type"), "html") {
			t.Errorf("anonymous %s %s: %d %q", tc.method, tc.target, res.StatusCode, res.Header.Get("Content-Type"))
		}
		if res := request(t, tc.method, ts.URL+tc.target, tc.contentType, tc.body, "Authorization", "Bearer wrong"); res.StatusCode != http.StatusUnauthorized {
			t.Errorf("wrong token %s %s: %d", tc.method, tc.target, res.StatusCode)
		}
	}

	var models []map[string]any
	res = request(t, http.MethodGet, ts.URL+"/api/models", "", "")
	if err := json.NewDecoder(res.Body).Decode(&models); err != nil || len(models) != 1 || models[0]["id"] != "alice/tiny" {
		t.Errorf("models after denied writes: %v %v", models, err)
	}
	res = request(t, http.MethodGet, ts.URL+"/alice/tiny/resolve/main/README.md", "", "")
	if body := readAll(t, res); res.StatusCode != http.StatusOK || body != "# Tiny\n" {
		t.Errorf("README after denied commit: %d %q", res.StatusCode, body)
	}
	res = request(t, http.MethodGet, ts.URL+"/api/models/alice/tiny/refs", "", "")
	if body := readAll(t, res); res.StatusCode != http.StatusOK || strings.Contains(body, `"dev"`) || strings.Contains(body, `"v1"`) {
		t.Errorf("refs after denied branch/tag: %d %s", res.StatusCode, body)
	}
	res = request(t, http.MethodGet, ts.URL+"/api/models/alice/tiny/commits/main", "", "")
	if res.StatusCode != http.StatusOK || res.Header.Get("X-Total-Count") != "2" {
		t.Errorf("commits after denied squash: %d total %q", res.StatusCode, res.Header.Get("X-Total-Count"))
	}

	res = request(t, http.MethodPost, ts.URL+"/api/models/alice/tiny/commit/main", "application/x-ndjson", strings.Replace(ndjson, "# Tiny", "# Tiny v2", 1), auth...)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("token commit: %d %s", res.StatusCode, readAll(t, res))
	}
	res = request(t, http.MethodGet, ts.URL+"/alice/tiny/resolve/main/README.md", "", "")
	if body := readAll(t, res); body != "# Tiny v2\n" {
		t.Errorf("README after token commit: %q", body)
	}
	res = request(t, http.MethodPost, ts.URL+"/api/repos/create", "application/json", `{"type":"model","name":"second","organization":"alice"}`, "Authorization", "Basic "+basic("tester", "pa55"))
	if res.StatusCode != http.StatusOK {
		t.Errorf("basic-auth create: %d %s", res.StatusCode, readAll(t, res))
	}
	res = request(t, http.MethodDelete, ts.URL+"/api/repos/delete", "application/json", `{"type":"model","name":"second","organization":"alice"}`, auth...)
	if res.StatusCode != http.StatusOK {
		t.Errorf("token delete: %d %s", res.StatusCode, readAll(t, res))
	}
}

func TestUnmatchedMethodsAreConsistent(t *testing.T) {
	ts := newTestServer(t, testConfig(t))
	for _, tc := range []struct {
		method, target string
		status         int
	}{
		{http.MethodPut, "/api/models", http.StatusMethodNotAllowed},
		{http.MethodPost, "/api/nope", http.StatusNotFound},
		{http.MethodPost, "/models", http.StatusMethodNotAllowed},
		{http.MethodPost, "/api/models/alice/repo/tree/main", http.StatusMethodNotAllowed},
		{http.MethodDelete, "/alice/repo/tree/main", http.StatusMethodNotAllowed},
	} {
		res := request(t, tc.method, ts.URL+tc.target, "", "")
		if res.StatusCode != tc.status || strings.Contains(res.Header.Get("Content-Type"), "html") {
			t.Errorf("%s %s: status %d type %q", tc.method, tc.target, res.StatusCode, res.Header.Get("Content-Type"))
		}
	}
}

func TestHostURLInference(t *testing.T) {
	for addr, want := range map[string]string{
		":8080":           "http://localhost:8080",
		"0.0.0.0:80":      "http://0.0.0.0:80",
		"[::1]:9090":      "http://[::1]:9090",
		"127.0.0.1:18080": "http://127.0.0.1:18080",
	} {
		cfg := Config{Addr: addr}
		got, err := cfg.hostURL()
		if err != nil || got != want {
			t.Errorf("hostURL(%q) = %q, %v; want %q", addr, got, err, want)
		}
	}
	cfg := Config{Addr: "8080"}
	if _, err := cfg.hostURL(); err == nil {
		t.Error("missing port accepted")
	}
	cfg = Config{Addr: ":8080", HostURL: "https://hub.example"}
	if got, _ := cfg.hostURL(); got != "https://hub.example" {
		t.Errorf("explicit HostURL overridden: %q", got)
	}
}

func TestDefaultConfigMatchesUpstreamDefaultsExceptSignKey(t *testing.T) {
	cfg := DefaultConfig()
	if cfg.Addr != ":8080" || cfg.SSHAddr != ":2222" || cfg.DataDir != "./data" || cfg.Username != "admin" || cfg.SignKey != "" {
		t.Errorf("defaults: %+v", cfg)
	}
	if cfg.ProxyCacheTTL != time.Minute || cfg.ProxyConcurrencyPerFile != 2 || cfg.ProxyCacheSize != 10<<30 {
		t.Errorf("proxy defaults: %+v", cfg)
	}
}

func TestMirrorEnabledLogsOmitURLCredentials(t *testing.T) {
	var logs bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&logs, nil)))
	t.Cleanup(func() { slog.SetDefault(prev) })

	cfg := testConfig(t)
	cfg.PullMirrorURL = "http://puller:pull-pass@pull.test/?token=pull-query"
	cfg.PushMirrorURL = "http://pusher:push-pass@push.test/?token=push-query"
	if _, err := New(context.Background(), cfg, webFS()); err != nil {
		t.Fatalf("New: %v", err)
	}
	if strings.Count(logs.String(), "mirror enabled") != 2 {
		t.Errorf("mirror enabled lines missing: %s", logs.String())
	}
	for _, secret := range []string{"puller", "pull-pass", "pull-query", "pusher", "push-pass", "push-query"} {
		if strings.Contains(logs.String(), secret) {
			t.Errorf("log leaks %q: %s", secret, logs.String())
		}
	}
}

// The mirror rule must survive the policy composition: a pull-mirrored repository refuses updates even from an authenticated writer, before any upstream contact.
func TestPullMirroredReposStayReadOnlyForAuthenticatedWriters(t *testing.T) {
	var hits atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { hits.Add(1); http.NotFound(w, r) }))
	t.Cleanup(upstream.Close)
	cfg := testConfig(t)
	cfg.PullMirrorURL = upstream.URL
	ts := newTestServer(t, cfg)
	ndjson := "{\"key\":\"header\",\"value\":{\"summary\":\"edit\"}}\n" +
		"{\"key\":\"file\",\"value\":{\"content\":\"x\",\"path\":\"README.md\",\"encoding\":\"utf-8\"}}\n"
	res := request(t, http.MethodPost, ts.URL+"/api/models/alice/tiny/commit/main", "application/x-ndjson", ndjson, "Authorization", "Bearer t0k3n")
	if res.StatusCode != http.StatusForbidden || hits.Load() != 0 {
		t.Errorf("authenticated commit to pull-mirrored repo: %d, upstream hits %d", res.StatusCode, hits.Load())
	}
}

func freeAddr(t *testing.T) string {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	return ln.Addr().String()
}

func waitHTTP(t *testing.T, url string) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for {
		res, err := http.Get(url)
		if err == nil {
			res.Body.Close()
			if res.StatusCode == http.StatusOK {
				return
			}
		}
		if time.Now().After(deadline) {
			t.Fatalf("server at %s not up: %v", url, err)
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func assertFree(t *testing.T, addr string) {
	t.Helper()
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		t.Errorf("%s still bound after Serve returned: %v", addr, err)
		return
	}
	ln.Close()
}

func serveAsync(t *testing.T, ctx context.Context, cfg Config) <-chan error {
	t.Helper()
	srv, err := New(ctx, cfg, webFS())
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	done := make(chan error, 1)
	go func() { done <- srv.Serve(ctx) }()
	return done
}

func waitServe(t *testing.T, done <-chan error) error {
	t.Helper()
	select {
	case err := <-done:
		return err
	case <-time.After(15 * time.Second):
		t.Fatal("Serve did not return")
		return nil
	}
}

func TestServeStopsOnContextCancelWithoutLeakingListeners(t *testing.T) {
	cfg := testConfig(t)
	cfg.Addr = freeAddr(t)
	ctx, cancel := context.WithCancel(context.Background())
	done := serveAsync(t, ctx, cfg)
	waitHTTP(t, "http://"+cfg.Addr+"/api/models")
	cancel()
	if err := waitServe(t, done); err != nil {
		t.Errorf("Serve after cancel: %v", err)
	}
	assertFree(t, cfg.Addr)
	if _, err := os.Stat(filepath.Join(cfg.DataDir, "ssh_host_rsa_key")); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("SSH disabled but host key handled: %v", err)
	}
}

// serveWithHandler serves h in place of the hub chain with a short graceful window, and returns a raw client conn once the port answers.
func serveWithHandler(t *testing.T, ctx context.Context, h http.HandlerFunc) (net.Conn, <-chan error) {
	t.Helper()
	cfg := testConfig(t)
	cfg.Addr = freeAddr(t)
	srv, err := New(ctx, cfg, webFS())
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	srv.handler, srv.shutdownGrace = h, 300*time.Millisecond
	done := make(chan error, 1)
	go func() { done <- srv.Serve(ctx) }()
	waitHTTP(t, "http://"+cfg.Addr+"/")
	conn, err := net.DialTimeout("tcp", cfg.Addr, 5*time.Second)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	t.Cleanup(func() { conn.Close() })
	return conn, done
}

func waitClosed(t *testing.T, ch <-chan struct{}, what string) {
	t.Helper()
	select {
	case <-ch:
	case <-time.After(5 * time.Second):
		t.Fatalf("%s within 5s", what)
	}
}

// readUntilClosed reports whether the peer closed conn within the deadline, returning whatever it sent first.
func readUntilClosed(t *testing.T, conn net.Conn) (string, bool) {
	t.Helper()
	conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	data, err := io.ReadAll(conn)
	return string(data), !errors.Is(err, os.ErrDeadlineExceeded)
}

func TestServeCancelsRequestContextsAndClosesConnectionsOnCancel(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	started, canceled := make(chan struct{}), make(chan struct{})
	conn, done := serveWithHandler(t, ctx, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/block" {
			return
		}
		close(started)
		<-r.Context().Done()
		close(canceled)
	})
	io.WriteString(conn, "GET /block HTTP/1.1\r\nHost: hub.test\r\n\r\n")
	waitClosed(t, started, "handler did not start")
	cancel()
	waitClosed(t, canceled, "request context not cancelled by Serve context cancel")
	if err := waitServe(t, done); err != nil {
		t.Errorf("Serve after cancel: %v", err)
	}
	if got, closed := readUntilClosed(t, conn); !closed || !strings.HasPrefix(got, "HTTP/1.1 200") {
		t.Errorf("released request connection: closed=%v response %q", closed, got)
	}
}

func TestServeClosesStalledConnectionsAfterGracefulWindow(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	started := make(chan struct{})
	conn, done := serveWithHandler(t, ctx, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/block" {
			return
		}
		close(started)
		_, _ = io.Copy(io.Discard, r.Body)
	})
	io.WriteString(conn, "POST /block HTTP/1.1\r\nHost: hub.test\r\nContent-Length: 10\r\n\r\nabc")
	waitClosed(t, started, "handler did not start")
	cancel()
	if err := waitServe(t, done); err != nil {
		t.Errorf("Serve after cancel: %v", err)
	}
	if _, closed := readUntilClosed(t, conn); !closed {
		t.Error("stalled connection still open after Serve returned")
	}
}

func TestServeWithSSHGeneratesAndReusesHostKey(t *testing.T) {
	cfg := testConfig(t)
	cfg.Addr = freeAddr(t)
	cfg.SSHAddr = freeAddr(t)
	keyPath := filepath.Join(cfg.DataDir, "ssh_host_rsa_key")

	ctx, cancel := context.WithCancel(context.Background())
	done := serveAsync(t, ctx, cfg)
	waitHTTP(t, "http://"+cfg.Addr+"/api/models")
	conn, err := net.DialTimeout("tcp", cfg.SSHAddr, 5*time.Second)
	if err != nil {
		t.Fatalf("dial ssh: %v", err)
	}
	conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	banner, err := bufio.NewReader(conn).ReadString('\n')
	conn.Close()
	if err != nil || !strings.HasPrefix(banner, "SSH-2.0-") {
		t.Fatalf("ssh banner %q: %v", banner, err)
	}
	cancel()
	if err := waitServe(t, done); err != nil {
		t.Errorf("Serve after cancel: %v", err)
	}
	assertFree(t, cfg.Addr)
	assertFree(t, cfg.SSHAddr)

	first, err := os.ReadFile(keyPath)
	if err != nil {
		t.Fatalf("host key not stored: %v", err)
	}
	if _, err := New(context.Background(), cfg, webFS()); err != nil {
		t.Fatal(err)
	}
	second, err := os.ReadFile(keyPath)
	if err != nil || string(first) != string(second) {
		t.Errorf("host key not reused on restart: %v", err)
	}
}

func TestServeClosesPreHandshakeSSHConnectionsOnCancel(t *testing.T) {
	cfg := testConfig(t)
	cfg.Addr = freeAddr(t)
	cfg.SSHAddr = freeAddr(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := serveAsync(t, ctx, cfg)
	waitHTTP(t, "http://"+cfg.Addr+"/api/models")
	conn, err := net.DialTimeout("tcp", cfg.SSHAddr, 5*time.Second)
	if err != nil {
		t.Fatalf("dial ssh: %v", err)
	}
	defer conn.Close()
	conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	br := bufio.NewReader(conn)
	if banner, err := br.ReadString('\n'); err != nil || !strings.HasPrefix(banner, "SSH-2.0-") {
		t.Fatalf("ssh banner %q: %v", banner, err)
	}
	cancel()
	if err := waitServe(t, done); err != nil {
		t.Errorf("Serve after cancel: %v", err)
	}
	conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	if _, err := br.ReadByte(); !errors.Is(err, io.EOF) {
		t.Errorf("pre-handshake SSH connection still open after Serve returned: %v", err)
	}
	assertFree(t, cfg.SSHAddr)
}

func TestServeFailsFastOnPortConflictAndReleasesTheOtherListener(t *testing.T) {
	busy, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer busy.Close()

	cfg := testConfig(t)
	cfg.Addr = busy.Addr().String()
	cfg.SSHAddr = freeAddr(t)
	if err := waitServe(t, serveAsync(t, context.Background(), cfg)); err == nil || !strings.Contains(err.Error(), cfg.Addr) {
		t.Errorf("HTTP conflict error %v", err)
	}
	assertFree(t, cfg.SSHAddr)

	cfg.Addr, cfg.SSHAddr = freeAddr(t), busy.Addr().String()
	if err := waitServe(t, serveAsync(t, context.Background(), cfg)); err == nil || !strings.Contains(err.Error(), cfg.SSHAddr) {
		t.Errorf("SSH conflict error %v", err)
	}
	assertFree(t, cfg.Addr)
}
