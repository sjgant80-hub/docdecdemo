// bench/encode-extra.mjs — the encodings that depend on earlier steps:
//   S5: ColBERT query vectors of every paraphrase ("para:<qid>"), and every ORIGINAL question encoded as a document
//       (so a new question can be matched against remembered ones by the same MaxSim)
//   H1: nomic vectors (both prefix variants) for the mixed-granularity index of S1: 3 article nodes, 130 paragraph
//       nodes, and every sentence. An article node is its title plus its first paragraph's first sentence.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request } from 'node:http';
import { createHash } from 'node:crypto';
import { encodeQuery, encodeDoc } from './colbert.mjs';
import GT from '../src/gate.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const C = (f) => join(HERE, 'cache', f);
const J = (f) => JSON.parse(readFileSync(C(f), 'utf8'));
const S = J('sets.json');
const q8 = (v) => v.map((x) => Math.max(-127, Math.min(127, Math.round(x * 127))));
const pack = (e) => ({ tokens: e.tokens, v: Buffer.from(Int8Array.from(e.vecs.flatMap(q8)).buffer).toString('base64') });

const para = J('paraphrases.json');
const qp = existsSync(C('colbert-q-para.json')) ? J('colbert-q-para.json') : {};
for (const q of S.small.questions) if (!qp['para:' + q.qid]) qp['para:' + q.qid] = pack(await encodeQuery(para[q.qid] || ''));
writeFileSync(C('colbert-q-para.json'), JSON.stringify(qp));
const dq = existsSync(C('colbert-dq-small.json')) ? J('colbert-dq-small.json') : {};
for (const q of S.small.questions) if (!dq[q.qid]) dq[q.qid] = pack(await encodeDoc(q.text));
writeFileSync(C('colbert-dq-small.json'), JSON.stringify(dq));
console.log(`S5: ${Object.keys(qp).length} paraphrases + ${Object.keys(dq).length} remembered questions encoded`);

// H1 nodes — sentence split by the gate's own sentence rule (bestSentence's splitter), so a node is real source text
export function sentencesOf(text) { const out = []; const re = /[^.!?]+[.!?]*/g; let m; while ((m = re.exec(text)) !== null) { const t = m[0].trim(); if (t.length >= 20) out.push(t); } return out; }
const nodes = [];
for (const title of [...new Set(S.small.paragraphs.map((p) => p.title))]) {
  const first = S.small.paragraphs.find((p) => p.title === title);
  nodes.push({ id: 'article:' + title, depth: 1, paragraph: null, text: title.replace(/_/g, ' ') + '. ' + (sentencesOf(first.text)[0] || '') });
}
for (const p of S.small.paragraphs) nodes.push({ id: p.id, depth: 2, paragraph: p.id, text: p.text });
for (const p of S.small.paragraphs) sentencesOf(p.text).forEach((s, i) => nodes.push({ id: p.id + '/s' + i, depth: 3, paragraph: p.id, text: s }));
const ncache = J('nomic-cache.json');
const key = (t) => createHash('sha1').update(t).digest('hex');
function embed(text) {
  const k = key(text);
  if (ncache[k]) return Promise.resolve(ncache[k]);
  const body = JSON.stringify({ model: 'nomic-embed-text', prompt: text });
  return new Promise((ok, no) => {
    const r = request('http://127.0.0.1:11434/api/embeddings', { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, (res) => {
      let b = ''; res.setEncoding('utf8'); res.on('data', (c) => (b += c)); res.on('end', () => { try { const j = JSON.parse(b); ncache[k] = j.embedding.map((x) => Math.round(x * 1000) / 1000); ok(ncache[k]); } catch (e) { no(e); } });
    });
    r.on('error', no); r.setTimeout(0); r.end(body);
  });
}
for (const n of nodes) n.v = { cosN: await embed(n.text), cosP: await embed('search_document: ' + n.text) };
writeFileSync(C('nomic-cache.json'), JSON.stringify(ncache));
writeFileSync(C('h1-nodes.json'), JSON.stringify(nodes));
console.log(`H1: ${nodes.length} nodes (${nodes.filter((n) => n.depth === 1).length} article / ${nodes.filter((n) => n.depth === 2).length} paragraph / ${nodes.filter((n) => n.depth === 3).length} sentence)`);
void GT;
