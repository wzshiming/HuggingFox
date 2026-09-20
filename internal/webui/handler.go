// Package webui serves the embedded single-page web UI behind the hub routes.
package webui

import (
	"bytes"
	"errors"
	"io"
	"io/fs"
	"net/http"
	"path"
	"regexp"
	"strings"
)

type handler struct {
	fs fs.FS
}

// hubRoutePattern is the hub/SPA boundary shared with proxy-routes.ts and deploy/nginx.conf.template (kept identical by tests).
const hubRoutePattern = `^(?:/api(?:[/?]|$)|/(?:(?:datasets|spaces)/)?[^/?]+(?:/[^/?]+)?/resolve/|/(?:(?:datasets|spaces)/)?[^/?]+(?:/[^/?]+)?\.git(?:[/?]|$)|/(?:(?:datasets|spaces)/)?[^/?]+(?:/[^/?]+)?/(?:info/(?:refs|lfs)|git-upload-pack|git-receive-pack)(?:[/?]|$)|/(?:objects|v1|v2|shards|reconstructions|xet-bridge|internal)(?:[/?]|$)|/avatars/[^/?]+\.svg(?:\?|$))`

// Handler serves fsys (the SvelteKit output) with SPA fallback to index.html; hub-owned paths never receive HTML.
func Handler(fsys fs.FS) http.Handler {
	return &handler{fs: fsys}
}

var hubRoute = regexp.MustCompile(hubRoutePattern)

func isAPI(p string) bool {
	return p == "/api" || strings.HasPrefix(p, "/api/")
}

// reserved paths belong to the asset bundle or the hub protocols, so a miss is a real 404 rather than the SPA shell.
func reserved(p string) bool {
	return p == "/_app" || strings.HasPrefix(p, "/_app/") || hubRoute.MatchString(p)
}

func (h *handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	p := path.Clean("/" + r.URL.Path)
	if isAPI(p) {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusNotFound)
		_, _ = io.WriteString(w, `{"error":"Not Found"}`+"\n")
		return
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
		return
	}
	name := strings.TrimPrefix(p, "/")
	if name != "" && name != "index.html" && h.serveFile(w, r, name) {
		return
	}
	if reserved(p) || (name != "" && !fs.ValidPath(name)) {
		http.NotFound(w, r)
		return
	}
	h.serveIndex(w, r)
}

// serveFile reports false when name is not a regular file in the bundle.
func (h *handler) serveFile(w http.ResponseWriter, r *http.Request, name string) bool {
	f, err := h.fs.Open(name)
	if err != nil {
		return false
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() {
		return false
	}
	if strings.HasPrefix(name, "_app/immutable/") {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	}
	serveContent(w, r, name, f, info)
	return true
}

func (h *handler) serveIndex(w http.ResponseWriter, r *http.Request) {
	f, err := h.fs.Open("index.html")
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			http.Error(w, "web UI not built: index.html missing from the embedded bundle", http.StatusServiceUnavailable)
			return
		}
		http.Error(w, http.StatusText(http.StatusInternalServerError), http.StatusInternalServerError)
		return
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		http.Error(w, http.StatusText(http.StatusInternalServerError), http.StatusInternalServerError)
		return
	}
	hdr := w.Header()
	hdr.Set("Cache-Control", "no-cache")
	hdr.Set("Content-Security-Policy", "frame-ancestors 'self'")
	hdr.Set("Referrer-Policy", "strict-origin-when-cross-origin")
	serveContent(w, r, "index.html", f, info)
}

// serveContent avoids http.ServeFileFS, whose index.html and trailing-slash redirects would loop the SPA shell.
func serveContent(w http.ResponseWriter, r *http.Request, name string, f fs.File, info fs.FileInfo) {
	rs, ok := f.(io.ReadSeeker)
	if !ok {
		data, err := io.ReadAll(f)
		if err != nil {
			http.Error(w, http.StatusText(http.StatusInternalServerError), http.StatusInternalServerError)
			return
		}
		rs = bytes.NewReader(data)
	}
	http.ServeContent(w, r, name, info.ModTime(), rs)
}
