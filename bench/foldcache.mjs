// bench/foldcache.mjs — G1 (PREREG.md §8): what the retrieval memo saves when the SAME question is asked again on an
// unchanged index, on THIS machine. Shipped data only (data/v2/s1.json, s4.json, scores-s1.json), so anyone can run it.
// The times are machine measurements: published as measured, with the machine named, never re-derived. The correctness
// checks (a) and (b) are re-checked in CI on a sample of the shipped questions (test/record.test.mjs).
// Writes data/v2/foldcache.json.
//   node bench/foldcache.mjs [--note "what else was running"]
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import os from 'node:os';
import { scorer } from '../src/assemble.mjs';
import FC from '../src/foldcache.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const J = (f) => JSON.parse(readFileSync(join(ROOT, 'data', 'v2', f), 'utf8'));
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const ROUNDS = 3, CAPACITY = 1000;
const freeAtStart = Math.round(os.freemem() / 2 ** 30 * 10) / 10;
const s1 = J('s1.json'), s4 = J('s4.json'), shipped = J('scores-s1.json').q;
const evalQ = s1.questions.slice(Math.floor(s1.questions.length * 0.3));
if (new Set(evalQ.map((q) => FC.questionKey(q.text))).size !== evalQ.length) throw new Error('two eval questions share a key: the cold pass would not be cold');

// index A: the 130 S1 passages. Index B: the S4 changes landed, each changed passage replaced by its later version.
const later = new Map(s4.items.map((f) => [f.sourceId, f.v2.id]));
const docsA = s1.paragraphs.map((p) => ({ id: p.id })), docsB = s1.paragraphs.map((p) => ({ id: later.get(p.id) || p.id }));
const versionA = FC.indexVersion(docsA.map((d) => d.id)), versionB = FC.indexVersion(docsB.map((d) => d.id));
// the passages are decoded once, before any timing, as a running index is held in memory
const scoreA = scorer(docsA, s1.col.docs, s1.nomic.docs);
const scoreB = scorer(docsB, { ...s1.col.docs, ...s4.col }, { ...s1.nomic.docs, ...s4.nomic });
const of = (score, q) => () => score(s1.col.q[q.qid], s1.nomic.q[q.qid]);

const cold = [], warm = [];
let coldEqualsShipped = true, coldWasMiss = true, warmIsKept = true, memo = null;
for (let r = 0; r < ROUNDS; r++) {
  memo = FC.createMemo(CAPACITY);
  const kept = new Map();
  for (const q of evalQ) {
    const t0 = performance.now(); const x = FC.scored(memo, q.text, versionA, of(scoreA, q)); cold.push(performance.now() - t0);
    if (x.hit) coldWasMiss = false;
    if (!isDeepStrictEqual(x.value, shipped[q.qid])) coldEqualsShipped = false;
    kept.set(q.qid, x.value);
  }
  for (const q of evalQ) {
    const t0 = performance.now(); const x = FC.scored(memo, q.text, versionA, of(scoreA, q)); warm.push(performance.now() - t0);
    if (!x.hit || x.value !== kept.get(q.qid)) warmIsKept = false;
  }
}
const before = { hits: memo.hits, misses: memo.misses, evicted: memo.evicted };
// the S4 changes land: every question asked again under index B's version
let answeredFromMemo = 0, equalsFresh = true, changed = 0;
for (const q of evalQ) {
  const x = FC.scored(memo, q.text, versionB, of(scoreB, q));
  if (x.hit) answeredFromMemo++;
  if (!isDeepStrictEqual(x.value, of(scoreB, q)())) equalsFresh = false;
  if (!isDeepStrictEqual(x.value, shipped[q.qid])) changed++;
}
const at = (xs, f) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(f * s.length))]; };
const median = (xs) => { const s = [...xs].sort((a, b) => a - b), h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };
const ms = (x) => Math.round(x * 1000) / 1000;
const coldMed = median(cold), warmMed = median(warm);
const g1 = { a: coldEqualsShipped && coldWasMiss && warmIsKept, b: answeredFromMemo === 0 && equalsFresh, c: warmMed <= coldMed / 10 };
g1.pass = g1.a && g1.b && g1.c;
const out = {
  what: 'G1 (PREREG section 8): the retrieval memo, the same question asked again on an unchanged index',
  machine: { cpu: os.cpus()[0].model.trim(), cores: os.cpus().length, memoryGb: Math.round(os.totalmem() / 2 ** 30), freeMemoryGbAtStart: freeAtStart },
  conditions: { note: arg('--note') || 'none given' },
  questions: evalQ.length, passages: docsA.length, rounds: ROUNDS, capacity: CAPACITY, timed: { cold: cold.length, warm: warm.length },
  ms: { cold: { median: ms(coldMed), p90: ms(at(cold, 0.9)) }, warm: { median: ms(warmMed), p90: ms(at(warm, 0.9)) } },
  memoLastRound: before,
  checks: { coldEqualsShippedTable: coldEqualsShipped, everyColdCallMissed: coldWasMiss, warmIsWhatColdKept: warmIsKept,
    afterIndexChange: { answeredFromMemo, equalsFreshComputation: equalsFresh, resultsThatChanged: changed, evictedByTheChange: memo.evicted - before.evicted } },
  timesFaster: Math.round(coldMed / warmMed),
  g1,
  notCounted: 'encoding the question with the model (in the speed table; a hit skips it too) and the reader',
};
writeFileSync(join(ROOT, 'data', 'v2', 'foldcache.json'), JSON.stringify(out, null, 1) + '\n');
console.log(JSON.stringify(out, null, 1));
