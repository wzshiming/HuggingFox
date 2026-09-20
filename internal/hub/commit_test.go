package hub

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/matrixhub-ai/hfd/pkg/permission"
)

// recordingNext captures what reaches hfd's commit handler: the request count and the body bytes it can read.
func recordingNext(bodies *[]string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		*bodies = append(*bodies, string(b))
		w.WriteHeader(http.StatusTeapot)
	})
}

func commitBody(parent string) string {
	return `{"key":"header","value":{"summary":"Edit","parentCommit":"` + parent + `"}}` + "\n" +
		`{"key":"file","value":{"path":"README.md","content":"IyBEZW1v","encoding":"base64"}}` + "\n"
}

func TestCommitStaleParentIsPreconditionFailedBeforeHFD(t *testing.T) {
	var checks, bodies []string
	h, st := newHub(t, Options{Permission: recordChecks(&checks, nil), Next: recordingNext(&bodies)})
	old := seed(t, st, "alice/m1", map[string]string{"README.md": "# Demo\n"}, day1)
	tip := seed(t, st, "alice/m1", map[string]string{"README.md": "# Demo\n\nSomeone else.\n"}, day2)
	seedBranch(t, st, "alice/m1", "feat/branch", map[string]string{"notes.txt": "n"}, day3)

	const target = "/api/models/alice/m1/commit/main"
	var body map[string]string
	decode(t, do(t, h, http.MethodPost, target, commitBody(old), "Content-Type", "application/x-ndjson"), http.StatusPreconditionFailed, &body)
	if !strings.Contains(body["error"], old) || !strings.Contains(body["error"], tip) {
		t.Errorf("412 body %v must name both commits", body)
	}
	if len(bodies) != 0 {
		t.Fatalf("stale commit reached hfd: %q", bodies)
	}
	if !strings.Contains(strings.Join(checks, "\n"), "update_repo alice/m1  main") {
		t.Errorf("write permission not checked first: %v", checks)
	}

	// A slash branch arrives percent-encoded and is compared with its own tip, never main's.
	if rec := do(t, h, http.MethodPost, "/api/models/alice/m1/commit/feat%2Fbranch", commitBody(tip), "Content-Type", "application/x-ndjson"); rec.Code != http.StatusPreconditionFailed {
		t.Errorf("slash branch stale parent: %d %s", rec.Code, rec.Body)
	}

	// Everything else reaches hfd with the body intact: matching parent, no parent, unborn branch, header not first, oversized first line.
	long := `{"key":"file","value":{"path":"big.txt","content":"` + strings.Repeat("A", 70<<10) + `","encoding":"base64"}}` + "\n" + commitBody(old)
	for _, tc := range []struct{ target, body string }{
		{target, commitBody(tip)},
		{target, commitBody("")},
		{target, `{"key":"header","value":{"summary":"Edit"}}` + "\n"},
		{"/api/models/alice/m1/commit/new-branch", commitBody(old)},
		{target, `{"key":"file","value":{"path":"a","content":"a"}}` + "\n" + commitBody(old)},
		{target, long},
		{target, `{"key":"header","value":{"summary":"Edit","parentCommit":"` + tip + `"}}`},
		{target, ""},
	} {
		bodies = nil
		rec := do(t, h, http.MethodPost, tc.target, tc.body, "Content-Type", "application/x-ndjson")
		if rec.Code != http.StatusTeapot || len(bodies) != 1 || bodies[0] != tc.body {
			t.Errorf("%s %q...: %d, hfd saw %d bodies (intact: %v)", tc.target, tc.body[:min(40, len(tc.body))], rec.Code, len(bodies), len(bodies) == 1 && bodies[0] == tc.body)
		}
	}

	// hfd answers for repositories that do not exist locally.
	bodies = nil
	if rec := do(t, h, http.MethodPost, "/api/models/alice/nope/commit/main", commitBody(old), "Content-Type", "application/x-ndjson"); rec.Code != http.StatusTeapot || len(bodies) != 1 {
		t.Errorf("missing repository: %d, hfd saw %d", rec.Code, len(bodies))
	}
}

func TestCommitDeniedWriterNeverReachesHFDOrReadsTheBody(t *testing.T) {
	var bodies []string
	h, st := newHub(t, Options{
		Permission: recordChecks(new([]string), func(op permission.Operation, name string) (bool, error) {
			return op != permission.OperationUpdateRepo, nil
		}),
		Next: recordingNext(&bodies),
	})
	old := seed(t, st, "alice/m1", map[string]string{"README.md": "# Demo\n"}, day1)
	seed(t, st, "alice/m1", map[string]string{"README.md": "# Demo 2\n"}, day2)
	req := httptest.NewRequest(http.MethodPost, "/api/models/alice/m1/commit/main", strings.NewReader(commitBody(old)))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	var body map[string]string
	decode(t, rec, http.StatusForbidden, &body)
	if body["error"] != "permission denied" || len(bodies) != 0 {
		t.Errorf("denied: %v, hfd saw %d", body, len(bodies))
	}
	if rest, _ := io.ReadAll(req.Body); string(rest) != commitBody(old) {
		t.Errorf("body consumed before the permission check: %q", rest)
	}
}

// shortBody reports err together with its last bytes and io.EOF afterwards, the way net/http's body reports a connection closed short of its Content-Length.
type shortBody struct {
	data []byte
	err  error
}

func (b *shortBody) Read(p []byte) (int, error) {
	if len(b.data) == 0 {
		return 0, io.EOF
	}
	n := copy(p, b.data)
	b.data = b.data[n:]
	if len(b.data) == 0 {
		return n, b.err
	}
	return n, nil
}

func TestCommitPeekReplaysTheBodyReadError(t *testing.T) {
	var got []byte
	var gotErr error
	h, st := newHub(t, Options{Next: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got, gotErr = io.ReadAll(r.Body)
		w.WriteHeader(http.StatusTeapot)
	})})
	tip := seed(t, st, "alice/m1", map[string]string{"README.md": "# Demo\n"}, day1)
	header := `{"key":"header","value":{"summary":"Edit","parentCommit":"` + tip + `"}}`
	op := `{"key":"file","value":{"path":"README.md","content":"partial-upload","encoding":"utf-8"}}`
	for _, payload := range []string{header, op, header + "\n" + op} {
		got, gotErr = nil, nil
		req := httptest.NewRequest(http.MethodPost, "/api/models/alice/m1/commit/main", &shortBody{data: []byte(payload), err: io.ErrUnexpectedEOF})
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusTeapot || string(got) != payload || gotErr != io.ErrUnexpectedEOF {
			t.Errorf("%.24s...: %d, hfd read %q then %v, want the body's unexpected EOF after its bytes", payload, rec.Code, got, gotErr)
		}
	}
}
