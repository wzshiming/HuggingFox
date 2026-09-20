package hub

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"path"
	"slices"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/go-git/go-billy/v6"
	"github.com/matrixhub-ai/hfd/pkg/hfmeta"
	"github.com/matrixhub-ai/hfd/pkg/repository"
)

// typedRoots are the model-namespace directories reserved for the other repository types.
var typedRoots = map[string]bool{"datasets": true, "spaces": true}

// repoRef is one enumerated repository: its hub id and its bare path on the repositories filesystem.
type repoRef struct {
	id, path string
}

// listRepos enumerates the repositories of repoType in lexical id order, scoped to author when set.
// A missing root or author directory lists nothing; any other filesystem error is returned.
func listRepos(ctx context.Context, fsys billy.Filesystem, repoType, author string) ([]repoRef, error) {
	base := "/"
	if repoType != "models" {
		base = "/" + repoType
	}
	var roots []string
	if author != "" {
		if !validSegment(author) || (repoType == "models" && typedRoots[author]) {
			return nil, nil
		}
		roots = []string{path.Join(base, author)}
	} else {
		entries, err := fsys.ReadDir(base)
		if err != nil {
			if errors.Is(err, fs.ErrNotExist) {
				return nil, nil
			}
			return nil, err
		}
		sort.Slice(entries, func(i, j int) bool { return entries[i].Name() < entries[j].Name() })
		for _, e := range entries {
			if e.IsDir() && !(repoType == "models" && typedRoots[e.Name()]) {
				roots = append(roots, path.Join(base, e.Name()))
			}
		}
	}
	var refs []repoRef
	for _, root := range roots {
		err := repository.Walk(ctx, fsys, root, func(p string) error {
			refs = append(refs, repoRef{id: strings.TrimSuffix(strings.TrimPrefix(p, strings.TrimSuffix(base, "/")+"/"), ".git"), path: p})
			return nil
		})
		if err != nil && !errors.Is(err, fs.ErrNotExist) {
			return nil, err
		}
	}
	return refs, nil
}

// repoDates are the tip-derived dates of a repository; zero for an unborn default branch.
type repoDates struct {
	sha                     string
	lastModified, createdAt time.Time
}

// hubTime formats t the way the Hub reports dates.
func hubTime(t time.Time) string {
	return t.UTC().Format(repository.TimeFormat)
}

// Files larger than these are not parsed for metadata.
const (
	maxReadmeBytes = 2 << 20
	maxConfigBytes = 1 << 20
)

// repoMeta is what one repository's README.md front matter and config.json contribute to listings and facets.
type repoMeta struct {
	card                                       *hfmeta.Card   // nil without parseable front matter
	cardData                                   json.Marshaler // raw front matter; nil without one
	tags                                       []string
	pipelineTag, libraryName, sdk, description string
}

// readMeta collects metadata at rev; missing, oversized or malformed files contribute nothing rather than failing.
func readMeta(repo *repository.Repository, rev, repoType string) repoMeta {
	var m repoMeta
	seen := map[string]bool{}
	add := func(tags ...string) {
		for _, tag := range tags {
			if tag != "" && !seen[tag] {
				seen[tag] = true
				m.tags = append(m.tags, tag)
			}
		}
	}
	if data, ok := readBlob(repo, rev, "README.md", maxReadmeBytes); ok {
		body, hasCard := readmeBody(data)
		if rm, err := hfmeta.ParseReadme(bytes.NewReader(data)); err == nil && hasCard {
			m.card, m.cardData = rm.Card, rm.CardData
			m.pipelineTag, m.libraryName, m.sdk = rm.Card.PipelineTag, rm.Card.LibraryName, rm.Card.SDK
			m.description, _ = rm.Card.Extra["description"].(string)
			add(cardTags(rm, repoType)...)
		}
		if m.description == "" {
			m.description = firstParagraph(body)
		}
	}
	if repoType == "models" {
		if data, ok := readBlob(repo, rev, "config.json", maxConfigBytes); ok {
			if cfg, err := hfmeta.ParseConfigData(bytes.NewReader(data)); err == nil {
				add(cfg.Tags()...)
			}
		}
	}
	return m
}

