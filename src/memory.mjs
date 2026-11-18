// DocDec v2 · src/memory.mjs — L3, persistent state. Pure (every time is passed in; nothing reads a clock).
//
// A flat index is frozen: change a document and the old text sits beside the new one, equally likely to be retrieved.
// This store keeps VERSIONS with validity windows instead: a new version of a source supersedes the old one (the old
// one gets an end date; it is never overwritten or deleted), reads happen "as of" a date, and history stays intact.
// On top of the versions it keeps what USE teaches: verified answers (each with its source, version and span,
// consolidated when many people ask the same thing), the questions it refused (the gaps), and a metabolism that lets
// unused cached answers fade and prunes them, while the source versions — the provenance — are never pruned.

const str = (x) => (typeof x === 'string' ? x : '');
const arr = (x) => (Array.isArray(x) ? x : []);
const fin = (x) => (typeof x === 'number' && Number.isFinite(x));
const day = (iso) => { const t = Date.parse(str(iso)); return fin(t) ? t / 86400000 : NaN; };

export function createStore() { return { versions: [], facts: [], gaps: [] }; }

// shingles(text, k) → the set of k-word shingles (lowercased words)
export function shingles(text, k) {
  const n = Number.isInteger(k) && k > 0 ? k : 5;
  const w = str(text).toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  const out = new Set();
  if (w.length === 0) return out;
  const last = Math.max(0, w.length - n); // a text shorter than k is one shingle: itself
  for (let i = 0; i <= last; i++) out.add(w.slice(i, i + n).join(' '));
  return out;
}
export function jaccard(a, b) {
  const A = a instanceof Set ? a : new Set(), B = b instanceof Set ? b : new Set();
  let inter = 0; for (const x of A) if (B.has(x)) inter++;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}
export const NEAR_DUPLICATE = 0.6;

// current(store, sourceId, asOf) → the version of sourceId valid at asOf (validFrom ≤ asOf < validTo), or null
export function current(store, sourceId, asOf) {
  const t = day(asOf);
  let best = null;
  for (const v of arr(store && store.versions)) {
    if (v.sourceId !== sourceId) continue;
    const from = day(v.validFrom), to = v.validTo ? day(v.validTo) : Infinity;
    if (!(from <= t && t < to)) continue;
    if (best === null || from > day(best.validFrom)) best = v;
  }
  return best;
}

// ingest(store, doc) — doc { id, text, validFrom, sourceId? }. With a sourceId, the new version supersedes that
// source's version valid at doc.validFrom. Without one, a near-duplicate of a CURRENT version (5-word-shingle Jaccard
// ≥ NEAR_DUPLICATE) is treated as a new version of it. Returns { sourceId, superseded: id|null, matchedBy }.
export function ingest(store, doc) {
  if (!store || !doc || doc.id == null || !fin(day(doc.validFrom))) return { sourceId: null, superseded: null, matchedBy: 'invalid' };
  let sourceId = doc.sourceId == null ? null : doc.sourceId;
  let matchedBy = sourceId != null ? 'sourceId' : 'new';
  if (sourceId == null) {
    const sh = shingles(doc.text, 5);
    let best = null, bestJ = 0;
    for (const v of store.versions) {
      if (v.validTo) continue;
      const j = jaccard(sh, shingles(v.text, 5));
      if (j > bestJ) { bestJ = j; best = v; }
    }
    if (best && bestJ >= NEAR_DUPLICATE) { sourceId = best.sourceId; matchedBy = 'near-duplicate'; }
    else sourceId = doc.id;
  }
  const prev = current(store, sourceId, doc.validFrom);
  if (prev && prev.id !== doc.id) prev.validTo = doc.validFrom;
  store.versions.push({ id: doc.id, sourceId, text: str(doc.text), validFrom: doc.validFrom, validTo: null, supersedes: prev ? prev.id : null });
  return { sourceId, superseded: prev ? prev.id : null, matchedBy };
}

