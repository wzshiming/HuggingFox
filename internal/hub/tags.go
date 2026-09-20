package hub

import (
	"cmp"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strings"

	"github.com/gorilla/mux"
	"github.com/matrixhub-ai/hfd/pkg/permission"
	"github.com/matrixhub-ai/hfd/pkg/repository"
)

// tagCategories lists the keys of the Hub's tags-by-type response per repository type; every key is always present.
var tagCategories = map[string][]string{
	"models":   {"region", "library", "other", "license", "language", "deploy", "dataset", "bucket", "pipeline_tag"},
	"datasets": {"library", "license", "language", "other", "task_ids", "task_categories", "size_categories", "format", "modality", "benchmark"},
}

type taskInfo struct{ label, subType string }

// pipelineTaxonomy is the Hub task taxonomy shared by model pipeline tags and dataset task categories.
var pipelineTaxonomy = map[string]taskInfo{
	"text-classification":            {"Text Classification", "nlp"},
	"token-classification":           {"Token Classification", "nlp"},
	"table-question-answering":       {"Table Question Answering", "nlp"},
	"question-answering":             {"Question Answering", "nlp"},
	"zero-shot-classification":       {"Zero-Shot Classification", "nlp"},
	"translation":                    {"Translation", "nlp"},
	"summarization":                  {"Summarization", "nlp"},
	"feature-extraction":             {"Feature Extraction", "nlp"},
	"text-generation":                {"Text Generation", "nlp"},
	"fill-mask":                      {"Fill-Mask", "nlp"},
	"sentence-similarity":            {"Sentence Similarity", "nlp"},
	"text-ranking":                   {"Text Ranking", "nlp"},
	"table-to-text":                  {"table-to-text", "nlp"},
	"multiple-choice":                {"multiple-choice", "nlp"},
	"text-retrieval":                 {"text-retrieval", "nlp"},
	"text-to-speech":                 {"Text-to-Speech", "audio"},
	"text-to-audio":                  {"Text-to-Audio", "audio"},
	"automatic-speech-recognition":   {"Automatic Speech Recognition", "audio"},
	"audio-to-audio":                 {"Audio-to-Audio", "audio"},
	"audio-classification":           {"Audio Classification", "audio"},
	"voice-activity-detection":       {"Voice Activity Detection", "audio"},
	"depth-estimation":               {"Depth Estimation", "cv"},
	"image-classification":           {"Image Classification", "cv"},
	"object-detection":               {"Object Detection", "cv"},
	"image-segmentation":             {"Image Segmentation", "cv"},
	"text-to-image":                  {"Text-to-Image", "cv"},
	"image-to-text":                  {"Image-to-Text", "cv"},
	"image-to-image":                 {"Image-to-Image", "cv"},
	"image-to-video":                 {"Image-to-Video", "cv"},
	"unconditional-image-generation": {"Unconditional Image Generation", "cv"},
	"video-classification":           {"Video Classification", "cv"},
	"text-to-video":                  {"Text-to-Video", "cv"},
	"zero-shot-image-classification": {"Zero-Shot Image Classification", "cv"},
	"mask-generation":                {"Mask Generation", "cv"},
	"zero-shot-object-detection":     {"Zero-Shot Object Detection", "cv"},
	"text-to-3d":                     {"Text-to-3D", "cv"},
	"image-to-3d":                    {"Image-to-3D", "cv"},
	"image-feature-extraction":       {"Image Feature Extraction", "cv"},
	"keypoint-detection":             {"Keypoint Detection", "cv"},
	"video-to-video":                 {"Video-to-Video", "cv"},
	"audio-text-to-text":             {"Audio-Text-to-Text", "multimodal"},
	"image-text-to-text":             {"Image-Text-to-Text", "multimodal"},
	"image-text-to-image":            {"Image-Text-to-Image", "multimodal"},
	"image-text-to-video":            {"Image-Text-to-Video", "multimodal"},
	"visual-question-answering":      {"Visual Question Answering", "multimodal"},
	"document-question-answering":    {"Document Question Answering", "multimodal"},
	"video-text-to-text":             {"Video-Text-to-Text", "multimodal"},
	"visual-document-retrieval":      {"Visual Document Retrieval", "multimodal"},
	"any-to-any":                     {"Any-to-Any", "multimodal"},
	"reinforcement-learning":         {"Reinforcement Learning", "rl"},
	"robotics":                       {"Robotics", "rl"},
	"tabular-classification":         {"Tabular Classification", "tabular"},
	"tabular-regression":             {"Tabular Regression", "tabular"},
	"time-series-forecasting":        {"Time Series Forecasting", "tabular"},
	"tabular-to-text":                {"tabular-to-text", "tabular"},
	"graph-ml":                       {"Graph Machine Learning", "other"},
}

