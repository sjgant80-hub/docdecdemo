// bench/mm/run-docdec.mjs — DocDec v2, as sealed, answers every question of a Memory Model set, once.
//   node bench/mm/run-docdec.mjs <dev | sealed> <corpus | doubled>
// It is the path of v2's multi-hop measurement (src/measure.mjs, multiHop), taken question by question:
//   1 every paragraph and question is encoded by the same ColBERT model (bench/colbert.mjs), quantised the same way
//     (int8 per token, as bench/encode.mjs does) before anything is scored;
//   2 every paragraph is scored against the question (src/late.mjs maxsim, 6 decimals, as bench/score.mjs does);
//     the 50 best are the ranked list;
//   3 the graph walk (src/graph.mjs) picks two sources with v2's sealed settings: hop1 5, and the lambda v2 chose on
//     its OWN tune split, read from data/v2/record.json. Nothing is tuned on these questions. No walk: the two best.
//   4 the reader (bench/reader.mjs: the same model, options and prompt) is shown the two; the gate (src/gate.mjs
//     decideTwo) keeps its answer only if it is found word for word in a source, and refuses otherwise.
// Writes data/v3/<set>/run-docdec-large-<corpus>.json in the row shape of bench/mm/run.mjs. A refusal is written as
// the one refusal phrase, so the one reading rule (src/mmscore.mjs) reads every system alike. A run resumes.
// MM_LIMIT=n stops after n questions (a smoke test): the file is then not complete, and a later run carries on.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import L from '../../src/late.mjs';
import G from '../../src/graph.mjs';
import GT from '../../src/gate.mjs';
import SCORE from '../../src/mmscore.mjs';
import { encodeQuery, encodeDoc, DIM, MODEL_SHA256 } from '../colbert.mjs';
import { ask, save, READER_MODEL, READER_OPTIONS, PROMPT_TWO } from '../reader.mjs';

const HERE = dirname(fileURLToPath(import.meta.url)), ROOT = join(HERE, '..', '..');
const [which, corpusName] = process.argv.slice(2);
if (!['dev', 'sealed'].includes(which) || !['corpus', 'doubled'].includes(corpusName)) { console.error('usage: node bench/mm/run-docdec.mjs <dev | sealed> <corpus | doubled>'); process.exit(2); }
const set = JSON.parse(readFileSync(join(ROOT, 'data', 'v3', 'sets.json'), 'utf8'))[which];
const sealed = JSON.parse(readFileSync(join(ROOT, 'data', 'v2', 'record.json'), 'utf8')).s3;
const HOP1 = 5, TOP = 50, LAMBDA = sealed.lambda;
if (!Number.isFinite(LAMBDA)) throw new Error('data/v2/record.json does not hold the lambda v2 chose');
const dir = join(ROOT, 'data', 'v3', which); mkdirSync(dir, { recursive: true });
const out = join(dir, `run-docdec-large-${corpusName}.json`);
const paragraphs = corpusName === 'doubled' ? [...set.corpus, ...set.noise] : set.corpus;
const questions = [...set.answerable.map((q) => ({ ...q, answerable: true })), ...set.unanswerable.map((q) => ({ ...q, answerable: false }))];
const r6 = (x) => Math.round(x * 1e6) / 1e6;
const limit = Number(process.env.MM_LIMIT) > 0 ? Number(process.env.MM_LIMIT) : Infinity;

// ── 1 encode, quantised, cached under bench/cache (one file for the set's paragraphs, one for its questions) ──
const q8 = (v) => v.map((x) => Math.max(-127, Math.min(127, Math.round(x * 127))));
async function colbert(name, items, kind) {
  const path = join(HERE, '..', 'cache', `mm-colbert-${which}-${name}.json`);
  const have = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
  let fresh = 0;
  for (const it of items) {
    if (have[it.id]) continue;
    const e = kind === 'q' ? await encodeQuery(it.text) : await encodeDoc(it.text);
    have[it.id] = { tokens: e.tokens, v: Buffer.from(Int8Array.from(e.vecs.flatMap(q8)).buffer).toString('base64') };
    if (++fresh % 50 === 0) { writeFileSync(path, JSON.stringify(have)); console.log(`  encoded ${name}: ${fresh} new`); }
  }
  if (fresh) writeFileSync(path, JSON.stringify(have));
  return new Map(items.map((it) => [it.id, { tokens: have[it.id].tokens, m: L.fromInt8(L.b64ToInt8(have[it.id].v), DIM) }]));
}
const t0 = Date.now();
const colD = await colbert('docs', paragraphs, 'd'), colQ = await colbert('q', questions.map((q) => ({ id: q.qid, text: q.text })), 'q');
console.log(`encoded: ${colD.size} paragraphs, ${colQ.size} questions · ${Math.round((Date.now() - t0) / 1000)} s`);

