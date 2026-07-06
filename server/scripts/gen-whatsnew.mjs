// Mirror the changelog's concise per-version highlights into server/package.json `whatsNew`, so an OLDER
// install can learn "what's new" in a release it doesn't have yet — fetched through the user's own npm
// (`npm view handmux@latest whatsNew`), which stays China-mirror-friendly. Source of truth is
// web/src/changelog.js; run by release.sh before the release commit (and manually to refresh in-repo).
//
// package.json is edited as TEXT, not re-serialized: a JSON.stringify round-trip would reflow the inline
// `keywords`/`files` arrays. We keep `whatsNew` as the LAST key, one compact line per entry, for clean diffs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.join(HERE, '..', 'package.json');
const CHANGELOG = path.join(HERE, '..', '..', 'web', 'src', 'changelog.js');
const KEEP = 8; // how many recent public versions to publish (a user many versions behind still sees them all)

const { CHANGELOG: entries } = await import(pathToFileURL(CHANGELOG).href);
const whatsNew = entries
  .filter((e) => e.version && e.highlight)
  .slice(0, KEEP)
  .map((e) => ({ version: e.version, date: e.date, zh: e.highlight.zh, en: e.highlight.en }));

let text = fs.readFileSync(PKG, 'utf8');
text = text.replace(/,\n\s*"whatsNew":\s*\[[\s\S]*?\n\s*\]/, ''); // drop a prior block (always the last key)
const block = '  "whatsNew": [\n'
  + whatsNew.map((e) => '    ' + JSON.stringify(e)).join(',\n')
  + '\n  ]';
text = text.replace(/\n\}\s*$/, ',\n' + block + '\n}\n');

JSON.parse(text); // guard: never write invalid JSON
fs.writeFileSync(PKG, text);
console.log(`whatsNew: wrote ${whatsNew.length} version(s) → ${path.relative(process.cwd(), PKG)}`);
