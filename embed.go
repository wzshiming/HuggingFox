// Package huggingfox embeds the built web UI so a single binary can serve it.
package huggingfox

import (
	"embed"
	"io/fs"
)

// all: keeps the underscore-prefixed _app directory; build/.gitkeep keeps the pattern valid before any frontend build.
//
//go:embed all:build
var build embed.FS

// WebFS returns the SvelteKit output (build/app); index.html is absent until the frontend is built.
func WebFS() fs.FS {
	sub, err := fs.Sub(build, "build/app")
	if err != nil {
		panic(err)
	}
	return sub
}
