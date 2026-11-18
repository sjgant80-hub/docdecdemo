// bench/parity-web.mjs — is the page's in-browser late interaction the SAME as the one that made the published numbers?
// 1. tokenizer: src/wordpiece.mjs vs the model's own tokenizer.json (transformers.js), id for id, on every question and
//    paragraph DocDec was measured on
// 2. runtime: the page's runtime (onnxruntime-web, WebAssembly, single thread, the exact version the page loads) vs
//    onnxruntime-node (which encoded the bench), on every S1 and off-topic question: int8 vectors, the top-1 passage,
//    and the gate's decision on checks 1-3
// Writes data/v2/parity.json, which the page quotes.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ortw from 'onnxruntime-web';
import { AutoTokenizer, env } from '@huggingface/transformers';
import WP from '../src/wordpiece.mjs';
import L from '../src/late.mjs';
import GT from '../src/gate.mjs';
import { MODEL_DIR, MODEL_FILE } from './colbert.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const S = JSON.parse(readFileSync(join(HERE, 'cache', 'sets.json'), 'utf8'));
const cfg = JSON.parse(readFileSync(join(MODEL_DIR, 'onnx_config.json'), 'utf8'));
const vocab = WP.vocabFrom(readFileSync(join(MODEL_DIR, 'vocab.txt'), 'utf8'));
env.allowRemoteModels = false; env.localModelPath = join(HERE, 'models');
const tok = await AutoTokenizer.from_pretrained('answerai-colbert-small-v1');
const ref = (t) => Array.from(tok(String(t), { add_special_tokens: false }).input_ids.data, Number);

// ── 1 · tokenizer ──
const texts = [...S.small.questions.map((q) => q.text), ...S.small.outOfScope.map((q) => q.text), ...S.hot.questions.map((q) => q.text), ...S.full.paragraphs.map((p) => p.text)];
let same = 0; const mism = [];
for (const t of texts) { const a = WP.tokenize(t, vocab), b = ref(t); if (a.length === b.length && a.every((x, i) => x === b[i])) same++; else if (mism.length < 5) mism.push(t.slice(0, 80)); }
console.log(`tokenizer: ${same} of ${texts.length} texts tokenised identically`);

// ── 2 · runtime ──
ortw.env.wasm.numThreads = 1;
const sess = await ortw.InferenceSession.create(readFileSync(join(MODEL_DIR, MODEL_FILE)));
const qcol = { ...JSON.parse(readFileSync(join(HERE, 'cache', 'colbert-q-small.json'), 'utf8')), ...JSON.parse(readFileSync(join(HERE, 'cache', 'colbert-q-oos.json'), 'utf8')) };
const dcol = JSON.parse(readFileSync(join(HERE, 'cache', 'colbert-docs-full.json'), 'utf8'));
const docs = S.small.paragraphs.map((p) => ({ id: p.id, tokens: dcol[p.id].tokens, m: L.fromInt8(L.b64ToInt8(dcol[p.id].v), 96) }));
const rec = JSON.parse(readFileSync(join(ROOT, 'data', 'v2', 'record.json'), 'utf8'));
const t = rec.chosen.v2.t, e = rec.chosen.v2.e;
const q8 = (x) => Math.max(-127, Math.min(127, Math.round(x * 127)));
async function webEncode(text) {
  const { ids, mask } = WP.queryIds(text, vocab, cfg);
  const n = ids.length;
  const out = await sess.run({ input_ids: new ortw.Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, n]), attention_mask: new ortw.Tensor('int64', BigInt64Array.from(mask.map(BigInt)), [1, n]), token_type_ids: new ortw.Tensor('int64', new BigInt64Array(n), [1, n]) });
  const d = out[sess.outputNames[0]].data; const v = new Int8Array(n * 96);
  for (let i = 0; i < n; i++) { let s = 0; for (let k = 0; k < 96; k++) s += d[i * 96 + k] ** 2; s = Math.sqrt(s) || 1; for (let k = 0; k < 96; k++) v[i * 96 + k] = q8(d[i * 96 + k] / s); }
  return { v };
}
const decide = (qm, qtokens) => {
  const ranked = L.rank(docs.map((d) => { const m = L.maxsim(qm, d.m, 96); return { id: d.id, score: Math.round(m.score * 1e6) / 1e6, m, tokens: d.tokens }; }));
  const top = ranked[0]; const ev = L.evidence(qtokens, top.m.sims, top.m.best, top.tokens);
  const g = GT.decide({ id: top.id, score: top.score, weakest: Math.round(ev.weakest * 1e6) / 1e6, weakestToken: ev.weakestToken }, { bar: t, evidence: e });
  return { top: top.id, score: top.score, pass: !g.refuse };
};
let vals = 0, valsSame = 0, maxDiff = 0, topSame = 0, gateSame = 0, scoreMaxDiff = 0, n = 0;
const qs = [...S.small.questions, ...S.small.outOfScope];
for (const q of qs) {
  const w = await webEncode(q.text);
  const b = L.b64ToInt8(qcol[q.qid].v);
  for (let i = 0; i < b.length; i++) { vals++; const d = Math.abs(b[i] - w.v[i]); if (d === 0) valsSame++; if (d > maxDiff) maxDiff = d; }
  const A = decide(L.fromInt8(w.v, 96), qcol[q.qid].tokens), B = decide(L.fromInt8(b, 96), qcol[q.qid].tokens);
  n++; if (A.top === B.top) topSame++; if (A.pass === B.pass) gateSame++; scoreMaxDiff = Math.max(scoreMaxDiff, Math.abs(A.score - B.score));
}
const out = { runtime: 'onnxruntime-web 1.31.0-dev.20260914-8d85527a0 (WebAssembly, one thread): the exact build the page loads', against: 'onnxruntime-node 1.30.0, which encoded every published number',
  tokenizer: { texts: texts.length, identical: same, firstMismatches: mism },
  vectors: { values: vals, identical: valsSame, maxDifference127ths: maxDiff },
  questions: n, sameTopPassage: topSame, sameGateDecision: gateSame, maxScoreDifference: Math.round(scoreMaxDiff * 1e6) / 1e6, gateSetting: { t, e } };
writeFileSync(join(ROOT, 'data', 'v2', 'parity.json'), JSON.stringify(out, null, 1) + '\n');
console.log(JSON.stringify(out, null, 1));
