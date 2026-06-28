import { describe, it, expect } from 'vitest';
import { parseDiff } from '../src/gitDiff.js';

const SAMPLE = `diff --git a/a.txt b/a.txt
index 1234567..89abcde 100644
--- a/a.txt
+++ b/a.txt
@@ -1,1 +1,1 @@
-hello
+hello world
`;

describe('parseDiff', () => {
  it('splits into files and hunks with typed lines', () => {
    const files = parseDiff(SAMPLE);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe('a.txt');
    const lines = files[0].hunks[0].lines;
    expect(lines.find((l) => l.type === 'del').text).toBe('hello');
    expect(lines.find((l) => l.type === 'add').text).toBe('hello world');
  });

  it('handles a new file', () => {
    const files = parseDiff(`diff --git a/b.txt b/b.txt
new file mode 100644
index 0000000..111
--- /dev/null
+++ b/b.txt
@@ -0,0 +1,1 @@
+new
`);
    expect(files[0].path).toBe('b.txt');
    expect(files[0].hunks[0].lines[0].type).toBe('add');
  });

  it('returns [] for empty diff', () => {
    expect(parseDiff('')).toEqual([]);
  });

  it('handles a multi-file diff', () => {
    const files = parseDiff(`diff --git a/x.js b/x.js
--- a/x.js
+++ b/x.js
@@ -1,1 +1,1 @@
-old
+new
diff --git a/y.js b/y.js
--- a/y.js
+++ b/y.js
@@ -1,1 +1,1 @@
 ctx
`);
    expect(files).toHaveLength(2);
    expect(files[0].path).toBe('x.js');
    expect(files[1].path).toBe('y.js');
    expect(files[0].hunks[0].lines).toEqual([
      { type: 'del', text: 'old' },
      { type: 'add', text: 'new' },
    ]);
    expect(files[1].hunks[0].lines).toEqual([{ type: 'ctx', text: 'ctx' }]);
  });

  it('handles a deleted file (+++ /dev/null)', () => {
    const files = parseDiff(`diff --git a/gone.txt b/gone.txt
deleted file mode 100644
--- a/gone.txt
+++ /dev/null
@@ -1,1 +0,0 @@
-bye
`);
    expect(files[0].path).toBe('gone.txt');
    expect(files[0].hunks[0].lines[0]).toEqual({ type: 'del', text: 'bye' });
  });
});
