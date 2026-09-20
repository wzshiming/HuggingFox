package webui

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
)

const indexHTML = "<!doctype html><html><head><meta http-equiv=\"content-security-policy\" content=\"default-src 'self'\"></head><body>fox</body></html>"

func builtApp() fstest.MapFS {
	return fstest.MapFS{
		"index.html":                           {Data: []byte(indexHTML)},
		"_app/version.json":                    {Data: []byte(`{"version":"1"}`)},
		"_app/immutable/entry/app.abc123.js":   {Data: []byte("console.log('0123456789')")},
		"_app/immutable/assets/app.def456.css": {Data: []byte("body{margin:0}")},
		"favicon.svg":                          {Data: []byte("<svg/>")},
	}
}

func do(t *testing.T, h http.Handler, method, target string, hdr ...string) *http.Response {
	t.Helper()
	req := httptest.NewRequest(method, target, nil)
	for i := 0; i+1 < len(hdr); i += 2 {
		req.Header.Set(hdr[i], hdr[i+1])
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec.Result()
}

func body(t *testing.T, res *http.Response) string {
	t.Helper()
	b, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestIndexServedAtRootWithNoCacheAndSecurityHeaders(t *testing.T) {
	res := do(t, Handler(builtApp()), http.MethodGet, "/")
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status %d", res.StatusCode)
	}
	if got := body(t, res); got != indexHTML {
		t.Errorf("body %q", got)
	}
	want := map[string]string{
		"Content-Type":            "text/html; charset=utf-8",
		"Cache-Control":           "no-cache",
		"Content-Security-Policy": "frame-ancestors 'self'",
		"X-Content-Type-Options":  "nosniff",
		"Referrer-Policy":         "strict-origin-when-cross-origin",
	}
	for k, v := range want {
		if got := res.Header.Get(k); got != v {
			t.Errorf("%s = %q, want %q", k, got, v)
		}
	}
}

func TestIndexHTMLDirectRequestDoesNotRedirect(t *testing.T) {
	for _, method := range []string{http.MethodGet, http.MethodHead} {
		res := do(t, Handler(builtApp()), method, "/index.html")
		if res.StatusCode != http.StatusOK {
			t.Errorf("%s /index.html status %d, want 200", method, res.StatusCode)
		}
		if res.Header.Get("Cache-Control") != "no-cache" {
			t.Errorf("%s /index.html Cache-Control %q", method, res.Header.Get("Cache-Control"))
		}
	}
}

func TestBrowserRoutesFallBackToIndex(t *testing.T) {
	h := Handler(builtApp())
	for _, target := range []string{"/models", "/models/", "/alice/repo", "/alice/repo/tree/main", "/datasets/alice/repo/blob/main/data.json", "/foo.json", "/api-docs", "/settings?tab=tokens"} {
		for _, method := range []string{http.MethodGet, http.MethodHead} {
			res := do(t, h, method, target)
			if res.StatusCode != http.StatusOK || !strings.HasPrefix(res.Header.Get("Content-Type"), "text/html") {
				t.Errorf("%s %s: status %d type %q", method, target, res.StatusCode, res.Header.Get("Content-Type"))
			}
			if method == http.MethodGet && body(t, res) != indexHTML {
				t.Errorf("%s: body is not the index", target)
			}
			if res.Header.Get("Cache-Control") != "no-cache" {
				t.Errorf("%s: Cache-Control %q", target, res.Header.Get("Cache-Control"))
			}
		}
	}
}

func TestStaticFilesServedWithNosniff(t *testing.T) {
	h := Handler(builtApp())
	res := do(t, h, http.MethodGet, "/_app/version.json")
	if res.StatusCode != http.StatusOK || body(t, res) != `{"version":"1"}` {
		t.Fatalf("status %d", res.StatusCode)
	}
	if ct := res.Header.Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
		t.Errorf("Content-Type %q", ct)
	}
	if res.Header.Get("X-Content-Type-Options") != "nosniff" {
		t.Error("missing nosniff")
	}
	if cc := res.Header.Get("Cache-Control"); cc != "" {
		t.Errorf("non-immutable asset has Cache-Control %q", cc)
	}
	head := do(t, h, http.MethodHead, "/favicon.svg")
	if head.StatusCode != http.StatusOK || head.ContentLength != int64(len("<svg/>")) || body(t, head) != "" {
		t.Errorf("HEAD favicon: status %d length %d", head.StatusCode, head.ContentLength)
	}
}

