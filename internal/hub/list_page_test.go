package hub

import (
	"net/http"
	"net/url"
	"regexp"
	"slices"
	"strings"
	"testing"
	"time"
)

func TestListSortsByDatesWithDirectionAndTieBreak(t *testing.T) {
	h, st := newHub(t, Options{})
	seed(t, st, "alice/a", map[string]string{"README.md": "a\n"}, day1)
	seed(t, st, "alice/a", map[string]string{"x.txt": "x\n"}, day3)
	seed(t, st, "bob/b", map[string]string{"README.md": "b\n"}, day2)
	seed(t, st, "carol/c", map[string]string{"README.md": "c\n"}, day2)
	if _, err := repositoryInit(st, "dave/empty"); err != nil {
		t.Fatal(err)
	}
	for target, want := range map[string][]string{
		"/api/models":                                  {"alice/a", "bob/b", "carol/c", "dave/empty"},
		"/api/models?sort=createdAt":                   {"bob/b", "carol/c", "alice/a", "dave/empty"},
		"/api/models?sort=createdAt&direction=-1":      {"bob/b", "carol/c", "alice/a", "dave/empty"},
		"/api/models?sort=createdAt&direction=1":       {"dave/empty", "alice/a", "bob/b", "carol/c"},
		"/api/models?sort=lastModified":                {"alice/a", "bob/b", "carol/c", "dave/empty"},
		"/api/models?sort=lastModified&direction=1":    {"dave/empty", "bob/b", "carol/c", "alice/a"},
		"/api/models?sort=likes":                       {"alice/a", "bob/b", "carol/c", "dave/empty"},
		"/api/models?sort=trendingScore&direction=1":   {"alice/a", "bob/b", "carol/c", "dave/empty"},
		"/api/models?sort=downloads&expand[]=author":   {"alice/a", "bob/b", "carol/c", "dave/empty"},
		"/api/models?sort=trending_score&direction=-1": {"alice/a", "bob/b", "carol/c", "dave/empty"},
	} {
		if got := listIDs(t, h, target); !slices.Equal(got, want) {
			t.Errorf("%s: ids %v, want %v", target, got, want)
		}
	}
	a := listItems(t, h, "/api/models?author=alice&expand[]=createdAt&expand[]=lastModified")[0]
	if a["createdAt"] != "2024-01-01T12:00:00.000Z" || a["lastModified"] != "2024-03-01T12:00:00.000Z" {
		t.Errorf("alice dates %v", a)
	}
	for _, target := range []string{"/api/models?sort=bogus", "/api/models?sort=createdAt&direction=abc", "/api/models?sort=createdAt&direction=0", "/api/models?direction=2"} {
		if rec := do(t, h, http.MethodGet, target, ""); rec.Code != http.StatusBadRequest {
			t.Errorf("%s: %d %s", target, rec.Code, rec.Body)
		}
	}

	// An older-dated commit on carol/c moves its tip, so the cached earliest date must be recomputed.
	seed(t, st, "carol/c", map[string]string{"old.txt": "o\n"}, day1.Add(-time.Hour))
	c := listItems(t, h, "/api/models?author=carol&expand[]=createdAt")[0]
	if c["createdAt"] != "2024-01-01T11:00:00.000Z" {
		t.Errorf("carol createdAt after new tip %v", c["createdAt"])
	}
	if got := listIDs(t, h, "/api/models?sort=createdAt&direction=1"); !slices.Equal(got, []string{"dave/empty", "carol/c", "alice/a", "bob/b"}) {
		t.Errorf("ids after tip move %v", got)
	}
}

var linkRe = regexp.MustCompile(`^<([^>]+)>; rel="next"$`)

func nextCursor(t *testing.T, link string) (string, *url.URL) {
	t.Helper()
	m := linkRe.FindStringSubmatch(link)
	if m == nil {
		t.Fatalf("link %q", link)
	}
	u, err := url.Parse(m[1])
	if err != nil {
		t.Fatal(err)
	}
	return u.Query().Get("cursor"), u
}

func TestListPaginationCursorAndLink(t *testing.T) {
	h, st := newHub(t, Options{})
	for _, name := range []string{"r1", "r2", "r3", "r4", "r5"} {
		seed(t, st, "alice/"+name, map[string]string{"README.md": name}, day1)
	}
	rec := do(t, h, http.MethodGet, "/api/models?limit=2&search=r&expand[]=author", "", "X-Forwarded-Proto", "https")
	var page []map[string]any
	decode(t, rec, http.StatusOK, &page)
	if len(page) != 2 || page[0]["id"] != "alice/r1" || page[1]["id"] != "alice/r2" {
		t.Fatalf("page 1 %v", page)
	}
	cursor, u := nextCursor(t, rec.Header().Get("Link"))
	if cursor == "" || u.Scheme != "https" || u.Host != "example.com" || u.Path != "/api/models" || u.Query().Get("search") != "r" || u.Query().Get("limit") != "2" || u.Query()["expand[]"][0] != "author" {
		t.Errorf("link %s", u)
	}
	rec = do(t, h, http.MethodGet, u.RequestURI(), "", "X-Forwarded-Proto", "javascript:alert(1)")
	decode(t, rec, http.StatusOK, &page)
	if len(page) != 2 || page[0]["id"] != "alice/r3" || page[1]["id"] != "alice/r4" {
		t.Fatalf("page 2 %v", page)
	}
	cursor, u = nextCursor(t, rec.Header().Get("Link"))
	if u.Scheme != "http" || cursor == "" {
		t.Errorf("link %s", u)
	}
	rec = do(t, h, http.MethodGet, u.RequestURI(), "")
	decode(t, rec, http.StatusOK, &page)
	if len(page) != 1 || page[0]["id"] != "alice/r5" || rec.Header().Get("Link") != "" {
		t.Errorf("page 3 %v link %q", page, rec.Header().Get("Link"))
	}

	if got := listIDs(t, h, "/api/models?limit=99999"); len(got) != 5 {
		t.Errorf("large limit %v", got)
	}
	if got := listIDs(t, h, "/api/models?cursor="+cursor+"&limit=1"); !slices.Equal(got, []string{"alice/r5"}) {
		t.Errorf("reused cursor %v", got)
	}
	far := do(t, h, http.MethodGet, "/api/models?cursor="+encodeCursor(1<<40), "")
	decode(t, far, http.StatusOK, &page)
	if len(page) != 0 || far.Header().Get("Link") != "" {
		t.Errorf("far cursor %v %q", page, far.Header().Get("Link"))
	}
	for _, target := range []string{
		"/api/models?limit=0", "/api/models?limit=-1", "/api/models?limit=abc", "/api/models?limit=99999999999999999999",
		"/api/models?cursor=!!!", "/api/models?cursor=bm90anNvbg", "/api/models?cursor=" + encodeCursor(-5), "/api/models?cursor=eyJvZmZzZXQiOjFlOTk5fQ",
	} {
		if rec := do(t, h, http.MethodGet, target, ""); rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "error") {
			t.Errorf("%s: %d %s", target, rec.Code, rec.Body)
		}
	}
}
