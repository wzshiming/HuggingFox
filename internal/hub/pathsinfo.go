package hub

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"maps"
	"mime"
	"net/http"
	"path"
	"slices"
	"strings"

	"github.com/go-git/go-git/v6/plumbing/object"
	"github.com/matrixhub-ai/hfd/pkg/repository"
)

const (
	maxPathsInfoBody  = 1 << 20
	maxPathsInfoPaths = 1000
)

type pathsInfoRequest struct {
	Paths  []string `json:"paths"`
	Expand bool     `json:"expand"`
}

type lfsInfo struct {
	OID         string `json:"oid"`
	Size        int64  `json:"size"`
	PointerSize int64  `json:"pointerSize"`
}

type lastCommitInfo struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	Date  string `json:"date"`
}

type pathInfo struct {
	Type       repository.EntryType `json:"type"`
	OID        string               `json:"oid"`
	Path       string               `json:"path"`
	Size       int64                `json:"size"`
	LFS        *lfsInfo             `json:"lfs,omitempty"`
	LastCommit *lastCommitInfo      `json:"lastCommit,omitempty"`
}

// parsePathsInfo accepts the JSON body the web client sends and the form body huggingface_hub sends; paths come back cleaned and deduplicated.
func parsePathsInfo(r *http.Request) (pathsInfoRequest, error) {
	r.Body = http.MaxBytesReader(nil, r.Body, maxPathsInfoBody)
	var req pathsInfoRequest
	switch ct, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type")); ct {
	case "application/x-www-form-urlencoded", "multipart/form-data":
		if err := r.ParseMultipartForm(maxPathsInfoBody); err != nil && !errors.Is(err, http.ErrNotMultipart) {
			return req, fmt.Errorf("invalid request body: %v", err)
		}
		req.Paths = r.PostForm["paths"]
		expand := r.PostForm.Get("expand")
		req.Expand = strings.EqualFold(expand, "true") || expand == "1"
	default:
		dec := json.NewDecoder(r.Body)
		if err := dec.Decode(&req); err != nil {
			return req, fmt.Errorf("invalid request body: %v", err)
		}
		// Reading on to EOF rejects trailing data and lets the size limit trip on bodies whose first value ends early.
		if _, err := dec.Token(); !errors.Is(err, io.EOF) {
			if err == nil {
				err = errors.New("trailing data after the JSON value")
			}
			return req, fmt.Errorf("invalid request body: %v", err)
		}
	}
	if len(req.Paths) > maxPathsInfoPaths {
		return req, fmt.Errorf("too many paths: %d > %d", len(req.Paths), maxPathsInfoPaths)
	}
	var paths []string
	for _, p := range req.Paths {
		clean, ok := cleanRepoPath(p)
		if !ok || clean == "" {
			return req, fmt.Errorf("invalid path %q", p)
		}
		if !slices.Contains(paths, clean) {
			paths = append(paths, clean)
		}
	}
	req.Paths = paths
	return req, nil
}

// cleanRepoPath normalizes a path inside the repository, "" being the root; false when it is absolute or escapes the root.
func cleanRepoPath(p string) (string, bool) {
	clean := path.Clean(p)
	if clean == "." {
		clean = ""
	}
	return clean, !strings.HasPrefix(clean, "/") && clean != ".." && !strings.HasPrefix(clean, "../")
}

// parentDir is path.Dir with "" for the root, the key treeAt uses for it.
func parentDir(p string) string {
	if parent := path.Dir(p); parent != "." {
		return parent
	}
	return ""
}

