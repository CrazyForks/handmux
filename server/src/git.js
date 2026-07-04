import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join, basename, isAbsolute } from 'node:path';
import { execFile } from 'node:child_process';
import { isUnder } from './docPath.js';
import { defaultExtraRoots } from './docs.js';

// 只读子命令白名单：命令层硬过滤，杜绝任何写操作混入。
const READONLY = new Set(['rev-parse', 'status', 'log', 'for-each-ref', 'diff', 'show', 'diff-tree']);
const MAX_BUFFER = 8 * 1024 * 1024;

export function createGit({ home, extraRoots = [] } = {}) {
  const realHomeP = fs.realpath(home);
  // Same multi-root allow-list as createDocs: $HOME plus a few roots OUTSIDE it (/tmp, $TMPDIR) so a repo
  // an agent is working in under /tmp is reachable from the phone. Resolved once — realpath'd, deduped,
  // missing ones skipped, extras already inside home dropped (home covers them). Keeps git browsing in
  // lock-step with the file/doc browser; git.js used to be home-only, which rejected legit repos under
  // /tmp with a red "outside home".
  const rootsP = (async () => {
    const rh = await realHomeP;
    const out = [rh];
    for (const r of extraRoots) {
      if (typeof r !== 'string' || !r) continue;
      let real;
      try { real = await fs.realpath(r); } catch { continue; } // not present on this host → skip
      if (isUnder(real, rh) || out.includes(real)) continue;   // already covered by home / dup
      out.push(real);
    }
    return out;
  })();
  // The allowed root that contains `real` (longest match wins should roots ever nest), or null.
  const rootOf = (real, roots) => {
    let best = null;
    for (const r of roots) if (isUnder(real, r) && (!best || r.length > best.length)) best = r;
    return best;
  };

  function git(cwd, args) {
    const sub = args[0];
    if (!READONLY.has(sub)) return Promise.reject(new Error(`blocked subcommand: ${sub}`));
    return new Promise((resolve, reject) => {
      execFile('git', ['-C', cwd, '-c', 'core.quotepath=false', ...args], { maxBuffer: MAX_BUFFER }, (err, stdout) => {
        if (err) reject(err); else resolve(stdout);
      });
    });
  }

  async function resolveRepo(rawPath) {
    if (typeof rawPath !== 'string' || !isAbsolute(rawPath)) return { error: 'not absolute', status: 400 };
    let real;
    try { real = await fs.realpath(rawPath); } catch { return { error: 'not found', status: 404 }; }
    if (!rootOf(real, await rootsP)) return { error: 'outside home', status: 400 };
    return { real };
  }

  async function isRepo(dir) {
    try { return (await git(dir, ['rev-parse', '--is-inside-work-tree'])).trim() === 'true'; }
    catch { return false; }
  }

  // `realDir` is used for git operations; `displayPath` is what we expose (the caller's original path,
  // avoiding macOS /private/var vs /var confusion when the caller passed a non-realpath'd path).
  async function repoMeta(realDir, displayPath) {
    const p = displayPath ?? realDir;
    let branch = 'HEAD';
    try { branch = (await git(realDir, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim(); } catch { /* empty repo */ }
    let dirty = false;
    try { dirty = (await git(realDir, ['status', '--porcelain'])).trim().length > 0; } catch { /* ignore */ }
    return { name: basename(p), path: p, branch, dirty };
  }

  async function detectRepos(rawDir) {
    const r = await resolveRepo(rawDir);
    if (r.error) return r;
    if (await isRepo(r.real)) return { repos: [await repoMeta(r.real, rawDir)] };
    const repos = [];
    let dirents = [];
    try { dirents = await fs.readdir(r.real, { withFileTypes: true }); } catch { /* ignore */ }
    for (const d of dirents) {
      if (!d.isDirectory()) continue;
      const child = join(r.real, d.name);
      const childDisplay = join(rawDir, d.name);
      if (await isRepo(child)) repos.push(await repoMeta(child, childDisplay));
    }
    repos.sort((a, b) => a.name.localeCompare(b.name));
    return { repos };
  }

  async function status(rawRepo) {
    const r = await resolveRepo(rawRepo);
    if (r.error) return r;
    if (!(await isRepo(r.real))) return { error: 'not a repo', status: 400 };
    let out;
    try { out = await git(r.real, ['status', '--porcelain']); }
    catch { return { error: 'git error', status: 500 }; }
    const changes = out.split('\n').filter(Boolean).map((line) => {
      const x = line[0], y = line[1];
      let path = line.slice(3);
      const arrow = path.indexOf(' -> ');
      if (arrow >= 0) path = path.slice(arrow + 4);
      return { x: x === ' ' ? '' : x, y: y === ' ' ? '' : y, path };
    });
    return { changes };
  }

  const SEP = '\x1f';

  // 分支 / ref 名校验:挡选项注入(开头 '-')、路径穿越('..')、NUL,并限定到安全字符子集。
  // 只读 git log 用,失败时 git 自己会再拒一次。
  function safeRef(ref) {
    if (typeof ref !== 'string' || !ref) return null;
    if (ref[0] === '-' || ref.includes('..') || ref.includes('\0')) return null;
    if (!/^[A-Za-z0-9._/-]+$/.test(ref)) return null;
    return ref;
  }

  async function log(rawRepo, limit = 50, ref) {
    const r = await resolveRepo(rawRepo);
    if (r.error) return r;
    if (!(await isRepo(r.real))) return { error: 'not a repo', status: 400 };
    const n = Math.max(1, Math.min(500, Number(limit) || 50));
    const safeR = ref == null || ref === '' ? null : safeRef(ref);
    if (ref && !safeR) return { error: 'bad ref', status: 400 };
    const args = ['log', `-n${n}`, `--pretty=format:%H${SEP}%h${SEP}%s${SEP}%an${SEP}%ar`];
    if (safeR) args.push(safeR); // git log <ref> …(指定分支只读看历史,不动工作树)
    let out = '';
    try { out = await git(r.real, args); }
    catch { return { commits: [] }; } // 空仓库(无提交)/ 无此 ref → 空列表
    const commits = out.split('\n').filter(Boolean).map((line) => {
      const [hash, short, subject, author, relDate] = line.split(SEP);
      return { hash, short, subject, author, relDate };
    });
    return { commits };
  }

  async function branches(rawRepo) {
    const r = await resolveRepo(rawRepo);
    if (r.error) return r;
    if (!(await isRepo(r.real))) return { error: 'not a repo', status: 400 };
    const fmt = ['%(refname:short)', '%(HEAD)', '%(upstream:short)', '%(upstream:track)'].join(SEP);
    let out;
    try { out = await git(r.real, ['for-each-ref', `--format=${fmt}`, 'refs/heads']); }
    catch { return { branches: [] }; }
    const branches = out.split('\n').filter(Boolean).map((line) => {
      const [name, head, upstream, track] = line.split(SEP);
      const ahead = Number((track.match(/ahead (\d+)/) || [])[1] || 0);
      const behind = Number((track.match(/behind (\d+)/) || [])[1] || 0);
      return { name, current: head === '*', upstream: upstream || null, ahead, behind };
    });
    return { branches };
  }

  // 文件路径校验:相对、非绝对、不以 '-' 开头(防选项注入)、无 '..' 段、无 NUL。
  function safeRelPath(p) {
    if (typeof p !== 'string' || !p || p[0] === '-' || isAbsolute(p)) return null;
    if (p.includes('\0') || p.split('/').some((seg) => seg === '..')) return null;
    return p;
  }

  const MAX_DIFF_BYTES = 512 * 1024;
  function cap(text) {
    if (text.length <= MAX_DIFF_BYTES) return { diff: text, truncated: false };
    return { diff: text.slice(0, MAX_DIFF_BYTES), truncated: true };
  }

  // diff 语义:仅 path → 工作区 vs HEAD;staged → 暂存区 vs HEAD;commit → 该提交 vs 其父。
  async function diff(rawRepo, { path, commit, staged } = {}) {
    const r = await resolveRepo(rawRepo);
    if (r.error) return r;
    if (!(await isRepo(r.real))) return { error: 'not a repo', status: 400 };
    const rel = safeRelPath(path);
    if (!rel) return { error: 'bad path', status: 400 };
    let args;
    if (commit) {
      if (!/^[0-9a-fA-F]{4,40}$/.test(commit)) return { error: 'bad commit', status: 400 };
      args = ['show', '--format=', commit, '--', rel];
    } else if (staged) {
      args = ['diff', '--staged', '--', rel];
    } else {
      args = ['diff', 'HEAD', '--', rel];
    }
    let out = '';
    try { out = await git(r.real, args); } catch (e) { return { error: 'diff failed', status: 500 }; }
    return cap(out);
  }

  async function commit(rawRepo, hash) {
    const r = await resolveRepo(rawRepo);
    if (r.error) return r;
    if (!(await isRepo(r.real))) return { error: 'not a repo', status: 400 };
    if (!/^[0-9a-fA-F]{4,40}$/.test(hash)) return { error: 'bad commit', status: 400 };
    let message, ns;
    try {
      message = (await git(r.real, ['show', '-s', '--format=%B', hash])).trim();
      // --root 让首次提交(无父)也能列出文件。
      ns = await git(r.real, ['diff-tree', '--no-commit-id', '--name-status', '-r', '--root', hash]);
    } catch { return { error: 'git error', status: 500 }; }
    const files = ns.split('\n').filter(Boolean).map((line) => {
      const [code, ...rest] = line.split('\t');
      return { x: code[0], y: '', path: rest[rest.length - 1] };
    });
    return { message, files };
  }

  return { resolveRepo, isRepo, detectRepos, status, log, branches, diff, commit };
}

export const defaultGit = createGit({ home: homedir(), extraRoots: defaultExtraRoots() });
