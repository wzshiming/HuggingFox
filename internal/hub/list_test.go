package hub

import (
	"net/http"
	"slices"
	"strings"
	"testing"

	"github.com/matrixhub-ai/hfd/pkg/storage"
)

const (
	modelCard = "---\nlicense: mit\nlanguage: en\npipeline_tag: text-generation\nlibrary_name: transformers\ntags: [chat]\ndatasets: [alice/d1]\n---\n# m1\n\nA chat model.\n"
	dataCard  = "---\ntask_categories: [text-classification]\ntask_ids: [sentiment-classification]\nlanguage: [en]\nlicense: other\nsize_categories: [1K<n<10K]\nlibrary_name: datasets\ntags: [qa]\npaperswithcode_id: imdb\n---\n# Dataset Card for d1\n\nLarge movie reviews.\nSecond line.\n\nMore text.\n"
	spaceCard = "---\nsdk: gradio\ntitle: S1\nmodels: [alice/m1]\n---\n# S1\n"
)

func seedShowcase(t *testing.T, st *storage.Storage) {
	t.Helper()
	seed(t, st, "alice/m1", map[string]string{"README.md": modelCard, "config.json": `{"model_type":"llama","quantization_config":{"quant_method":"awq"}}`, "sub/dir/w.bin": "w"}, day1)
	seed(t, st, "datasets/alice/d1", map[string]string{"README.md": dataCard}, day2)
	seed(t, st, "spaces/alice/s1", map[string]string{"README.md": spaceCard, "app.py": "print(1)\n"}, day3)
}

func TestListDefaultAndFullProjections(t *testing.T) {
	h, st := newHub(t, Options{})
	seedShowcase(t, st)

	m := listItems(t, h, "/api/models")[0]
	if got, want := keysOf(m), []string{"createdAt", "downloads", "id", "library_name", "likes", "modelId", "pipeline_tag", "private", "tags", "trendingScore"}; !slices.Equal(got, want) {
		t.Errorf("model default keys %v, want %v", got, want)
	}
	if m["modelId"] != "alice/m1" || m["pipeline_tag"] != "text-generation" || m["library_name"] != "transformers" || m["private"] != false || m["createdAt"] != "2024-01-01T12:00:00.000Z" {
		t.Errorf("model default values %v", m)
	}
	wantTags := []any{"chat", "en", "license:mit", "text-generation", "transformers", "dataset:alice/d1", "llama", "awq"}
	if got := m["tags"].([]any); !slices.Equal(got, wantTags) {
		t.Errorf("model tags %v, want %v", got, wantTags)
	}
	m = listItems(t, h, "/api/models?full=true")[0]
	if got, want := keysOf(m), []string{"author", "createdAt", "downloads", "gated", "id", "lastModified", "library_name", "likes", "modelId", "pipeline_tag", "private", "sha", "siblings", "tags", "trendingScore"}; !slices.Equal(got, want) {
		t.Errorf("model full keys %v, want %v", got, want)
	}
	if m["author"] != "alice" || m["lastModified"] != "2024-01-01T12:00:00.000Z" || len(m["sha"].(string)) != 40 {
		t.Errorf("model full values %v", m)
	}
	var files []string
	for _, s := range m["siblings"].([]any) {
		files = append(files, s.(map[string]any)["rfilename"].(string))
	}
	if want := []string{"README.md", "config.json", "sub/dir/w.bin"}; !slices.Equal(files, want) {
		t.Errorf("siblings %v, want %v", files, want)
	}

	d := listItems(t, h, "/api/datasets")[0]
	if got, want := keysOf(d), []string{"author", "createdAt", "description", "disabled", "downloads", "gated", "id", "lastModified", "likes", "paperswithcode_id", "private", "sha", "tags", "trendingScore"}; !slices.Equal(got, want) {
		t.Errorf("dataset default keys %v, want %v", got, want)
	}
	if d["description"] != "Large movie reviews.\nSecond line." || d["paperswithcode_id"] != "imdb" || d["author"] != "alice" {
		t.Errorf("dataset default values %v", d)
	}
	wantTags = []any{"task_categories:text-classification", "task_ids:sentiment-classification", "language:en", "license:other", "size_categories:1K<n<10K", "library:datasets", "qa"}
	if got := d["tags"].([]any); !slices.Equal(got, wantTags) {
		t.Errorf("dataset tags %v, want %v", got, wantTags)
	}
	d = listItems(t, h, "/api/datasets?full=1")[0]
	card, ok := d["cardData"].(map[string]any)
	if !ok || card["pretty_name"] != nil || card["paperswithcode_id"] != "imdb" || card["license"] != "other" {
		t.Errorf("dataset full cardData %v", d["cardData"])
	}

	s := listItems(t, h, "/api/spaces")[0]
	if got, want := keysOf(s), []string{"createdAt", "id", "likes", "private", "sdk", "tags", "trendingScore"}; !slices.Equal(got, want) {
		t.Errorf("space default keys %v, want %v", got, want)
	}
	if s["sdk"] != "gradio" || !slices.Equal(s["tags"].([]any), []any{"gradio"}) {
		t.Errorf("space default values %v", s)
	}
	s = listItems(t, h, "/api/spaces?full=true")[0]
	if got, want := keysOf(s), []string{"author", "cardData", "createdAt", "id", "lastModified", "likes", "private", "sdk", "sha", "siblings", "tags", "trendingScore"}; !slices.Equal(got, want) {
		t.Errorf("space full keys %v, want %v", got, want)
	}
}