// ── 2 to 4, question by question ──
const g = G.build(paragraphs), P = new Map(paragraphs.map((p) => [p.id, p]));
const ident = { v: 'docdec-mm-run/1', set: which, system: 'docdec', executive: READER_MODEL, executiveOptions: READER_OPTIONS, corpus: corpusName, paragraphs: paragraphs.length, adapterSha256: null,
  sealed: { from: 'data/v2/record.json', lambda: LAMBDA, hop1: HOP1, ranked: TOP, colbertSha256: MODEL_SHA256 } };
let rec = { ...ident, seconds: 0, rows: [] };
if (existsSync(out)) { const was = JSON.parse(readFileSync(out, 'utf8')); if (Object.keys(ident).every((k) => JSON.stringify(was[k]) === JSON.stringify(ident[k]))) rec = was; }
const done = new Set(rec.rows.map((r) => r.qid)), base = rec.seconds, t1 = Date.now();
for (const [i, q] of questions.entries()) {
  if (done.has(q.qid)) continue;
  if (rec.rows.length >= limit) break;
  const t2 = Date.now(), cq = colQ.get(q.qid);
  const col = L.rank(paragraphs.map((p) => ({ id: p.id, score: r6(L.maxsim(cq.m, colD.get(p.id).m, DIM).score) })));
  const ranked = col.slice(0, TOP).map((x) => ({ id: x.id, score: x.score }));
  const w = G.walk({ text: q.text, ranked, score: Object.fromEntries(col.map((x) => [x.id, x.score])) }, g, { hop1: HOP1, lambda: LAMBDA });
  const [a, b] = w ? [w.a, w.b] : [ranked[0].id, ranked[1].id];
  const reader = await ask(PROMPT_TWO(P.get(a), P.get(b), q.text));
  const d = GT.decideTwo({ a: P.get(a), b: P.get(b), reader: reader.raw }, q.text);
  const output = d.refuse ? SCORE.REFUSAL : d.answer, read = SCORE.read(output, q);
  rec.rows.push({ qid: q.qid, answerable: q.answerable, type: q.type, question: q.text, gold: q.answerable ? q.answer : null, output, final: read.final, outcome: read.outcome, ms: Date.now() - t2,
    pair: [a, b], walked: Boolean(w), linked: w ? w.linked : null, bothSources: q.answerable ? q.gold.every((t) => t === a || t === b) : null, reader: reader.raw, refused: d.refuse ? d.why : null, cites: d.refuse ? [] : d.cites });
  rec.seconds = base + Math.round((Date.now() - t1) / 1000);
  if (rec.rows.length % 5 === 0 || i === questions.length - 1 || rec.rows.length >= limit) { writeFileSync(out, JSON.stringify(rec)); save(); console.log(`${rec.rows.length} of ${questions.length} · ${rec.seconds} s`); }
}
const order = new Map(questions.map((q, n) => [q.qid, n]));
rec.rows.sort((x, y) => order.get(x.qid) - order.get(y.qid));
rec.complete = rec.rows.length === questions.length;
writeFileSync(out, JSON.stringify(rec)); save();
const A = SCORE.tally(rec.rows.filter((r) => r.answerable).map((r) => r.outcome)), U = SCORE.tally(rec.rows.filter((r) => !r.answerable).map((r) => r.outcome));
const both = rec.rows.filter((r) => r.bothSources === true).length;
console.log(`done: docdec · ${READER_MODEL} · ${corpusName}: answerable ${A.right} right, ${A.wrong} wrong, ${A.none} no answer of ${A.n} (both sources found for ${both}); unanswerable ${U.right} refused, ${U.wrong} answered of ${U.n}; ${rec.seconds} s`);
