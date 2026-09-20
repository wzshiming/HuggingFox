package hub

import (
	"net/http"
	"slices"
	"testing"

	"github.com/matrixhub-ai/hfd/pkg/permission"
)

func facetIDs(items []map[string]any) []string {
	var ids []string
	for _, it := range items {
		ids = append(ids, it["id"].(string))
	}
	return ids
}

func TestTagsByTypeFacets(t *testing.T) {
	h, st := newHub(t, Options{})
	seedShowcase(t, st)
	seed(t, st, "bob/m3", map[string]string{"README.md": "---\ntags: [endpoints_compatible, chat, region:us, arxiv:2310.06825]\nlibrary_name: peft\nlanguage: [fr, en]\n---\n"}, day1)

	var models map[string][]map[string]any
	decode(t, do(t, h, http.MethodGet, "/api/models-tags-by-type", ""), http.StatusOK, &models)
	if got, want := keysOf(anyMap(models)), []string{"bucket", "dataset", "deploy", "language", "library", "license", "other", "pipeline_tag", "region"}; !slices.Equal(got, want) {
		t.Fatalf("model categories %v, want %v", got, want)
	}
	for cat, want := range map[string][]string{
		"pipeline_tag": {"text-generation"},
		"library":      {"peft", "transformers"},
		"language":     {"en", "fr"},
		"license":      {"license:mit"},
		"dataset":      {"dataset:alice/d1"},
		"deploy":       {"endpoints_compatible"},
		"region":       {"region:us"},
		"other":        {"awq", "chat", "llama"},
		"bucket":       nil,
	} {
		if got := facetIDs(models[cat]); !slices.Equal(got, want) {
			t.Errorf("models %s: %v, want %v", cat, got, want)
		}
		if models[cat] == nil {
			t.Errorf("models %s must be an array", cat)
		}
	}
	pt := models["pipeline_tag"][0]
	if pt["label"] != "Text Generation" || pt["type"] != "pipeline_tag" || pt["subType"] != "nlp" || pt["clickable"] != nil {
		t.Errorf("pipeline facet %v", pt)
	}
	if lib := models["library"][0]; lib["label"] != "PEFT" || lib["type"] != "library" {
		t.Errorf("library facet %v", lib)
	}
	if dep := models["deploy"][0]; dep["label"] != "Inference Endpoints" || dep["clickable"] != true || dep["type"] != "deploy" {
		t.Errorf("deploy facet %v", dep)
	}
	if lic := models["license"][0]; lic["label"] != "mit" || lic["type"] != "license" {
		t.Errorf("license facet %v", lic)
	}
	if other := models["other"][1]; other["label"] != "chat" || other["clickable"] != true {
		t.Errorf("other facet %v", other)
	}

	var datasets map[string][]map[string]any
	decode(t, do(t, h, http.MethodGet, "/api/datasets-tags-by-type", ""), http.StatusOK, &datasets)
	if got, want := keysOf(anyMap(datasets)), []string{"benchmark", "format", "language", "library", "license", "modality", "other", "size_categories", "task_categories", "task_ids"}; !slices.Equal(got, want) {
		t.Fatalf("dataset categories %v, want %v", got, want)
	}
	for cat, want := range map[string][]string{
		"task_categories": {"task_categories:text-classification"},
		"task_ids":        {"task_ids:sentiment-classification"},
		"language":        {"language:en"},
		"license":         {"license:other"},
		"size_categories": {"size_categories:1K<n<10K"},
		"library":         {"library:datasets"},
		"other":           {"qa"},
		"format":          nil,
	} {
		if got := facetIDs(datasets[cat]); !slices.Equal(got, want) {
			t.Errorf("datasets %s: %v, want %v", cat, got, want)
		}
	}
	if tc := datasets["task_categories"][0]; tc["label"] != "Text Classification" || tc["subType"] != "nlp" || tc["type"] != "task_categories" {
		t.Errorf("task_categories facet %v", tc)
	}
	if sc := datasets["size_categories"][0]; sc["label"] != "1K - 10K" {
		t.Errorf("size_categories facet %v", sc)
	}
	if lang := datasets["language"][0]; lang["label"] != "en" {
		t.Errorf("language facet %v", lang)
	}
}

func TestTagsByTypeEmptyAndDenied(t *testing.T) {
	h, _ := newHub(t, Options{Permission: recordChecks(new([]string), func(op permission.Operation, name string) (bool, error) {
		return name != "datasets", nil
	})})
	var models map[string][]map[string]any
	decode(t, do(t, h, http.MethodGet, "/api/models-tags-by-type", ""), http.StatusOK, &models)
	if len(models) != 9 {
		t.Errorf("empty hub categories %v", models)
	}
	for cat, items := range models {
		if items == nil || len(items) != 0 {
			t.Errorf("%s: %v", cat, items)
		}
	}
	if rec := do(t, h, http.MethodGet, "/api/datasets-tags-by-type", ""); rec.Code != http.StatusForbidden {
		t.Errorf("denied datasets: %d", rec.Code)
	}
}

func anyMap[V any](m map[string]V) map[string]any {
	out := make(map[string]any, len(m))
	for k, v := range m {
		out[k] = v
	}
	return out
}