func TestImmutableAssetsGetLongCache(t *testing.T) {
	h := Handler(builtApp())
	res := do(t, h, http.MethodGet, "/_app/immutable/entry/app.abc123.js")
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status %d", res.StatusCode)
	}
	if cc := res.Header.Get("Cache-Control"); cc != "public, max-age=31536000, immutable" {
		t.Errorf("Cache-Control %q", cc)
	}
	if ct := res.Header.Get("Content-Type"); !strings.Contains(ct, "javascript") {
		t.Errorf("Content-Type %q", ct)
	}
}

func TestRangeRequestsOnAssets(t *testing.T) {
	res := do(t, Handler(builtApp()), http.MethodGet, "/_app/immutable/entry/app.abc123.js", "Range", "bytes=0-3")
	if res.StatusCode != http.StatusPartialContent || body(t, res) != "cons" {
		t.Errorf("status %d", res.StatusCode)
	}
	if cr := res.Header.Get("Content-Range"); cr != "bytes 0-3/25" {
		t.Errorf("Content-Range %q", cr)
	}
}

func TestAPIMissesAreJSON404(t *testing.T) {
	h := Handler(builtApp())
	for _, tc := range []struct{ method, target string }{
		{http.MethodGet, "/api"},
		{http.MethodGet, "/api/"},
		{http.MethodGet, "/api/models/alice/nope"},
		{http.MethodHead, "/api/whoami-v3"},
		{http.MethodPost, "/api/nope"},
	} {
		res := do(t, h, tc.method, tc.target)
		if res.StatusCode != http.StatusNotFound {
			t.Errorf("%s %s: status %d", tc.method, tc.target, res.StatusCode)
		}
		if ct := res.Header.Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
			t.Errorf("%s %s: Content-Type %q", tc.method, tc.target, ct)
		}
		if tc.method != http.MethodHead && body(t, res) != `{"error":"Not Found"}`+"\n" {
			t.Errorf("%s %s: body %q", tc.method, tc.target, body(t, res))
		}
	}
}

func TestOtherMethodsAre405WithAllow(t *testing.T) {
	h := Handler(builtApp())
	for _, tc := range []struct{ method, target string }{
		{http.MethodPost, "/"},
		{http.MethodPut, "/models"},
		{http.MethodDelete, "/_app/version.json"},
		{http.MethodOptions, "/index.html"},
	} {
		res := do(t, h, tc.method, tc.target)
		if res.StatusCode != http.StatusMethodNotAllowed || res.Header.Get("Allow") != "GET, HEAD" {
			t.Errorf("%s %s: status %d Allow %q", tc.method, tc.target, res.StatusCode, res.Header.Get("Allow"))
		}
	}
}

func assertPlain404(t *testing.T, h http.Handler, target string) {
	t.Helper()
	for _, method := range []string{http.MethodGet, http.MethodHead} {
		res := do(t, h, method, target)
		if res.StatusCode != http.StatusNotFound {
			t.Errorf("%s %s: status %d, want 404", method, target, res.StatusCode)
		}
		if ct := res.Header.Get("Content-Type"); strings.Contains(ct, "html") {
			t.Errorf("%s %s: Content-Type %q must not be HTML", method, target, ct)
		}
		if res.Header.Get("X-Content-Type-Options") != "nosniff" {
			t.Errorf("%s %s: missing nosniff", method, target)
		}
		if b := body(t, res); strings.Contains(b, "<html") {
			t.Errorf("%s %s: HTML body served", method, target)
		}
	}
}

func TestMissingAppAssetsAre404NotIndex(t *testing.T) {
	h := Handler(builtApp())
	for _, target := range []string{"/_app", "/_app/", "/_app/immutable/", "/_app/immutable/entry/app.zzz999.js", "/_app/nope.json", "/_app/index.html"} {
		assertPlain404(t, h, target)
	}
}