func TestListExpandProjection(t *testing.T) {
	h, st := newHub(t, Options{})
	seedShowcase(t, st)
	for target, want := range map[string][]string{
		"/api/models?expand[]=author&expand[]=lastModified":                                               {"author", "id", "lastModified", "trendingScore"},
		"/api/models?expand=createdAt&full=true":                                                          {"createdAt", "id", "trendingScore"},
		"/api/models?expand[]=safetensors":                                                                {"id", "trendingScore"},
		"/api/models?expand[]=private&expand[]=likes&expand[]=downloads&expand[]=gated&expand[]=disabled": {"disabled", "downloads", "gated", "id", "likes", "private", "trendingScore"},
		"/api/models?expand[]=cardData&expand[]=tags":                                                     {"cardData", "id", "tags", "trendingScore"},
		"/api/datasets?expand[]=description&expand[]=citation":                                            {"description", "id", "trendingScore"},
		"/api/spaces?expand[]=models&expand[]=sdk&expand[]=datasets":                                      {"id", "models", "sdk", "trendingScore"},
	} {
		items := listItems(t, h, target)
		if got := keysOf(items[0]); !slices.Equal(got, want) {
			t.Errorf("%s: keys %v, want %v", target, got, want)
		}
	}
	m := listItems(t, h, "/api/models?expand[]=private&expand[]=likes")[0]
	if m["private"] != false || m["likes"] != float64(0) {
		t.Errorf("requested zero values must stay: %v", m)
	}
	s := listItems(t, h, "/api/spaces?expand[]=models")[0]
	if !slices.Equal(s["models"].([]any), []any{"alice/m1"}) {
		t.Errorf("space models %v", s["models"])
	}
	for _, target := range []string{"/api/models?expand[]=bogus", "/api/models?expand[]=sdk", "/api/datasets?expand[]=pipeline_tag", "/api/spaces?expand[]=description"} {
		var body map[string]string
		decode(t, do(t, h, http.MethodGet, target, ""), http.StatusBadRequest, &body)
		if !strings.Contains(body["error"], "Invalid option") {
			t.Errorf("%s: %v", target, body)
		}
	}
}

func TestListToleratesBrokenAndEmptyCards(t *testing.T) {
	h, st := newHub(t, Options{})
	seed(t, st, "alice/good", map[string]string{"README.md": modelCard}, day1)
	seed(t, st, "alice/nan", map[string]string{"README.md": "---\nscore: .nan\nlicense: mit\n---\n"}, day1)
	seed(t, st, "alice/broken", map[string]string{"README.md": "---\n: : :\n  - [\n---\n# broken\n"}, day1)
	seed(t, st, "alice/plain", map[string]string{"weights.bin": "x", "config.json": "{not json"}, day1)
	seed(t, st, "datasets/alice/plain", map[string]string{"README.md": "# Title only\n\nJust prose here.\n"}, day1)
	if _, err := repositoryInit(st, "alice/empty"); err != nil {
		t.Fatal(err)
	}

	byID := map[string]map[string]any{}
	for _, item := range listItems(t, h, "/api/models?expand[]=cardData&expand[]=tags&expand[]=sha&expand[]=createdAt&expand[]=siblings") {
		byID[item["id"].(string)] = item
	}
	if len(byID) != 5 {
		t.Fatalf("items %v", byID)
	}
	if byID["alice/good"]["cardData"] == nil || byID["alice/nan"]["cardData"] != nil || !slices.Equal(byID["alice/nan"]["tags"].([]any), []any{"license:mit"}) {
		t.Errorf("NaN card must drop only its own cardData: good=%v nan=%v", byID["alice/good"]["cardData"], byID["alice/nan"])
	}
	if tags := byID["alice/broken"]["tags"].([]any); len(tags) != 0 {
		t.Errorf("broken card tags %v", tags)
	}
	if tags := byID["alice/plain"]["tags"].([]any); len(tags) != 0 || byID["alice/plain"]["cardData"] != nil {
		t.Errorf("plain repo %v", byID["alice/plain"])
	}
	empty := byID["alice/empty"]
	if _, has := empty["sha"]; has || empty["createdAt"] != nil || len(empty["tags"].([]any)) != 0 || len(empty["siblings"].([]any)) != 0 {
		t.Errorf("empty repo %v", empty)
	}
	d := listItems(t, h, "/api/datasets")[0]
	if d["description"] != "Just prose here." {
		t.Errorf("description without front matter %q", d["description"])
	}
}

func TestListFilters(t *testing.T) {
	h, st := newHub(t, Options{})
	seedShowcase(t, st)
	seed(t, st, "bob/m3", map[string]string{"README.md": "---\npipeline_tag: fill-mask\ntags: [text-generation, chat]\n---\n"}, day1)
	for target, want := range map[string][]string{
		"/api/models?filter=license:mit&filter=chat":                         {"alice/m1"},
		"/api/models?filter=chat":                                            {"alice/m1", "bob/m3"},
		"/api/models?filter=license:mit&filter=nonexistent":                  nil,
		"/api/models?pipeline_tag=text-generation":                           {"alice/m1"},
		"/api/models?filter=text-generation":                                 {"alice/m1", "bob/m3"},
		"/api/models?pipeline_tag=fill-mask&pipeline_tag=zzz":                {"bob/m3"},
		"/api/models?pipeline_tag=fill-mask&filter=license:mit":              nil,
		"/api/datasets?pipeline_tag=text-classification":                     nil,
		"/api/datasets?filter=task_categories:text-classification&filter=qa": {"alice/d1"},
		"/api/spaces?filter=gradio":                                          {"alice/s1"},
	} {
		if got := listIDs(t, h, target); !slices.Equal(got, want) {
			t.Errorf("%s: ids %v, want %v", target, got, want)
		}
	}
}
