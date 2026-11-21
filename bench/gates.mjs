// bench/gates.mjs — the mutation gate over every DocDec v2 module (witness v0.6): each must be CLEAN (every mutant
// killed by its tests, nothing excused). Writes data/v2/gates.json for the page's blueprint table; with --check (CI)
// it requires CLEAN and the same counts as the committed file instead of writing it.
//   node bench/gates.mjs --witness path/to/witness.mjs [--check]
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const W = arg('--witness') || 'C:/Users/sjgan/kar-veil/.witness/witness.mjs';
const check = process.argv.includes('--check');
export const MODULES = {
  'src/late.mjs': ['test/late.test.mjs'], 'src/gate.mjs': ['test/gate.test.mjs'], 'src/graph.mjs': ['test/graph.test.mjs'],
  'src/memory.mjs': ['test/memory.test.mjs'], 'src/stats.mjs': ['test/small.test.mjs'], 'src/hyper.mjs': ['test/small.test.mjs'],
  'src/conduct.mjs': ['test/small.test.mjs'], 'src/cost.mjs': ['test/cost.test.mjs'], 'src/measure.mjs': ['test/mini.test.mjs'],
  'src/assemble.mjs': ['test/mini.test.mjs'], 'src/publish.mjs': ['test/mini.test.mjs'], 'src/examples.mjs': ['test/mini.test.mjs'],
  'src/wordpiece.mjs': ['test/wordpiece.test.mjs'], 'src/foldcache.mjs': ['test/foldcache.test.mjs'],
  'genome/cell.mjs': ['test/genome.test.mjs'], 'genome/lane-share.mjs': ['test/genome.test.mjs'],
};
const out = { witness: 'v0.6', files: {} };
let bad = 0;
for (const [file, tests] of Object.entries(MODULES)) {
  let text;
  try { text = execFileSync('node', [W, 'mutate', file, '--cap', '100000', '--timeout', '60000', '--test', 'node', '--test', ...tests], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 }); }
  catch (e) { text = String(e.stdout || ''); }
  const j = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  const r = { total: j.total, killed: j.killed, survived: j.survived.length, ignored: j.ignored.length, clean: j.clean === true && j.capped === false };
  out.files[file] = r;
  console.log(`${r.clean ? 'CLEAN' : 'NOT CLEAN'} ${r.killed}/${r.total} ${file}`);
  for (const s of j.survived) console.log(`   survived line ${s.line}: ${s.mutation} | ${s.snippet}`);
  if (!r.clean) bad++;
}
if (check) {
  const committed = JSON.parse(readFileSync(join(ROOT, 'data', 'v2', 'gates.json'), 'utf8'));
  for (const [f, r] of Object.entries(out.files)) {
    const c = committed.files[f];
    if (!c || c.killed !== r.killed || c.total !== r.total) { console.error(`::error::${f}: committed ${c ? c.killed + '/' + c.total : 'missing'}, measured ${r.killed}/${r.total}`); bad++; }
  }
} else writeFileSync(join(ROOT, 'data', 'v2', 'gates.json'), JSON.stringify(out, null, 1) + '\n');
if (bad) { console.error(`${bad} problem(s)`); process.exit(1); }
console.log('mutation gate: every module CLEAN');
