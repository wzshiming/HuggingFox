import { describe, expect, it } from 'vitest';
import { parsePatch } from './diff.ts';

const patch = `diff --git a/README.md b/README.md
index 3b18e51..a1b2c3d 100644
--- a/README.md
+++ b/README.md
@@ -1,4 +1,5 @@
 # GPT-2
\x20
-Old intro <script>alert(1)</script>
+New intro
+Second new line
 Unchanged
diff --git a/config.json b/config.json
new file mode 100644
index 0000000..e69de29
--- /dev/null
+++ b/config.json
@@ -0,0 +1,2 @@
+{
+}
\\ No newline at end of file
diff --git a/old.txt b/old.txt
deleted file mode 100644
index d95f3ad..0000000
--- a/old.txt
+++ /dev/null
@@ -1 +0,0 @@
-gone
diff --git a/logo.png b/logo.png
new file mode 100644
index 0000000..8f4e2a1
Binary files /dev/null and b/logo.png differ
diff --git a/src/old_name.py b/src/new_name.py
similarity index 92%
rename from src/old_name.py
rename to src/new_name.py
index 1111111..2222222 100644
--- a/src/old_name.py
+++ b/src/new_name.py
@@ -10,3 +10,3 @@ def main():
     a = 1
-    b = 2
+    b = 3
     return a + b
`;

describe('parsePatch', () => {
	it('builds per-file view models with statuses, counts and numbered lines', () => {
		const result = parsePatch(patch);
		expect(result.files.map((f) => [f.path, f.status, f.additions, f.deletions, f.binary])).toEqual(
			[
				['README.md', 'modified', 2, 1, false],
				['config.json', 'added', 2, 0, false],
				['old.txt', 'deleted', 0, 1, false],
				['logo.png', 'added', 0, 0, true],
				['src/new_name.py', 'renamed', 1, 1, false]
			]
		);
		expect(result.additions).toBe(5);
		expect(result.deletions).toBe(3);
		expect(result.files[4].oldPath).toBe('src/old_name.py');
		expect(result.files[0].oldPath).toBe(null);

		const readme = result.files[0].hunks[0];
		expect(readme.header).toBe('@@ -1,4 +1,5 @@');
		expect(readme.lines).toEqual([
			{ type: 'context', oldNo: 1, newNo: 1, text: '# GPT-2' },
			{ type: 'context', oldNo: 2, newNo: 2, text: '' },
			{ type: 'del', oldNo: 3, newNo: null, text: 'Old intro <script>alert(1)</script>' },
			{ type: 'add', oldNo: null, newNo: 3, text: 'New intro' },
			{ type: 'add', oldNo: null, newNo: 4, text: 'Second new line' },
			{ type: 'context', oldNo: 4, newNo: 5, text: 'Unchanged' }
		]);
		const config = result.files[1].hunks[0].lines;
		expect(config.at(-1)).toEqual({
			type: 'meta',
			oldNo: null,
			newNo: null,
			text: '\\ No newline at end of file'
		});
		expect(result.files[4].hunks[0].header).toBe('@@ -10,3 +10,3 @@ def main():');
		expect(result.files[3].hunks).toEqual([]);
	});

	it('treats an empty compare as zero changes', () => {
		expect(parsePatch('')).toEqual({ files: [], additions: 0, deletions: 0 });
		expect(parsePatch('\n')).toEqual({ files: [], additions: 0, deletions: 0 });
	});
});
