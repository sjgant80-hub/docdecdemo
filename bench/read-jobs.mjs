// bench/read-jobs.mjs <phase> — run the local reader over every (question, passage) the measurement can need.
//   p1: needs only ColBERT — S1/S2 ColBERT top-1, S4 fresh (flat top-1 and the memory's as-of-now top-1), S5 paraphrases
//   p2: needs scores.json  — S1/S2 cosine top-1 (both prefix variants), S3 multi-hop pairs (cosine top-2, graph walk)
//   p3: needs the paraphrase encodings — S5 cold path (ColBERT top-1 of every eval paraphrase)
// Everything goes through bench/reader.mjs's cache; re-running a phase only asks what is not cached yet.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import L from '../src/late.mjs';
import { ask, save, PROMPT_ONE, PROMPT_TWO, PROMPT_PARAPHRASE } from './reader.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const C = (f) => join(HERE, 'cache', f);
const J = (f) => JSON.parse(readFileSync(C(f), 'utf8'));
const S = J('sets.json');
const DIM = 96;
const phase = process.argv[2];
const loadCol = (file) => { const out = new Map(); for (const [id, e] of Object.entries(J(file))) out.set(id, L.fromInt8(L.b64ToInt8(e.v), DIM)); return out; };
const top1 = (qm, docs, colDocs) => { let best = null, bs = -Infinity; for (const d of docs) { const s = L.maxsim(qm, colDocs.get(d.id), DIM).score; if (s > bs || (s === bs && d.id < best.id)) { bs = s; best = d; } } return best; };
const t0 = Date.now(); let asked = 0, fresh = 0;
const ms = [];
async function read(prompt) { const r = await ask(prompt); asked++; if (!r.cached) { fresh++; ms.push(r.ms); } if (asked % 25 === 0) { save(); const m = ms.slice(-25); process.stdout.write(`  ${asked} asked, ${fresh} new, ~${m.length ? Math.round(m.reduce((a, b) => a + b, 0) / m.length) : 0} ms each, ${Math.round((Date.now() - t0) / 60000)} min\n`); } return r.raw; }

if (phase === 'p1') {
  const colDocs = loadCol('colbert-docs-full.json'), colFresh = loadCol('colbert-docs-fresh.json'), colQ = loadCol('colbert-q-small.json');
  const textOf = new Map(S.full.paragraphs.map((p) => [p.id, p.text]));
  // S1 then S2: the ColBERT top-1 passage of every question
  for (const [name, docs] of [['S1', S.small.paragraphs], ['S2', S.full.paragraphs]]) {
    for (const q of S.small.questions) { const d = top1(colQ.get(q.qid), docs, colDocs); await read(PROMPT_ONE(textOf.get(d.id), q.text)); }
    save(); console.log(`${name}: reader done on ColBERT top-1 (${asked} asked, ${fresh} new)`);
  }
  // S4: the flat index (every version) and the memory as of now (only the current versions)
  const v1 = S.small.paragraphs.map((p) => ({ id: p.id + '@v1', text: p.text, base: p.id }));
  const v2 = S.fresh.map((f) => ({ id: f.v2.id, text: f.v2.text, base: f.sourceId }));
  const changed = new Set(S.fresh.map((f) => f.sourceId));
  const all = [...v1, ...v2], now = [...v1.filter((d) => !changed.has(d.base)), ...v2];
  const cm = new Map([...v1.map((d) => [d.id, colDocs.get(d.base)]), ...v2.map((d) => [d.id, colFresh.get(d.id)])]);
  for (const f of S.fresh) for (const docs of [all, now]) { const d = top1(colQ.get(f.qid), docs, cm); await read(PROMPT_ONE(d.text, f.text)); }
  save(); console.log(`S4: reader done (${asked} asked, ${fresh} new)`);
  // S5: one paraphrase per S1 question (temperature 0.7, seed = its index) — the prompt is frozen in reader.mjs
  const para = existsSync(C('paraphrases.json')) ? J('paraphrases.json') : {};
  for (const [i, q] of S.small.questions.entries()) {
    if (para[q.qid]) continue;
    const r = await ask(PROMPT_PARAPHRASE(q.text), { temperature: 0.7, seed: i, num_ctx: 1024, num_predict: 64 });
    para[q.qid] = r.raw.split('\n').map((s) => s.trim()).filter(Boolean)[0] || '';
    if (i % 25 === 0) { writeFileSync(C('paraphrases.json'), JSON.stringify(para)); save(); }
  }
  writeFileSync(C('paraphrases.json'), JSON.stringify(para)); save();
  console.log(`S5: ${Object.keys(para).length} paraphrases written`);
}

if (phase === 'p2') {
  const sc = J('scores.json');
  const textOf = new Map(S.full.paragraphs.map((p) => [p.id, p.text]));
  for (const [name, set] of [['S1', sc.small.q], ['S2', sc.full.q]]) {
    for (const q of S.small.questions) for (const k of ['cosN', 'cosP']) await read(PROMPT_ONE(textOf.get(set[q.qid][k][0][0]), q.text));
    save(); console.log(`${name}: reader done on cosine top-1 (${asked} asked, ${fresh} new)`);
  }
  const pairs = J('hot-pairs.json'); // written by bench/measure.mjs once the walk's lambda is chosen on tune
  const hp = new Map(S.hot.paragraphs.map((p) => [p.id, p]));
  for (const q of S.hot.questions) {
    const want = pairs[q.qid]; if (!want) continue;
    for (const [a, b] of want) await read(PROMPT_TWO(hp.get(a), hp.get(b), q.text));
  }
  save(); console.log(`S3: reader done on the multi-hop pairs (${asked} asked, ${fresh} new)`);
}

if (phase === 'p3') {
  const colDocs = loadCol('colbert-docs-full.json'), colP = loadCol('colbert-q-para.json');
  const textOf = new Map(S.full.paragraphs.map((p) => [p.id, p.text]));
  const para = J('paraphrases.json');
  const cut = Math.floor(S.small.questions.length * 0.3);
  for (const q of S.small.questions.slice(cut)) { const d = top1(colP.get('para:' + q.qid), S.small.paragraphs, colDocs); await read(PROMPT_ONE(textOf.get(d.id), para[q.qid])); }
  save(); console.log(`S5: reader done on the cold path of ${S.small.questions.length - cut} eval paraphrases`);
}
if (phase === 'needs') {
  // whatever bench/export.mjs found the measurement asking for and the cache not holding
  const want = J('needs.json');
  for (const w of want) await read(w.prompt);
  save(); console.log(`needs: ${want.length} reader calls filled`);
}
console.log(`phase ${phase}: ${asked} asked, ${fresh} new, ${Math.round((Date.now() - t0) / 60000)} min`);