func TestHubProtocolPathsAre404NotIndex(t *testing.T) {
	h := Handler(builtApp())
	for _, target := range []string{
		"/alice/repo/resolve/main/model.safetensors",
		"/datasets/alice/repo/resolve/main/data.parquet",
		"/alice/repo.git",
		"/alice/repo.git/info/refs?service=git-upload-pack",
		"/alice/repo/info/refs?service=git-upload-pack",
		"/spaces/alice/demo/info/lfs/objects/batch",
		"/alice/repo/git-upload-pack",
		"/alice/repo/git-receive-pack",
		"/objects/abc",
		"/v1/xorbs/default/abc",
		"/v2/x",
		"/shards",
		"/reconstructions/abc",
		"/xet-bridge/abc",
		"/internal/gc/prune",
		"/avatars/abc123.svg",
	} {
		assertPlain404(t, h, target)
	}
	// Page paths that merely resemble hub routes still get the SPA.
	for _, target := range []string{"/alice/repo/tree/main/resolve", "/objectsview", "/internals", "/avatars/abc.png", "/alice/repo.gitea"} {
		if res := do(t, h, http.MethodGet, target); res.StatusCode != http.StatusOK || !strings.HasPrefix(res.Header.Get("Content-Type"), "text/html") {
			t.Errorf("GET %s: status %d type %q, want index", target, res.StatusCode, res.Header.Get("Content-Type"))
		}
	}
}

func TestHubRoutePatternMatchesNginxTemplate(t *testing.T) {
	tmpl, err := os.ReadFile(filepath.Join("..", "..", "deploy", "nginx.conf.template"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(tmpl), `location ~ "`+hubRoutePattern+`"`) {
		t.Fatalf("hubRoutePattern is out of sync with deploy/nginx.conf.template:\n%s", hubRoutePattern)
	}
}

func TestDirectoriesAreNeverListed(t *testing.T) {
	app := builtApp()
	app["docs/guide.txt"] = &fstest.MapFile{Data: []byte("guide")}
	h := Handler(app)
	for _, target := range []string{"/docs", "/docs/"} {
		res := do(t, h, http.MethodGet, target)
		if res.StatusCode != http.StatusOK || body(t, res) != indexHTML {
			t.Errorf("GET %s: status %d, want SPA index", target, res.StatusCode)
		}
	}
	if res := do(t, h, http.MethodGet, "/docs/guide.txt"); res.StatusCode != http.StatusOK || body(t, res) != "guide" {
		t.Errorf("file inside directory: status %d", res.StatusCode)
	}
}

func TestPathTraversalStaysInsideBundle(t *testing.T) {
	h := Handler(builtApp())
	for _, target := range []string{"/../index.html", "/_app/../../etc/passwd", "/_app/%2e%2e/%2e%2e/etc/passwd", "/%2e%2e/%2e%2e/etc/passwd"} {
		res := do(t, h, http.MethodGet, target)
		if res.StatusCode != http.StatusOK && res.StatusCode != http.StatusNotFound {
			t.Errorf("GET %s: status %d", target, res.StatusCode)
		}
		if b := body(t, res); res.StatusCode == http.StatusOK && b != indexHTML {
			t.Errorf("GET %s: unexpected body %q", target, b)
		}
	}
}

func TestMissingBuildIs503ButAPIAndAssetsStillMiss(t *testing.T) {
	h := Handler(fstest.MapFS{".gitkeep": {}})
	for _, target := range []string{"/", "/index.html", "/models"} {
		res := do(t, h, http.MethodGet, target)
		if res.StatusCode != http.StatusServiceUnavailable || !strings.Contains(body(t, res), "not built") {
			t.Errorf("GET %s: status %d", target, res.StatusCode)
		}
	}
	if res := do(t, h, http.MethodGet, "/api/models"); res.StatusCode != http.StatusNotFound || !strings.HasPrefix(res.Header.Get("Content-Type"), "application/json") {
		t.Errorf("API miss without build: status %d type %q", res.StatusCode, res.Header.Get("Content-Type"))
	}
	assertPlain404(t, h, "/_app/immutable/entry/app.js")
}
