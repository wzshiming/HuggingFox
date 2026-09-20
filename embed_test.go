package huggingfox

import (
	"io/fs"
	"os"
	"path/filepath"
	"testing"
)

func TestWebFSExposesBuiltApp(t *testing.T) {
	root := filepath.Join("build", "app")
	if _, err := os.Stat(filepath.Join(root, "index.html")); err != nil {
		t.Skipf("frontend not built: %v", err)
	}
	web := WebFS()
	var files int
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		rel, _ := filepath.Rel(root, path)
		want, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		got, err := fs.ReadFile(web, filepath.ToSlash(rel))
		if err != nil {
			t.Errorf("embedded %s: %v", rel, err)
			return nil
		}
		if string(got) != string(want) {
			t.Errorf("embedded %s differs from disk", rel)
		}
		files++
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if files < 2 {
		t.Fatalf("walked %d files, want index.html plus assets", files)
	}
	if _, err := fs.Stat(web, "_app/version.json"); err != nil {
		t.Errorf("_app/version.json not embedded: %v", err)
	}
	if _, err := fs.Stat(web, ".gitkeep"); err == nil {
		t.Error("WebFS is rooted at build, not build/app")
	}
}
