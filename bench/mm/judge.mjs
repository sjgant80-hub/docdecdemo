// bench/mm/judge.mjs — the verdicts of a set, from its runs on file. src/mmscore.mjs decides everything; this reads
// the files and writes data/v3/<set>/record.json. A run that is missing or not whole leaves its claims not measured.
//   node bench/mm/judge.mjs <dev | sealed> [--ended]      (--ended: the run is over; an unmeasured claim now dissolves it)
// The dev set's record is published and is never a claim.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import SCORE from '../../src/mmscore.mjs';

const HERE = dirname(fileURLToPath(import.meta.url)), ROOT = join(HERE, '..', '..');
const which = process.argv[2];
if (!['dev', 'sealed'].includes(which)) { console.error('usage: node bench/mm/judge.mjs <dev | sealed> [--ended]'); process.exit(2); }
const set = JSON.parse(readFileSync(join(ROOT, 'data', 'v3', 'sets.json'), 'utf8'))[which], dir = join(ROOT, 'data', 'v3', which);
const load = (system, exec, corpus) => { const f = join(dir, `run-${system}-${exec}-${corpus}.json`); if (!existsSync(f)) return null; const r = JSON.parse(readFileSync(f, 'utf8')); return r.complete === true ? r : null; };
const part = (r, answerable) => (r ? r.rows.filter((x) => x.answerable === answerable).map((x) => x.outcome) : null);
const runs = { mm: { corpus: load('mm', 'large', 'corpus'), doubled: load('mm', 'large', 'doubled') }, mmEdge: { corpus: load('mm', 'edge', 'corpus') }, rag: { corpus: load('rag', 'large', 'corpus'), doubled: load('rag', 'large', 'doubled') }, docdec: { corpus: load('docdec', 'large', 'corpus'), doubled: load('docdec', 'large', 'doubled') }, closed: { corpus: load('closed', 'large', 'corpus') }, closedEdge: { corpus: load('closed', 'edge', 'corpus') } };
const build = existsSync(join(dir, 'build.json')) ? JSON.parse(readFileSync(join(dir, 'build.json'), 'utf8')) : null;
const input = {
  nAnswerable: set.answerable.length, nUnanswerable: set.unanswerable.length, ended: process.argv.includes('--ended'),
  answerable: Object.fromEntries(['mm', 'mmEdge', 'rag', 'docdec'].map((s) => [s, Object.fromEntries(Object.entries(runs[s]).map(([c, r]) => [c, part(r, true)]))])),
  unanswerable: Object.fromEntries(['mm', 'rag', 'docdec'].map((s) => [s, { corpus: part(runs[s].corpus, false) }])),
  integrity: { ...(build ? build.integrity : {}), adapterSha256: runs.mm.corpus ? runs.mm.corpus.adapterSha256 : null, adapterSha256Edge: runs.mmEdge.corpus ? runs.mmEdge.corpus.adapterSha256 : null },
};
const v = SCORE.verdicts(input);
const table = Object.fromEntries(Object.entries(runs).flatMap(([s, cs]) => Object.entries(cs).filter(([, r]) => r).map(([c, r]) => [`${s}/${c}`, { executive: r.executive, answerable: SCORE.tally(part(r, true)), unanswerable: SCORE.tally(part(r, false)), seconds: r.seconds }])));
const record = { v: 'docdec-mm-record/1', set: which, claim: which === 'sealed', note: which === 'dev' ? 'the dev round: published, and never a claim' : 'the sealed run', ...v, runs: table, build: build ? { corpus: build.corpus && { examples: build.corpus.examples, kinds: build.corpus.kinds, written: build.corpus.written, grounded: build.corpus.grounded }, doubled: build.doubled && { examples: build.doubled.examples }, generatorSeconds: build.generatorSeconds } : null };
writeFileSync(join(dir, 'record.json'), JSON.stringify(record, null, 1) + '\n');
for (const [k, t] of Object.entries(table)) console.log(`${k.padEnd(18)} ${t.executive.padEnd(12)} answerable ${String(t.answerable.right).padStart(3)} right ${String(t.answerable.wrong).padStart(3)} wrong ${String(t.answerable.none).padStart(3)} none of ${t.answerable.n} · unanswerable ${t.unanswerable.right} refused ${t.unanswerable.wrong} answered of ${t.unanswerable.n} · ${t.seconds} s`);
for (const x of v.verdicts) console.log(`${x.pass === true ? 'PASS   ' : x.pass === false ? 'FAIL   ' : 'PENDING'} ${x.id} ${x.name}: ${x.result}`);
console.log(`→ ${v.why}${which === 'dev' ? '  (the dev round: never a claim)' : ''}`);