// handlePathsInfo serves POST /api/{type}/{ns}/{repo}/paths-info/{rev}: each parent directory is listed once and the requested entries are picked from it; missing paths are omitted.
func (h *Handler) handlePathsInfo(w http.ResponseWriter, r *http.Request) {
	t, err := target(r)
	if err != nil {
		respond(w, err, http.StatusBadRequest)
		return
	}
	// The body is validated before the pre-open hook so malformed requests never pull a mirror.
	req, err := parsePathsInfo(r)
	if err != nil {
		respond(w, err, http.StatusBadRequest)
		return
	}
	repo, ok := h.openRepo(w, r, t)
	if !ok {
		return
	}
	hash, err := repo.ResolveRevision(t.rev)
	if err != nil {
		status, err := revisionError(t.rev, err)
		respond(w, err, status)
		return
	}
	wanted := map[string][]string{}
	for _, p := range req.Paths {
		parent := parentDir(p)
		wanted[parent] = append(wanted[parent], p)
	}
	found := map[string]pathInfo{}
	listed := map[string][]*repository.TreeEntry{}
	for _, parent := range slices.Sorted(maps.Keys(wanted)) {
		entries, err := treeAt(repo, hash, parent, listed)
		if err != nil {
			respond(w, fmt.Errorf("failed to read %q at %q: %v", parent, t.rev, err), http.StatusInternalServerError)
			return
		}
		for _, e := range entries {
			if !slices.Contains(wanted[parent], e.Path()) {
				continue
			}
			info, err := describe(r.Context(), repo, hash, e, req.Expand)
			if err != nil {
				respond(w, fmt.Errorf("failed to read %q at %q: %v", e.Path(), t.rev, err), http.StatusInternalServerError)
				return
			}
			found[e.Path()] = info
		}
	}
	out := make([]pathInfo, 0, len(found))
	for _, p := range req.Paths {
		if info, ok := found[p]; ok {
			out = append(out, info)
		}
	}
	respond(w, out, http.StatusOK)
}

// treeAt lists dir at hash, descending from the root so a component that is missing or a file yields no entries while any listing error is a storage failure.
func treeAt(repo *repository.Repository, hash, dir string, listed map[string][]*repository.TreeEntry) ([]*repository.TreeEntry, error) {
	if entries, ok := listed[dir]; ok {
		return entries, nil
	}
	if dir != "" {
		siblings, err := treeAt(repo, hash, parentDir(dir), listed)
		if err != nil {
			return nil, err
		}
		if i := slices.IndexFunc(siblings, func(e *repository.TreeEntry) bool { return e.Path() == dir }); i < 0 || siblings[i].Type() != repository.EntryTypeDirectory {
			listed[dir] = nil
			return nil, nil
		}
	}
	entries, err := repo.Tree(hash, dir, nil)
	if err != nil {
		return nil, err
	}
	listed[dir] = entries
	return entries, nil
}

// describe renders one tree entry; directories carry their tree hash and no size, files their blob or LFS size.
func describe(ctx context.Context, repo *repository.Repository, hash string, e *repository.TreeEntry, expand bool) (pathInfo, error) {
	info := pathInfo{Type: e.Type(), OID: e.Hash().String(), Path: e.Path()}
	last := e.LastCommit()
	if e.Type() == repository.EntryTypeFile {
		blob, err := e.Blob()
		if err != nil {
			return info, err
		}
		info.Size = blob.Size()
		if ptr, _ := blob.LFSPointer(); ptr != nil {
			info.LFS = &lfsInfo{OID: ptr.OID(), Size: ptr.Size(), PointerSize: blob.Size()}
			info.Size = ptr.Size()
		}
	} else if expand {
		var err error
		if last, err = directoryLastCommit(ctx, repo, hash, e.Path()); err != nil {
			return info, err
		}
	}
	if expand && last != nil {
		info.LastCommit = &lastCommitInfo{ID: last.Hash().String(), Title: last.Title(), Date: hubTime(last.Author().When())}
	}
	return info, nil
}

// directoryLastCommit walks the history from hash for the first commit whose diff against its first parent touches a file under dir; hfd's per-entry history only matches files.
func directoryLastCommit(ctx context.Context, repo *repository.Repository, hash, dir string) (*repository.Commit, error) {
	all, err := repo.Commits(hash, nil)
	if err != nil {
		return nil, err
	}
	for i := range all {
		c := &all[i]
		changes, err := repo.Compare(ctx, c.Hash().String()+"^", c.Hash().String())
		if errors.Is(err, io.EOF) {
			// A root commit has no parent to diff against; whatever it holds under dir was added here.
			return c, nil
		}
		if err != nil {
			return nil, err
		}
		if slices.ContainsFunc(changes, func(ch *object.Change) bool {
			return strings.HasPrefix(ch.From.Name, dir+"/") || strings.HasPrefix(ch.To.Name, dir+"/")
		}) {
			return c, nil
		}
	}
	return nil, fmt.Errorf("history of %q reaches no root commit", dir)
}
