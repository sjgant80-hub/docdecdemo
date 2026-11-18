// bench/export.mjs — build what the repo ships (data/v2/*.json) from bench/cache, then measure it with the SAME pure
// code CI and the page run (src/assemble.mjs → src/measure.mjs → src/examples.mjs) and write data/v2/record.json.
// Also writes bench/cache/needs.json (reader calls the measurement asked for that are not cached yet) and
// bench/cache/hot-pairs.json (the multi-hop pairs, once the walk's lambda is chosen on tune).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { assemble } from '../src/assemble.mjs';
import { measure } from '../src/measure.mjs';
import { pick } from '../src/examples.mjs';
import { v1Outcomes } from '../src/v1.mjs';
import { publishable } from '../src/publish.mjs';
import { READER_MODEL, READER_OPTIONS, PROMPT_ONE, PROMPT_TWO } from './reader.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const C = (f) => join(HERE, 'cache', f);
const J = (f) => JSON.parse(readFileSync(C(f), 'utf8'));
const OUT = join(ROOT, 'data', 'v2');
mkdirSync(OUT, { recursive: true });
const S = J('sets.json');
const ncache = J('nomic-cache.json');
const sha1 = (t) => createHash('sha1').update(t).digest('hex');
const i16 = (v) => Buffer.from(Int16Array.from(v.map((x) => Math.round(x * 1000))).buffer).toString('base64');
const nom = (text, kind) => { const N = ncache[sha1(text)], P = ncache[sha1((kind === 'q' ? 'search_query: ' : 'search_document: ') + text)]; if (!N || !P) throw new Error('missing nomic: ' + text.slice(0, 50)); return { N: i16(N), P: i16(P) }; };
const colAll = { ...J('colbert-docs-full.json'), ...J('colbert-q-small.json'), ...J('colbert-q-oos.json') };
const pickIds = (ids) => Object.fromEntries(ids.map((id) => [id, colAll[id]]));

const F = {};
F.s1 = { paragraphs: S.small.paragraphs, questions: S.small.questions, oos: S.small.outOfScope,
  col: { docs: pickIds(S.small.paragraphs.map((p) => p.id)), q: pickIds(S.small.questions.map((q) => q.qid)), oos: pickIds(S.small.outOfScope.map((q) => q.qid)) },
  nomic: { docs: Object.fromEntries(S.small.paragraphs.map((p) => [p.id, nom(p.text, 'd')])), q: Object.fromEntries(S.small.questions.map((q) => [q.qid, nom(q.text, 'q')])),
    oos: Object.fromEntries(S.small.outOfScope.map((q) => [q.qid, nom(q.text, 'q')])) } };
const sc = J('scores.json');
F.s2 = { paragraphs: S.full.paragraphs, scores: sc.full.q };
F.s3 = { paragraphs: S.hot.paragraphs, questions: S.hot.questions, scores: sc.hot.q };
const colFresh = J('colbert-docs-fresh.json');
F.s4 = { items: S.fresh, col: colFresh, nomic: Object.fromEntries(S.fresh.map((f) => [f.v2.id, nom(f.v2.text, 'd')])) };
if (existsSync(C('paraphrases.json')) && existsSync(C('colbert-q-para.json'))) {
  F.s5 = { paraphrases: J('paraphrases.json'), col: { para: J('colbert-q-para.json'), orig: J('colbert-dq-small.json') } };
}
if (existsSync(C('h1-nodes.json'))) F.h1 = { nodes: J('h1-nodes.json').map((n) => ({ id: n.id, depth: n.depth, paragraph: n.paragraph, text: n.text, N: i16(n.v.cosN), P: i16(n.v.cosP) })) };
F.v1 = v1Outcomes(JSON.parse(readFileSync(join(ROOT, 'eval-data.json'), 'utf8')));
if (F.v1.qids.join() !== S.small.questions.slice(Math.floor(S.small.questions.length * 0.3)).map((q) => q.qid).join()) throw new Error('v1 eval split differs from v2 eval split');

// ── the reader outputs: exactly the ones the measurement consults. The measurement is run against a lookup that answers
// from the reader cache and records every key it is asked for; those keys (and only those) are shipped, and the ones
// the cache does not hold yet are written to needs.json for `node read-jobs.mjs needs`. Run export → needs → export
// until it reports nothing wanted: the shipped record is then complete, and CI consults exactly the shipped keys.
const rc = J('reader-cache.json');
const cacheKey = (prompt) => sha1(READER_MODEL + JSON.stringify(READER_OPTIONS) + prompt);
const qText = new Map([...S.small.questions.map((q) => [q.qid, q.text]), ...S.small.outOfScope.map((q) => [q.qid, q.text]), ...(F.s5 ? Object.entries(F.s5.paraphrases).map(([k, v]) => ['para:' + k, v]) : [])]);
const pText = new Map([...S.full.paragraphs.map((p) => [p.id, p.text]), ...S.small.paragraphs.map((p) => [p.id + '@v1', p.text]), ...S.fresh.map((f) => [f.v2.id, f.v2.text])]);
const P3 = new Map(S.hot.paragraphs.map((p) => [p.id, p]));
const one = {}, two = {}, wanted = [], seen = new Set();
const look = (key, prompt, into) => { if (!seen.has(key)) { seen.add(key); const hit = rc[cacheKey(prompt)]; if (hit) into[key] = hit.raw; else wanted.push({ key, prompt }); } return into[key]; };
const oneLookup = new Proxy({}, { get: (_, key) => { if (typeof key !== 'string') return undefined; const i = key.lastIndexOf('|'); const qid = key.slice(0, i), pid = key.slice(i + 1);
  if (!qText.has(qid) || !pText.has(pid)) throw new Error('no text for reader key ' + key); return look(key, PROMPT_ONE(pText.get(pid), qText.get(qid)), one); } });
