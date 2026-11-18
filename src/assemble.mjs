// DocDec v2 · src/assemble.mjs — shipped data → the measurement's input. Pure (no I/O).
// S1 and S4 are scored HERE from the shipped vectors (ColBERT int8 tokens, nomic 3-decimal vectors) with the gated
// kernel, so CI re-derives those scores from vectors, not from a table. S2 and S3 scores are shipped as tables (their
// vectors are hundreds of MB; bench/ re-derives them on your machine), and CI checks the S1 slice of S2 against S1.
import L from './late.mjs';

const DIM = 96;
const r6 = (x) => Math.round(x * 1e6) / 1e6;
export function b64ToInt16(s) {
  let bin = '';
  try { bin = atob(typeof s === 'string' ? s : ''); } catch (_) { bin = ''; }
  const n = Math.floor(bin.length / 2);
  const out = new Array(n);
  for (let i = 0; i !== n; i++) { const u = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8); out[i] = (u > 32767 ? u - 65536 : u) / 1000; }
  return out;
}
const col = (e) => ({ tokens: e.tokens, m: L.fromInt8(L.b64ToInt8(e.v), DIM) });

// scoreSet(questions, docs, colQ, colD, nomQ, nomD) → { [qid]: { col, cosN, cosP: [[id, score]...] all docs, ev } }
export function scoreSet(questions, docs, colQ, colD, nomQ, nomD) {
  const out = {};
  const dc = new Map(docs.map((d) => [d.id, col(colD[d.id])]));
  const dn = new Map(docs.map((d) => [d.id, { N: b64ToInt16(nomD[d.id].N), P: b64ToInt16(nomD[d.id].P) }]));
  for (const q of questions) {
    const cq = col(colQ[q.qid]);
    const vN = b64ToInt16(nomQ[q.qid].N), vP = b64ToInt16(nomQ[q.qid].P);
    const c = [], n = [], p = [];
    for (const d of docs) {
      const cd = dc.get(d.id);
      const m = L.maxsim(cq.m, cd.m, DIM);
      c.push({ id: d.id, score: r6(m.score), m, tokens: cd.tokens });
      n.push({ id: d.id, score: r6(L.cosine(vN, dn.get(d.id).N)) });
      p.push({ id: d.id, score: r6(L.cosine(vP, dn.get(d.id).P)) });
    }
    const rc = L.rank(c), ev = {};
    for (const x of rc.slice(0, 3)) { const e = L.evidence(cq.tokens, x.m.sims, x.m.best, x.tokens); ev[x.id] = { weakest: r6(e.weakest), weakestToken: e.weakestToken }; }
    out[q.qid] = { col: rc.map((x) => [x.id, x.score]), cosN: L.rank(n).map((x) => [x.id, x.score]), cosP: L.rank(p).map((x) => [x.id, x.score]), ev };
  }
  return out;
}

// qqScores(paraQ, colPara, colOrigAsDoc, origIds) → { [qid]: [[origQid, score]...] best first }: a new question matched
// against every remembered question by the same MaxSim
export function qqScores(questions, colPara, colOrig) {
  const docs = questions.map((q) => ({ id: q.qid, m: col(colOrig[q.qid]).m }));
  const out = {};
  for (const q of questions) {
    const pm = col(colPara['para:' + q.qid]).m;
    out[q.qid] = L.rank(docs.map((d) => ({ id: d.id, score: r6(L.maxsim(pm, d.m, DIM).score) }))).slice(0, 10).map((x) => [x.id, x.score]);
  }
  return out;
}

// paraScores: each paraphrase against the S1 paragraphs (ColBERT only: the cache's cold path is DocDec v2)
export function paraScores(questions, docs, colPara, colD) {
  const out = {};
  const dc = new Map(docs.map((d) => [d.id, col(colD[d.id])]));
  for (const q of questions) {
    const pq = col(colPara['para:' + q.qid]);
    const c = docs.map((d) => { const cd = dc.get(d.id); const m = L.maxsim(pq.m, cd.m, DIM); return { id: d.id, score: r6(m.score), m, tokens: cd.tokens }; });
    const rc = L.rank(c), ev = {};
    for (const x of rc.slice(0, 3)) { const e = L.evidence(pq.tokens, x.m.sims, x.m.best, x.tokens); ev[x.id] = { weakest: r6(e.weakest), weakestToken: e.weakestToken }; }
    out[q.qid] = { col: rc.map((x) => [x.id, x.score]), ev };
  }
  return out;
}

// assemble(F) → D for measure(). F: the parsed shipped files { s1, s2, s3, s4, s5, h1, reader, v1 }.
// opts.s1Scores: pass the shipped S1 score table to skip re-scoring (the page's quick re-run); CI always re-scores.
export function assemble(F, opts) {
  const o = opts || {};
  const s1 = F.s1;
  const s1Scores = o.s1Scores || scoreSet(s1.questions, s1.paragraphs, s1.col.q, s1.col.docs, s1.nomic.q, s1.nomic.docs);
  const oosScores = o.oosScores || scoreSet(s1.oos, s1.paragraphs, s1.col.oos, s1.col.docs, s1.nomic.oos, s1.nomic.docs);
  // S4: every S1 paragraph as version 1 plus the 86 later versions, one flat corpus
  const v1docs = s1.paragraphs.map((p) => ({ id: p.id + '@v1' }));
  const v2docs = F.s4.items.map((f) => ({ id: f.v2.id }));
  const colD4 = { ...Object.fromEntries(s1.paragraphs.map((p) => [p.id + '@v1', s1.col.docs[p.id]])), ...F.s4.col };
  const nomD4 = { ...Object.fromEntries(s1.paragraphs.map((p) => [p.id + '@v1', s1.nomic.docs[p.id]])), ...F.s4.nomic };
  const s4q = F.s4.items.map((f) => ({ qid: f.qid }));
  const s4Scores = o.s4Scores || scoreSet(s4q, [...v1docs, ...v2docs], s1.col.q, colD4, s1.nomic.q, nomD4);
  const D = {
    s1: { paragraphs: s1.paragraphs, questions: s1.questions, oos: s1.oos, scores: s1Scores, oosScores },
    s2: { paragraphs: F.s2.paragraphs, scores: F.s2.scores },
    s3: { paragraphs: F.s3.paragraphs, questions: F.s3.questions, scores: F.s3.scores },
    s4: { items: F.s4.items, scores: s4Scores },
    reader: F.reader, v1: F.v1 || null,
  };
  if (F.s5) {
    D.s5 = { paraphrases: F.s5.paraphrases,
      qq: o.qq || qqScores(s1.questions, F.s5.col.para, F.s5.col.orig),
      paraScores: o.paraScores || paraScores(s1.questions.slice(Math.floor(s1.questions.length * 0.3)), s1.paragraphs, F.s5.col.para, s1.col.docs) };
  }
  if (F.h1) {
    D.h1 = { nodes: F.h1.nodes.map((n) => ({ ...n, v: { cosN: b64ToInt16(n.N), cosP: b64ToInt16(n.P) } })),
      questions: Object.fromEntries(s1.questions.map((q) => [q.qid, { cosN: b64ToInt16(s1.nomic.q[q.qid].N), cosP: b64ToInt16(s1.nomic.q[q.qid].P) }])) };
  }
  return { D, s1Scores, oosScores, s4Scores, qq: D.s5 ? D.s5.qq : null, paraScores: D.s5 ? D.s5.paraScores : null };
}

export default { b64ToInt16, scoreSet, qqScores, paraScores, assemble };