// validAt(store, asOf) → every version valid at asOf: what a reader "as of" that date may retrieve from
export function validAt(store, asOf) {
  const t = day(asOf);
  return arr(store && store.versions).filter((v) => day(v.validFrom) <= t && t < (v.validTo ? day(v.validTo) : Infinity));
}

// history(store, sourceId) → that source's versions, oldest first
export function history(store, sourceId) {
  return arr(store && store.versions).filter((v) => v.sourceId === sourceId).sort((a, b) => day(a.validFrom) - day(b.validFrom));
}

// remember(store, a) — a verified answer: { qid, question, sourceId, versionId, span, at }. The same span from the same
// source is ONE fact: a repeat ask adds to its provenance instead of a duplicate. Returns the fact.
export function remember(store, a) {
  if (!store || !a || a.sourceId == null || str(a.span).length === 0) return null;
  let f = store.facts.find((x) => x.sourceId === a.sourceId && x.span === a.span);
  if (!f) { f = { sourceId: a.sourceId, versionId: a.versionId, span: a.span, asked: [], lastUsed: a.at, uses: 0 }; store.facts.push(f); }
  if (!f.asked.some((x) => x.qid === a.qid)) f.asked.push({ qid: a.qid, question: str(a.question), at: a.at });
  f.uses++;
  if (day(a.at) > day(f.lastUsed) || !fin(day(f.lastUsed))) f.lastUsed = a.at; // the same day written another way stays
  return f;
}

// reground(store, fact, asOf, findSpan) → a stored answer is served only if its span is STILL in the source's version
// valid now. { ok:true, version, span } or { ok:false, why } — a changed source is caught here, never served stale.
export function reground(store, fact, asOf, findSpan) {
  if (!fact) return { ok: false, why: 'no stored answer' };
  const v = current(store, fact.sourceId, asOf);
  if (!v) return { ok: false, why: 'the source is no longer valid' };
  const span = typeof findSpan === 'function' ? findSpan(v.text, fact.span) : null;
  if (!span) return { ok: false, why: 'the source changed: the stored answer is no longer in it' };
  return { ok: true, version: v.id, span };
}

// refused(store, r) — log a refused question { qid, question, why, at } (the raw material of "what's missing")
export function refused(store, r) { if (store && r) store.gaps.push({ qid: r.qid, question: str(r.question), why: str(r.why), at: r.at }); }

// weight(fact, now, halfLifeDays) → 2^(-age/h) · uses: recent, often-used answers weigh most
export function weight(fact, now, halfLifeDays) {
  const h = fin(halfLifeDays) && halfLifeDays > 0 ? halfLifeDays : 30;
  const age = day(now) - day(fact && fact.lastUsed);
  if (!fin(age)) return 0;
  return Math.pow(2, -Math.max(0, age) / h) * (fin(fact.uses) ? fact.uses : 0);
}

// metabolise(store, now, { halfLifeDays, minWeight }) — prune cached answers that faded below minWeight or whose
// source changed under them; source versions are never pruned. Returns { kept, pruned:[{span, why}] }.
export function metabolise(store, now, opts, findSpan) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const minWeight = fin(o.minWeight) ? o.minWeight : 0.05;
  const keep = [], pruned = [];
  for (const f of arr(store && store.facts)) {
    const g = reground(store, f, now, findSpan);
    if (!g.ok) { pruned.push({ span: f.span, why: g.why }); continue; }
    if (weight(f, now, o.halfLifeDays) < minWeight) { pruned.push({ span: f.span, why: 'unused: faded below the keep line' }); continue; }
    keep.push(f);
  }
  if (store) store.facts = keep;
  return { kept: keep.length, pruned };
}

export default { createStore, shingles, jaccard, NEAR_DUPLICATE, current, ingest, validAt, history, remember, reground, refused, weight, metabolise };
