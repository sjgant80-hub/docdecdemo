// bench/encode.mjs — encode every set on this machine: ColBERT token vectors (L1) and nomic pooled vectors (the
// single-vector baseline), both QUANTISED before anything is measured, so the numbers DocDec publishes are exactly
// what anyone recomputes from the shipped vectors. Resumable: everything is cached under bench/cache/.
//   ColBERT: int8 per token (x*127, rounded).  nomic: 3 decimals (the v1 convention), with AND without the model's
//   documented task prefixes ("search_query: " / "search_document: "); PREREG.md §2 says which one the baseline uses.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request } from 'node:http';
import { createHash } from 'node:crypto';
import { encodeQuery, encodeDoc, DIM } from './colbert.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const C = (f) => join(HERE, 'cache', f);
const S = JSON.parse(readFileSync(C('sets.json'), 'utf8'));

// ── ColBERT, int8 ──
const q8 = (v) => v.map((x) => Math.max(-127, Math.min(127, Math.round(x * 127))));
async function colbertSet(name, items, kind) {
  const path = C(`colbert-${name}.json`);
  const have = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
  let n = 0; const t0 = Date.now();
  for (const it of items) {
    if (have[it.id]) continue;
    const e = kind === 'q' ? await encodeQuery(it.text) : await encodeDoc(it.text);
    have[it.id] = { tokens: e.tokens, v: Buffer.from(Int8Array.from(e.vecs.flatMap(q8)).buffer).toString('base64') };
    if (++n % 200 === 0) { writeFileSync(path, JSON.stringify(have)); process.stdout.write(`  colbert ${name} ${n} (${((Date.now() - t0) / n).toFixed(0)} ms each)\r`); }
  }
  writeFileSync(path, JSON.stringify(have));
  console.log(`colbert ${name}: ${items.length} encoded (${n} new) dim ${DIM}                `);
}

// ── nomic, 3 decimals, through the same Ollama endpoint v1 used ──
const ncache = existsSync(C('nomic-cache.json')) ? JSON.parse(readFileSync(C('nomic-cache.json'), 'utf8')) : {};
const key = (t) => createHash('sha1').update(t).digest('hex');
function embed(text) {
  const k = key(text);
  if (ncache[k]) return Promise.resolve(ncache[k]);
  const body = JSON.stringify({ model: 'nomic-embed-text', prompt: text });
  return new Promise((ok, no) => {
    const r = request('http://127.0.0.1:11434/api/embeddings', { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, (res) => {
      let b = ''; res.setEncoding('utf8'); res.on('data', (c) => (b += c)); res.on('end', () => { try { const j = JSON.parse(b); if (!j.embedding) return no(new Error('no embedding')); ncache[k] = j.embedding.map((x) => Math.round(x * 1000) / 1000); ok(ncache[k]); } catch (e) { no(e); } });
    });
    r.on('error', no); r.setTimeout(0); r.end(body);
  });
}
async function nomicSet(items, prefix) {
  let n = 0;
  for (const it of items) { await embed(prefix + it.text); if (++n % 500 === 0) { writeFileSync(C('nomic-cache.json'), JSON.stringify(ncache)); process.stdout.write(`  nomic ${n}/${items.length}\r`); } }
  writeFileSync(C('nomic-cache.json'), JSON.stringify(ncache));
}

const docsFull = S.full.paragraphs;
const docsFresh = S.fresh.map((f) => ({ id: f.v2.id, text: f.v2.text }));
const docsHot = S.hot.paragraphs;
const qSmall = S.small.questions.map((q) => ({ id: q.qid, text: q.text }));
const qOos = S.small.outOfScope.map((q) => ({ id: q.qid, text: q.text }));
const qHot = S.hot.questions.map((q) => ({ id: q.qid, text: q.text }));

await colbertSet('docs-full', docsFull, 'd');
await colbertSet('docs-fresh', docsFresh, 'd');
await colbertSet('q-small', qSmall, 'q');
await colbertSet('q-oos', qOos, 'q');
await colbertSet('q-hot', qHot, 'q');
await colbertSet('docs-hot', docsHot, 'd');
for (const [pd, pq] of [['', ''], ['search_document: ', 'search_query: ']]) {
  await nomicSet([...docsFull, ...docsFresh, ...docsHot], pd);
  await nomicSet([...qSmall, ...qOos, ...qHot], pq);
  console.log(`nomic ${pd ? 'with' : 'without'} task prefixes: done`);
}
console.log('encode: all sets cached');