// cardTags shapes the card's tags per repository type: models and spaces keep hfmeta's bare list, datasets prefix each facet with its field name.
func cardTags(rm *hfmeta.Readme, repoType string) []string {
	c := rm.Card
	switch repoType {
	case "models":
		tags := rm.Tags()
		for _, d := range c.Datasets {
			tags = append(tags, "dataset:"+d)
		}
		return tags
	case "spaces":
		return append(rm.Tags(), c.SDK)
	}
	var library []string
	if c.LibraryName != "" {
		library = []string{c.LibraryName}
	}
	var tags []string
	for _, g := range []struct {
		prefix string
		values []string
	}{
		{"task_categories:", c.TaskCategories}, {"task_ids:", c.TaskIDs}, {"annotations_creators:", c.AnnotationsCreators},
		{"language_creators:", c.LanguageCreators}, {"multilinguality:", c.Multilinguality}, {"source_datasets:", c.SourceDatasets},
		{"language:", c.Language}, {"license:", c.License}, {"size_categories:", c.SizeCategories},
		{"library:", library}, {"arxiv:", rm.ArxivIDs}, {"", c.Tags},
	} {
		for _, v := range g.values {
			if v != "" {
				tags = append(tags, g.prefix+v)
			}
		}
	}
	return tags
}

// readBlob returns the file's bytes at rev when it exists and is at most limit bytes.
func readBlob(repo *repository.Repository, rev, name string, limit int64) ([]byte, bool) {
	blob, err := repo.Blob(rev, name)
	if err != nil || blob.Size() > limit {
		return nil, false
	}
	rc, err := blob.NewReader()
	if err != nil {
		return nil, false
	}
	defer rc.Close()
	data, err := io.ReadAll(io.LimitReader(rc, limit))
	return data, err == nil
}

// readmeBody splits off a leading "---" front matter block the way hfmeta does and reports whether one was present.
func readmeBody(data []byte) ([]byte, bool) {
	if !bytes.HasPrefix(data, []byte("---\n")) && !bytes.HasPrefix(data, []byte("---\r\n")) {
		return data, false
	}
	_, rest, _ := bytes.Cut(data, []byte("\n"))
	end := bytes.Index(rest, []byte("\n---"))
	if end < 0 {
		return data, false
	}
	_, body, _ := bytes.Cut(rest[end+1:], []byte("\n"))
	return body, true
}

// firstParagraph returns the first blank-line separated block that is not only headings, trimmed.
func firstParagraph(body []byte) string {
	for _, para := range strings.Split(strings.ReplaceAll(string(body), "\r\n", "\n"), "\n\n") {
		para = strings.TrimSpace(para)
		if para == "" {
			continue
		}
		if slices.ContainsFunc(strings.Split(para, "\n"), func(line string) bool { return !strings.HasPrefix(strings.TrimSpace(line), "#") }) {
			return para
		}
	}
	return ""
}

// siblings lists the files reachable at rev; an unborn or unreadable revision has none.
func siblings(repo *repository.Repository, rev string) []map[string]string {
	out := []map[string]string{}
	if repo == nil {
		return out
	}
	entries, err := repo.Tree(rev, "", &repository.TreeOptions{Recursive: true})
	if err != nil {
		return out
	}
	for _, e := range entries {
		if e.Type() == repository.EntryTypeFile {
			out = append(out, map[string]string{"rfilename": e.Path()})
		}
	}
	return out
}

type tipEntry struct {
	tip       repository.Hash
	createdAt time.Time
}

// tipCache remembers the earliest reachable author date per repository path for the tip it was computed at, so listings walk a history only when the tip moved.
type tipCache struct {
	mu      sync.Mutex
	entries map[string]tipEntry
}

const tipCacheSize = 256

// dates reads the tip of rev and, when wantCreated is set, the earliest reachable author date, from the cache when the tip is unchanged.
func (c *tipCache) dates(repo *repository.Repository, key, rev string, wantCreated bool) repoDates {
	tips, err := repo.Commits(rev, &repository.CommitsOptions{Limit: 1})
	if err != nil || len(tips) == 0 {
		return repoDates{}
	}
	tip := tips[0]
	d := repoDates{sha: tip.Hash().String(), lastModified: tip.Author().When()}
	if !wantCreated {
		return d
	}
	c.mu.Lock()
	e, ok := c.entries[key]
	c.mu.Unlock()
	if ok && e.tip == tip.Hash() {
		d.createdAt = e.createdAt
		return d
	}
	all, err := repo.Commits(rev, nil)
	if err != nil {
		return d
	}
	d.createdAt = tip.Author().When()
	for i := range all {
		if when := all[i].Author().When(); when.Before(d.createdAt) {
			d.createdAt = when
		}
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.entries) >= tipCacheSize {
		for k := range c.entries {
			delete(c.entries, k)
			break
		}
	}
	c.entries[key] = tipEntry{tip: tip.Hash(), createdAt: d.createdAt}
	return d
}
