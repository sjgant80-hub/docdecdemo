// bench/latency.mjs — C8: how long each part of DocDec takes on THIS machine (Intel Core i7-1255U laptop, CPU only,
// 16 GB), and how many tokens the reader actually reads and writes. Run it on a quiet machine. Writes data/v2/measured.json.
// These are machine measurements: not re-derivable from the shipped data, published as measured, with the machine named.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request } from 'node:http';
import os from 'node:os';
import L from '../src/late.mjs';
import G from '../src/graph.mjs';
import S5 from '../src/stats.mjs';
import { encodeQuery, load } from './colbert.mjs';
import { READER_MODEL, PROMPT_ONE } from './reader.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const C = (f) => join(HERE, 'cache', f);
const J = (f) => JSON.parse(readFileSync(C(f), 'utf8'));
const S = J('sets.json');
const N = 30;
const qs = S.small.questions.slice(Math.floor(S.small.questions.length * 0.3)).slice(0, N);
const med = (xs) => Math.round(S5.median(xs) * 10) / 10;
const loadCol = (file) => { const out = new Map(); for (const [id, e] of Object.entries(J(file))) out.set(id, L.fromInt8(L.b64ToInt8(e.v), 96)); return out; };
await load(); await encodeQuery('warm up');
const colDocs = loadCol('colbert-docs-full.json');
const small = S.small.paragraphs.map((p) => colDocs.get(p.id)), full = S.full.paragraphs.map((p) => colDocs.get(p.id));
const t = { encode: [], maxsimS1: [], maxsimS2: [], cosineS2: [], reader: [], promptTokens: [], outputTokens: [], walk: [] };
const ncache = J('nomic-cache.json');
const { createHash } = await import('node:crypto');
const nv = (txt) => ncache[createHash('sha1').update(txt).digest('hex')];
const fullN = S.full.paragraphs.map((p) => nv(p.text));
const textOf = new Map(S.full.paragraphs.map((p) => [p.id, p.text]));
function gen(prompt) {
  const body = JSON.stringify({ model: READER_MODEL, prompt, stream: false, options: { temperature: 0, seed: 99, num_ctx: 4096, num_predict: 48 } });
  return new Promise((ok, no) => { const r = request('http://127.0.0.1:11434/api/generate', { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, (res) => { let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => ok(JSON.parse(b))); }); r.on('error', no); r.setTimeout(0); r.end(body); });
}
for (const q of qs) {
  let t0 = performance.now(); const e = await encodeQuery(q.text); t.encode.push(performance.now() - t0);
  const qm = Float32Array.from(e.vecs.flat());
  t0 = performance.now(); let best = null, bs = -Infinity; small.forEach((d, i) => { const s = L.maxsim(qm, d, 96).score; if (s > bs) { bs = s; best = S.small.paragraphs[i].id; } }); t.maxsimS1.push(performance.now() - t0);
  t0 = performance.now(); for (const d of full) L.maxsim(qm, d, 96); t.maxsimS2.push(performance.now() - t0);
  const qv = nv(q.text); t0 = performance.now(); for (const v of fullN) L.cosine(qv, v); t.cosineS2.push(performance.now() - t0);
  t0 = performance.now(); const g = await gen(PROMPT_ONE(textOf.get(best), q.text)); t.reader.push(performance.now() - t0);
  t.promptTokens.push(g.prompt_eval_count); t.outputTokens.push(g.eval_count);
}
const g = G.build(S.hot.paragraphs);
const sc = J('scores.json');
for (const q of S.hot.questions.slice(150, 150 + N)) { const s = sc.hot.q[q.qid]; const t0 = performance.now(); G.walk({ text: q.text, ranked: s.col.map(([id, score]) => ({ id, score })), score: s.colOf }, g, { hop1: 5, lambda: 0.05 }); t.walk.push(performance.now() - t0); }
const mean = (xs) => Math.round(xs.reduce((a, b) => a + b, 0) / xs.length * 10) / 10;
const out = {
  machine: { cpu: os.cpus()[0].model.trim(), cores: os.cpus().length, memoryGb: Math.round(os.totalmem() / 2 ** 30), gpu: 'none used' }, n: N,
  medianMs: { colbertEncodeQuestion: med(t.encode), maxsimOver130: med(t.maxsimS1), maxsimOver1204: med(t.maxsimS2), cosineOver1204: med(t.cosineS2), graphWalk: med(t.walk), reader: med(t.reader) },
  readerTokens: { promptMean: mean(t.promptTokens), outputMean: mean(t.outputTokens), tokenizer: READER_MODEL + ' (its own tokenizer, as reported by Ollama)' },
  network: 'every call above went to 127.0.0.1 (Ollama) or ran in this process; nothing left the machine',
};
out.localSecondsPerQuestion = Math.round((out.medianMs.colbertEncodeQuestion + out.medianMs.maxsimOver1204 + out.medianMs.reader) / 100) / 10;
writeFileSync(join(HERE, '..', 'data', 'v2', 'measured.json'), JSON.stringify(out, null, 1) + '\n');
console.log(JSON.stringify(out, null, 1));
