// Shared JSON-store persistence for the small single-writer runtime registries (push subs, previews).
// Both hold their records IN MEMORY (loaded once at startup) and flush the whole array on each mutation —
// there is only ever one server process, so the in-memory copy is the source of truth and a read never
// touches disk. Writes are atomic (tmp + rename) so a concurrent reader (or a crash mid-write) can never
// observe a half-written file. Persistence is best-effort: a lost flush just means the client re-subscribes
// / the preview is re-registered next launch.
import fs from 'node:fs';
import path from 'node:path';

// Read a JSON array from `file`, tolerating missing/corrupt/non-array content (→ []). Never throws.
export function readJsonArray(file) {
  try { const v = JSON.parse(fs.readFileSync(file, 'utf8')); return Array.isArray(v) ? v : []; }
  catch { return []; }
}

// Atomic write: serialize `obj` to a sibling .tmp then rename over `file` (atomic on the same fs).
export function writeJsonAtomic(file, obj) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(obj));
    fs.renameSync(tmp, file);
  } catch { /* best effort — a lost flush is recoverable by the client re-registering */ }
}
