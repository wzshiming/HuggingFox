package hub

import (
	"context"
	"fmt"
	"net/http"
	"slices"
	"testing"

	"github.com/matrixhub-ai/hfd/pkg/permission"
)

func TestQuicksearchCountsLimitsAndTypes(t *testing.T) {
	h, st := newHub(t, Options{})
	for i := 1; i <= 7; i++ {
		seed(t, st, fmt.Sprintf("alice/chat-%d", i), map[string]string{"README.md": "x"}, day1)
	}
	seed(t, st, "bob/other", map[string]string{"README.md": "x"}, day1)
	seed(t, st, "datasets/alice/chat-d", map[string]string{"README.md": "x"}, day1)
	seed(t, st, "spaces/bob/Chatty", map[string]string{"README.md": "x"}, day1)

	var res map[string]any
	decode(t, do(t, h, http.MethodGet, "/api/quicksearch?q=chat", ""), http.StatusOK, &res)
	if got, want := keysOf(res), []string{"datasets", "datasetsCount", "models", "modelsCount", "orgs", "q", "spaces", "spacesCount", "users"}; !slices.Equal(got, want) {
		t.Fatalf("keys %v, want %v", got, want)
	}
	models := res["models"].([]any)
	if len(models) != 5 || res["modelsCount"] != float64(7) || res["q"] != "chat" {
		t.Errorf("models %v count %v", models, res["modelsCount"])
	}
	if first := models[0].(map[string]any); first["id"] != "alice/chat-1" || first["private"] != false || len(first) != 2 {
		t.Errorf("first model %v", first)
	}
	if ds := res["datasets"].([]any); len(ds) != 1 || ds[0].(map[string]any)["id"] != "alice/chat-d" || res["datasetsCount"] != float64(1) {
		t.Errorf("datasets %v", res["datasets"])
	}
	if sp := res["spaces"].([]any); len(sp) != 1 || sp[0].(map[string]any)["id"] != "bob/Chatty" || res["spacesCount"] != float64(1) {
		t.Errorf("spaces %v", res["spaces"])
	}
	if len(res["orgs"].([]any)) != 0 || len(res["users"].([]any)) != 0 {
		t.Errorf("orgs/users %v %v", res["orgs"], res["users"])
	}

	decode(t, do(t, h, http.MethodGet, "/api/quicksearch?q=CHAT&type=model&limit=2", ""), http.StatusOK, &res)
	if len(res["models"].([]any)) != 2 || res["modelsCount"] != float64(7) || len(res["datasets"].([]any)) != 0 || res["datasetsCount"] != float64(0) || res["spacesCount"] != float64(0) {
		t.Errorf("typed search %v", res)
	}
	decode(t, do(t, h, http.MethodGet, "/api/quicksearch?q=chat&type=space&limit=1000", ""), http.StatusOK, &res)
	if len(res["spaces"].([]any)) != 1 || res["modelsCount"] != float64(0) {
		t.Errorf("space search %v", res)
	}
	decode(t, do(t, h, http.MethodGet, "/api/quicksearch?q=chat&type=all&limit=100", ""), http.StatusOK, &res)
	if len(res["models"].([]any)) != 7 {
		t.Errorf("type=all %v", res["models"])
	}
	decode(t, do(t, h, http.MethodGet, "/api/quicksearch?q=", ""), http.StatusOK, &res)
	if len(res["models"].([]any)) != 0 || res["modelsCount"] != float64(0) || res["q"] != "" {
		t.Errorf("empty q %v", res)
	}
	for _, target := range []string{"/api/quicksearch?q=chat&limit=0", "/api/quicksearch?q=chat&limit=x", "/api/quicksearch?q=chat&type=paper"} {
		if rec := do(t, h, http.MethodGet, target, ""); rec.Code != http.StatusBadRequest {
			t.Errorf("%s: %d %s", target, rec.Code, rec.Body)
		}
	}
}

func TestQuicksearchPermissionDenialAndHookError(t *testing.T) {
	var checks []string
	var failSpaces bool
	h, st := newHub(t, Options{Permission: recordChecks(&checks, func(op permission.Operation, name string) (bool, error) {
		if name == "spaces" && failSpaces {
			return false, context.DeadlineExceeded
		}
		return name != "datasets", nil
	})})
	seed(t, st, "alice/chat", map[string]string{"README.md": "x"}, day1)
	seed(t, st, "datasets/alice/chat", map[string]string{"README.md": "x"}, day1)
	var res map[string]any
	decode(t, do(t, h, http.MethodGet, "/api/quicksearch?q=chat", ""), http.StatusOK, &res)
	if res["modelsCount"] != float64(1) || res["datasetsCount"] != float64(0) || len(res["datasets"].([]any)) != 0 {
		t.Errorf("denied datasets must be empty: %v", res)
	}
	if !slices.Contains(checks, "list_repos datasets  ") {
		t.Errorf("checks %v", checks)
	}
	failSpaces = true
	rec := do(t, h, http.MethodGet, "/api/quicksearch?q=chat", "")
	var body map[string]any
	decode(t, rec, http.StatusInternalServerError, &body)
	if body["error"] == nil || body["models"] != nil {
		t.Errorf("hook error body %v", body)
	}
}