const hotQ = new Map(S.hot.questions.map((q) => [q.qid, q.text]));
const twoLookup = new Proxy({}, { get: (_, key) => { if (typeof key !== 'string') return undefined; const [qid, a, b] = key.split('|'); return look(key, PROMPT_TWO(P3.get(a), P3.get(b), hotQ.get(qid)), two); } });
const pre = assemble({ ...F, reader: { one: {}, two: {} } });

// ── measure: exactly what CI and the page run ──
const t0 = Date.now();
F.reader = { model: READER_MODEL, options: READER_OPTIONS, one: oneLookup, two: twoLookup };
const { D } = assemble(F, { s1Scores: pre.s1Scores, oosScores: pre.oosScores, s4Scores: pre.s4Scores, qq: pre.qq, paraScores: pre.paraScores });
let rec = measure(D);
// the multi-hop pairs are only known once the walk's bonus is chosen; ask for both pairs of every eval question
for (const [qid, pairs] of Object.entries(rec.hotPairs)) for (const [a, b] of pairs) twoLookup[qid + '|' + a + '|' + b];
rec = measure(D);
const examples = pick(F, D, rec);
F.reader = { model: READER_MODEL, options: READER_OPTIONS, one: Object.fromEntries(Object.entries(one).sort()), two: Object.fromEntries(Object.entries(two).sort()) };
writeFileSync(C('hot-pairs.json'), JSON.stringify(rec.hotPairs));
writeFileSync(C('needs.json'), JSON.stringify(wanted));
const record = publishable(rec, examples, { squadSha256: S.squadSha256, hotpotSha256: S.hotpotSha256,
  colbert: 'answerdotai/answerai-colbert-small-v1 model_int8.onnx sha256 de45baeaa7a48cda647fcf71582e2a0920dca303654034570aa6144d84526283', reader: READER_MODEL, readerOptions: READER_OPTIONS });
for (const [name, obj] of Object.entries({ s1: F.s1, s2: F.s2, s3: F.s3, s4: F.s4, s5: F.s5, h1: F.h1, reader: F.reader, v1: F.v1 })) if (obj) writeFileSync(join(OUT, name + '.json'), JSON.stringify(obj));
writeFileSync(join(OUT, 'record.json'), JSON.stringify(record, null, 1) + '\n');
writeFileSync(join(OUT, 'scores-s1.json'), JSON.stringify({ q: pre.s1Scores, oos: pre.oosScores, s4: pre.s4Scores, qq: pre.qq, para: pre.paraScores }));
// the in-browser box: the guild corpus's token vectors, the tune-chosen gate, and where the model and runtime come from
const ORT = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.0-dev.20260914-8d85527a0/dist/';
const mcfg = JSON.parse(readFileSync(join(HERE, 'models', 'answerai-colbert-small-v1', 'onnx_config.json'), 'utf8'));
writeFileSync(join(OUT, 'freebox.json'), JSON.stringify({
  docs: S.small.paragraphs.map((p) => ({ id: p.id, title: p.title, text: p.text, tokens: F.s1.col.docs[p.id].tokens, v: F.s1.col.docs[p.id].v })),
  gate: { t: rec._chosen.v2.t, e: rec._chosen.v2.e },
  config: { query_length: mcfg.query_length, query_prefix_id: mcfg.query_prefix_id, mask_token_id: mcfg.mask_token_id },
  model: { url: 'https://huggingface.co/answerdotai/answerai-colbert-small-v1/resolve/main/model_int8.onnx', sha256: 'de45baeaa7a48cda647fcf71582e2a0920dca303654034570aa6144d84526283', licence: 'Apache-2.0' },
  ort: { module: ORT + 'ort.wasm.min.mjs', wasmPaths: ORT } }));
writeFileSync(join(OUT, 'vocab.txt'), readFileSync(join(HERE, 'models', 'answerai-colbert-small-v1', 'vocab.txt')));
console.log(`measured in ${((Date.now() - t0) / 1000).toFixed(1)} s · reader calls still wanted: ${wanted.length} · complete: ${record.complete}`);
const c = record.claims; for (const [k, v] of Object.entries(c)) console.log(`  ${k} ${v.pass ? 'PASS' : 'FAIL'}  ${v.claim}`);
