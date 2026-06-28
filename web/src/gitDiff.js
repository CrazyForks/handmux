// 把 `git diff` 的 unified 文本解析成 [{ path, hunks: [{ header, lines: [{type,text}] }] }]。
// type: 'add'(+) | 'del'(-) | 'ctx'(空格)。文件头杂项(index/---/+++)忽略。
// 纯函数,无副作用,供 DiffView 渲染。
export function parseDiff(text) {
  if (!text) return [];
  const files = [];
  let file = null;
  let hunk = null;
  for (const raw of text.split('\n')) {
    if (raw.startsWith('diff --git')) {
      // "diff --git a/<path> b/<path>" — 取 b 侧路径作为文件名。
      const m = raw.match(/ b\/(.*)$/);
      file = { path: m ? m[1] : raw.slice(11), hunks: [] };
      files.push(file);
      hunk = null;
      continue;
    }
    if (!file) continue;
    if (raw.startsWith('@@')) {
      hunk = { header: raw, lines: [] };
      file.hunks.push(hunk);
      continue;
    }
    if (!hunk) continue; // 文件头部杂项(index/---/+++) 跳过
    const c = raw[0];
    if (c === '+') hunk.lines.push({ type: 'add', text: raw.slice(1) });
    else if (c === '-') hunk.lines.push({ type: 'del', text: raw.slice(1) });
    else if (c === ' ') hunk.lines.push({ type: 'ctx', text: raw.slice(1) });
    // '\'(No newline at end of file) 等忽略
  }
  return files;
}
