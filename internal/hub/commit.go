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

// Bounds the peeked header line; the SDK's header is a few hundred bytes.
const commitHeaderLimit = 64 << 10

// Early 412 for a stale parentCommit hfd would 500 late; hfd's atomic tip check stays authoritative.
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
	// No pre-open hook: a repository hfd cannot open, or must pull first, is hfd's to answer.
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

// Leaves the body byte-for-byte readable; EOF can still end a full header, ErrBufferFull cannot.
func peekParentCommit(r *http.Request) string {
	br := bufio.NewReaderSize(r.Body, commitHeaderLimit)
	line, err := br.ReadSlice('\n')
	head := bytes.Clone(line)
	var rest io.Reader = br
	if err != nil && err != io.EOF && err != bufio.ErrBufferFull {
		// bufio swallowed the body's read error; replaying it keeps hfd from committing a truncated body.
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