// libraryLabels maps the Hub's model library tags to their display labels.
var libraryLabels = map[string]string{
	"pytorch": "PyTorch", "tf": "TensorFlow", "jax": "JAX", "safetensors": "Safetensors",
	"transformers": "Transformers", "peft": "PEFT", "gguf": "GGUF", "tensorboard": "TensorBoard",
	"diffusers": "Diffusers", "onnx": "ONNX", "stable-baselines3": "stable-baselines3",
	"sentence-transformers": "sentence-transformers", "mlx": "MLX", "ml-agents": "ml-agents",
	"keras": "Keras", "tf-keras": "TF-Keras", "joblib": "Joblib", "transformers.js": "Transformers.js",
	"adapter-transformers": "Adapters", "timm": "timm", "openvino": "OpenVINO", "setfit": "setfit",
	"sample-factory": "sample-factory", "coreml": "Core ML", "tflite": "LiteRT", "nemo": "NeMo",
	"flair": "Flair", "fastai": "fastai", "espnet": "ESPnet", "rust": "Rust", "sklearn": "Scikit-learn",
	"bertopic": "BERTopic", "spacy": "spaCy", "fasttext": "fastText", "open_clip": "OpenCLIP",
	"executorch": "ExecuTorch", "keras-hub": "KerasHub", "asteroid": "Asteroid", "speechbrain": "speechbrain",
	"allennlp": "AllenNLP", "llamafile": "llamafile", "paddlepaddle": "PaddlePaddle", "PaddleOCR": "PaddleOCR",
	"fairseq": "Fairseq", "stanza": "Stanza", "pyannote-audio": "pyannote.audio", "optimum_habana": "Habana",
	"span-marker": "SpanMarker", "optimum_graphcore": "Graphcore", "paddlenlp": "paddlenlp",
	"unity-sentis": "unity-sentis", "dduf": "DDUF", "univa": "univa",
}

// tagFacet is one entry of a tags-by-type category.
type tagFacet struct {
	ID        string `json:"id"`
	Label     string `json:"label"`
	Type      string `json:"type"`
	SubType   string `json:"subType,omitempty"`
	Clickable bool   `json:"clickable,omitempty"`
}

// handleTagsByType serves GET /api/{models|datasets}-tags-by-type from the facets of the local repositories.
func (h *Handler) handleTagsByType(w http.ResponseWriter, r *http.Request) {
	repoType := mux.Vars(r)["repoType"]
	if !h.allow(w, r, permission.OperationListRepos, repoType, permission.Context{}) {
		return
	}
	fsys := h.opts.Storage.RepositoriesFS()
	refs, err := listRepos(r.Context(), fsys, repoType, "")
	if err != nil {
		respond(w, err, http.StatusInternalServerError)
		return
	}
	facets := map[string]map[string]tagFacet{}
	for _, ref := range refs {
		repo, err := repository.Open(fsys, ref.path)
		if errors.Is(err, repository.ErrRepositoryNotExists) {
			// Only a repository removed since enumeration is skipped; any other failure is a storage error.
			continue
		}
		if err != nil {
			respond(w, fmt.Errorf("failed to open repository %q: %v", ref.id, err), http.StatusInternalServerError)
			return
		}
		for _, f := range facetsOf(repoType, readMeta(repo, repo.DefaultBranch(), repoType)) {
			if facets[f.Type] == nil {
				facets[f.Type] = map[string]tagFacet{}
			}
			facets[f.Type][f.ID] = f
		}
	}
	out := map[string][]tagFacet{}
	for _, category := range tagCategories[repoType] {
		items := make([]tagFacet, 0, len(facets[category]))
		for _, f := range facets[category] {
			items = append(items, f)
		}
		slices.SortFunc(items, func(a, b tagFacet) int { return strings.Compare(a.ID, b.ID) })
		out[category] = items
	}
	respond(w, out, http.StatusOK)
}

// facetsOf classifies one repository's tags: models keep language, pipeline, library and deploy ids bare, datasets carry the field prefix; prefixed tags outside the type's categories are not facets.
func facetsOf(repoType string, m repoMeta) []tagFacet {
	var out []tagFacet
	for _, tag := range m.tags {
		prefix, value, prefixed := strings.Cut(tag, ":")
		_, isTask := pipelineTaxonomy[tag]
		_, isLibrary := libraryLabels[tag]
		isModel := repoType == "models"
		var f tagFacet
		switch {
		case isModel && m.card != nil && slices.Contains(m.card.Language, tag):
			f = tagFacet{ID: tag, Label: tag, Type: "language"}
		case isModel && (tag == m.pipelineTag || isTask):
			f = tagFacet{ID: tag, Label: taskLabel(tag), Type: "pipeline_tag", SubType: pipelineTaxonomy[tag].subType}
		case isModel && (tag == m.libraryName || isLibrary):
			f = tagFacet{ID: tag, Label: cmp.Or(libraryLabels[tag], tag), Type: "library"}
		case isModel && tag == "endpoints_compatible":
			f = tagFacet{ID: tag, Label: "Inference Endpoints", Type: "deploy", Clickable: true}
		case prefixed:
			if !slices.Contains(tagCategories[repoType], prefix) {
				continue
			}
			f = tagFacet{ID: tag, Label: value, Type: prefix}
			switch prefix {
			case "task_categories":
				f.Label, f.SubType = taskLabel(value), pipelineTaxonomy[value].subType
			case "size_categories":
				f.Label = sizeLabel(value)
			}
		default:
			f = tagFacet{ID: tag, Label: tag, Type: "other", Clickable: true}
		}
		out = append(out, f)
	}
	return out
}

func taskLabel(task string) string {
	if info, ok := pipelineTaxonomy[task]; ok {
		return info.label
	}
	return task
}

// sizeLabel renders "n<1K" as "< 1K", "n>1T" as "> 1T" and "1K<n<10K" as "1K - 10K".
func sizeLabel(size string) string {
	switch {
	case strings.HasPrefix(size, "n<"):
		return "< " + size[2:]
	case strings.HasPrefix(size, "n>"):
		return "> " + size[2:]
	}
	return strings.Replace(size, "<n<", " - ", 1)
}
