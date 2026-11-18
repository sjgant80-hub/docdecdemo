// bench/score.mjs — score every question against its corpus with the gated kernels (src/late.mjs, src/graph.mjs).
// Reads the quantised encodings in bench/cache, writes bench/cache/scores.json. Nothing here chooses a threshold.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import L from '../src/late.mjs';
import G from '../src/graph.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const C = (f) => join(HERE, 'cache', f);
const J = (f) => JSON.parse(readFileSync(C(f), 'utf8'));
const S = J('sets.json');
const DIM = 96, TOP = 50, r6 = (x) => Math.round(x * 1e6) / 1e6;
const ncache = J('nomic-cache.json');
const key = (t) => createHash('sha1').update(t).digest('hex');
const nomic = (text, prefix) => { const v = ncache[key(prefix + text)]; if (!v) throw new Error('missing nomic vector: ' + text.slice(0, 60)); return v; };

function loadCol(file) {
  const raw = J(file); const out = new Map();
  for (const [id, e] of Object.entries(raw)) out.set(id, { tokens: e.tokens, m: L.fromInt8(L.b64ToInt8(e.v), DIM) });
  return out;
}
const colDocsFull = loadCol('colbert-docs-full.json'), colDocsFresh = loadCol('colbert-docs-fresh.json');
const colQ = new Map([...loadCol('colbert-q-small.json'), ...loadCol('colbert-q-oos.json'), ...loadCol('colbert-q-hot.json')]);

// score one question against a corpus: ColBERT for every doc, nomic cosine (no prefix / prefix) for every doc
function scoreAll(qid, qtext, docs, colDocs) {
  const q = colQ.get(qid); if (!q) throw new Error('no colbert query ' + qid);
  const vN = nomic(qtext, ''), vP = nomic(qtext, 'search_query: ');
  const col = [], cosN = [], cosP = [];
  for (const d of docs) {
    const cd = colDocs.get(d.id); if (!cd) throw new Error('no colbert doc ' + d.id);
    col.push({ id: d.id, score: r6(L.maxsim(q.m, cd.m, DIM).score) });
    cosN.push({ id: d.id, score: r6(L.cosine(vN, nomic(d.text, ''))) });
    cosP.push({ id: d.id, score: r6(L.cosine(vP, nomic(d.text, 'search_document: '))) });
  }
  return { q, col: L.rank(col), cosN: L.rank(cosN), cosP: L.rank(cosP) };
}
function ev(q, docId, colDocs) {
  const cd = colDocs.get(docId);
  const m = L.maxsim(q.m, cd.m, DIM);
  const e = L.evidence(q.tokens, m.sims, m.best, cd.tokens);
  return { weakest: r6(e.weakest), weakestToken: e.weakestToken };
}
const top = (ranked, n) => ranked.slice(0, n).map((x) => [x.id, x.score]);
const t0 = Date.now();
const out = { v: 'docdec-scores/1', note: 'scores rounded to 6 decimals; ColBERT = normalised MaxSim, cos = nomic cosine (N: no task prefix, P: task prefixes)' };

// ── S2 full (and S1 small is the 130-paragraph subset, scored separately against its own corpus) ──
function squadSet(docs, colDocs, questions, keepAll) {
  const res = {};
  for (const q of questions) {
    const s = scoreAll(q.qid, q.text, docs, colDocs);
    const evid = {};
    for (const x of s.col.slice(0, 3)) evid[x.id] = ev(s.q, x.id, colDocs);
    if (keepAll) res[q.qid] = { col: top(s.col, s.col.length), cosN: top(s.cosN, s.cosN.length), cosP: top(s.cosP, s.cosP.length), ev: evid };
    else {
      const colOf = new Map(s.col.map((x) => [x.id, x.score]));
      const union = new Set([...s.col.slice(0, TOP), ...s.cosN.slice(0, TOP), ...s.cosP.slice(0, TOP)].map((x) => x.id));
      res[q.qid] = { col: top(s.col, TOP), cosN: top(s.cosN, TOP), cosP: top(s.cosP, TOP), colOf: Object.fromEntries([...union].map((id) => [id, colOf.get(id)])), ev: evid };
    }
  }
  return res;
}
// (S1, the off-topic set and S4 are scored from the shipped vectors by src/assemble.mjs, in the export and in CI)
out.full = { q: squadSet(S.full.paragraphs, colDocsFull, S.small.questions, false) };
console.log(`S2 full scored (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
void colDocsFresh;

// ── S3 multi-hop: 4,937 pooled paragraphs, plus the graph's candidates for the walk ──
const colDocsHot = loadCol('colbert-docs-hot.json');
const g = G.build(S.hot.paragraphs);
let edges = 0; for (const s of g.out.values()) edges += s.size;
out.hot = { edges, q: {} };
for (const q of S.hot.questions) {
  const s = scoreAll(q.qid, q.text, S.hot.paragraphs, colDocsHot);
  const colOf = new Map(s.col.map((x) => [x.id, x.score]));
  const named = G.mentions(q.text, g.index, null);
  const hop1 = new Set([...s.col.slice(0, 5).map((x) => x.id), ...named]);
  const cand = new Set([...hop1]);
  for (const a of hop1) for (const b of g.out.get(a) || []) cand.add(b);
  for (const x of [...s.col.slice(0, TOP), ...s.cosN.slice(0, TOP), ...s.cosP.slice(0, TOP)]) cand.add(x.id);
  for (const gid of q.gold) cand.add(gid);
  out.hot.q[q.qid] = { col: top(s.col, TOP), cosN: top(s.cosN, TOP), cosP: top(s.cosP, TOP), named, colOf: Object.fromEntries([...cand].map((id) => [id, colOf.get(id)])) };
}
console.log(`S3 multi-hop scored: ${S.hot.paragraphs.length} paragraphs, ${edges} mention edges (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
writeFileSync(C('scores.json'), JSON.stringify(out));
console.log('scores → bench/cache/scores.json');
