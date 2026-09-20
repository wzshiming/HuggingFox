package hub

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"

	"github.com/go-git/go-git/v6/plumbing"
	"github.com/matrixhub-ai/hfd/pkg/permission"
	"github.com/matrixhub-ai/hfd/pkg/repository"
)

// commitHeaderLimit bounds the first NDJSON line inspected for the header; the SDK's header is a few hundred bytes.
const commitHeaderLimit = 64 << 10

// handleCommit answers the hub's 412 for a header whose parentCommit is no longer the branch tip, which hfd reports as a 500 only after reading the whole body; every other commit reaches hfd untouched, whose atomic tip check still covers a tip moving after this look.
func (h *Handler) handleCommit(w http.ResponseWriter, r *http.Request) {
	t, err := target(r)
	if err != nil {
		respond(w, err, http.StatusBadRequest)
		return
	}
	if !h.allow(w, r, permission.OperationUpdateRepo, t.name, permission.Context{Ref: t.rev}) {
		return
	}
	parent := peekParentCommit(r)
	if parent == "" {
		h.opts.Next.ServeHTTP(w, r)
		return
	}
	// Opened without the pre-open hook: a repository hfd cannot open, or must pull first, is hfd's to answer.
	repoPath := repository.ResolvePath(t.name)
	if repoPath == "" {
		h.opts.Next.ServeHTTP(w, r)
		return
	}
	repo, err := repository.Open(h.opts.Storage.RepositoriesFS(), repoPath)
	if err != nil {
		h.opts.Next.ServeHTTP(w, r)
		return
	}
	if tip, err := repo.RefHash(plumbing.NewBranchReferenceName(t.rev)); err == nil && tip != parent {
		respond(w, fmt.Errorf("a commit has happened since: expected parent commit %s but branch tip is %s", parent, tip), http.StatusPreconditionFailed)
		return
	}
	h.opts.Next.ServeHTTP(w, r)
}

// peekParentCommit returns the header's parentCommit when the first line is a complete header, leaving the body byte-for-byte readable for the next handler.
func peekParentCommit(r *http.Request) string {
	br := bufio.NewReaderSize(r.Body, commitHeaderLimit)
	line, err := br.ReadSlice('\n')
	head := bytes.Clone(line)
	var rest io.Reader = br
	if err != nil && err != io.EOF && err != bufio.ErrBufferFull {
		// bufio has consumed the body's read error; replaying it keeps hfd from committing only the bytes that arrived before it.
		rest = errReader{err}
	}
	r.Body = struct {
		io.Reader
		io.Closer
	}{io.MultiReader(bytes.NewReader(head), rest), r.Body}
	if err != nil && err != io.EOF {
		return ""
	}
	var op struct {
		Key   string `json:"key"`
		Value struct {
			ParentCommit string `json:"parentCommit"`
		} `json:"value"`
	}
	if json.Unmarshal(head, &op) != nil || op.Key != "header" {
		return ""
	}
	return op.Value.ParentCommit
}

type errReader struct{ err error }

func (e errReader) Read([]byte) (int, error) { return 0, e.err }
