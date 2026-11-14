// docdecdemo · kernel.mjs — the grounded document router (the product's transparent grounding layer).
//
// This is the routing + grounding gate that decides, for a question: answer from a document WITH a citation, or
// ABSTAIN ("not in your documents"). It is deliberately transparent — a plain, auditable function over the
// documents' distinctive terms — because "you can read exactly why it answered or refused" is the point. The
// production engine deepens this routing privately on the customer's own hardware; these product behaviours
// (grounds, cites, abstains) do not change. A plain vector-RAG has no `route` — only a nearest-chunk `top1`.
//
// The kernel this page inlines is proven by a mutation gate in the private engine repo; here it is reproduced
// verbatim and a parity test holds the inlined copy byte-for-byte to this file.

const arr = (x) => (Array.isArray(x) ? x : []);
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
const str = (x) => (typeof x === 'string' ? x : '');

const STOP = new Set(('a an and the of to in on for is are was were be been being as at by with from this that these those it its ' +
  'which who whom whose what when where why how do does did not no nor can could would should will shall may might must ' +
  'i you he she they we me him her them us my your his their our or if then than so such about into over under out up down ' +
  'have has had been more most some any all each both few other own same very s t').split(' '));

// tokens(text) → the distinctive content tokens: lowercased words, stopwords and 1-char dropped, de-duplicated.
export function tokens(text) {
  const raw = str(text).toLowerCase().match(/[a-z0-9]+/g) || [];
  const out = [];
  const seen = new Set();
  for (const w of raw) {
    if (w.length < 2 || STOP.has(w)) continue;
    if (!seen.has(w)) { seen.add(w); out.push(w); }
  }
  return out;
}

// idf(docs) → Map term → ln(1 + N/df): a term in few documents is distinctive (high); a term in every document low.
export function idf(docs) {
  const d = arr(docs);
  const N = d.length;
  const df = new Map();
  for (const doc of d) {
    for (const t of new Set(arr(doc && doc.terms))) df.set(t, (df.get(t) || 0) + 1);
  }
  const w = new Map();
  for (const [t, c] of df) w.set(t, Math.log(1 + N / c));
  return w;
}

// score(qTerms, docTerms, idfMap) → the structural match: summed idf of the shared terms, and the shared terms (the citation).
export function score(qTerms, docTerms, idfMap) {
  const dset = new Set(arr(docTerms));
  const w = idfMap instanceof Map ? idfMap : new Map();
  let s = 0;
  const shared = [];
  for (const t of new Set(arr(qTerms))) {
    if (dset.has(t)) { s += (w.get(t) || 0); shared.push(t); }
  }
  return { score: s, shared };
}

// route(qTerms, docs, idfMap, opts) → the grounded decision: answer the best document only if its score clears
// `minScore` AND beats the runner-up by `margin`; otherwise ABSTAIN. opts { minScore=1, margin=0 }.
export function route(qTerms, docs, idfMap, opts) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const minScore = num(o.minScore) || (o.minScore === 0 ? 0 : 1);
  const margin = num(o.margin);
  const scored = arr(docs).map((d) => ({ id: d && d.id, ...score(qTerms, d && d.terms, idfMap) }));
  scored.sort((a, b) => (b.score - a.score) || String(a.id).localeCompare(String(b.id)));
  const best = scored[0];
  const second = scored[1];
  if (!best || best.score < minScore) {
    return { abstain: true, why: 'not in your documents: no document matches strongly enough' };
  }
  if (second && best.score - second.score < margin) {
    return { abstain: true, why: 'ambiguous: more than one document matches about equally' };
  }
  return { answer: best.id, cite: best.shared, score: best.score, runnerUp: second ? second.score : 0 };
}

// top1(scored) → the baseline vector-RAG decision: the single highest-scoring document, NEVER abstaining.
export function top1(scored) {
  const s = arr(scored).filter((x) => x && typeof x === 'object');
  if (s.length === 0) return { abstain: true, why: 'empty index' };
  let best = s[0];
  for (const x of s) if (num(x.score) > num(best.score)) best = x;
  return { answer: best.id, score: num(best.score) };
}

export default { tokens, idf, score, route, top1 };
