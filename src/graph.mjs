// DocDec v2 · src/graph.mjs — L2, the structure over the corpus. Pure.
//
// Entities are the corpus's own titles (a Wikipedia paragraph is about its title). A paragraph MENTIONS another when
// that title appears in its text, word for word. Multi-hop becomes a walk: the first source names the bridge, the walk
// follows the mention to the second source. A comparison names both entities in the question; the walk follows both.
// Also the global view a flat index cannot give: the themes of the corpus and how much each one holds.

const str = (x) => (typeof x === 'string' ? x : '');
const arr = (x) => (Array.isArray(x) ? x : []);
const fin = (x) => (typeof x === 'number' && Number.isFinite(x));

// words(text) → lowercased alphanumeric words, in order
export function words(text) { return str(text).toLowerCase().match(/[\p{L}\p{N}]+/gu) || []; }
// entityName(title) → the title without a trailing "(disambiguation)" part: "Ed Wood (film)" → "Ed Wood"
export function entityName(title) { return str(title).replace(/\s*\([^)]*\)\s*$/, '').trim(); }

// indexTitles(paragraphs) → { first: Map(word → [{ id, ws }]) } over entity names of at least one word
export function indexTitles(paragraphs) {
  const first = new Map();
  for (const p of arr(paragraphs)) {
    if (!p || p.id == null) continue;
    const ws = words(entityName(p.title));
    if (ws.length === 0) continue;
    if (!first.has(ws[0])) first.set(ws[0], []);
    first.get(ws[0]).push({ id: p.id, ws });
  }
  return { first };
}

// mentions(text, index, selfId) → the ids whose entity name appears in text as a whole-word run (not selfId), in order
export function mentions(text, index, selfId) {
  const ws = words(text);
  const found = [];
  const seen = new Set();
  const first = index && index.first instanceof Map ? index.first : new Map();
  for (let i = 0; i !== ws.length; i++) {
    const cands = first.get(ws[i]);
    if (!cands) continue;
    for (const c of cands) {
      if (c.id === selfId || seen.has(c.id) || i + c.ws.length > ws.length) continue;
      let ok = true;
      for (let k = 1; k < c.ws.length; k++) if (ws[i + k] !== c.ws[k]) { ok = false; break; }
      if (ok) { seen.add(c.id); found.push(c.id); }
    }
  }
  return found;
}

// build(paragraphs) → { index, out: Map(id → Set(ids it mentions)) }
export function build(paragraphs) {
  const index = indexTitles(paragraphs);
  const out = new Map();
  for (const p of arr(paragraphs)) if (p && p.id != null) out.set(p.id, new Set(mentions(p.text, index, p.id)));
  return { index, out };
}

// linked(g, a, b) → true when either paragraph mentions the other
export function linked(g, a, b) {
  const o = g && g.out instanceof Map ? g.out : new Map();
  return (o.get(a) ? o.get(a).has(b) : false) || (o.get(b) ? o.get(b).has(a) : false);
}

// walk(q, g, opts) → the best PAIR of sources for a two-hop question.
//   q: { text, ranked:[{id,score}] best first, score: Map/obj id → score (the question's score for any paragraph) }
//   opts: { hop1: K (default 5), lambda (default 0) }
// Candidates: hop-1 = the top K plus every paragraph named in the question; hop-2 = everything a hop-1 candidate
// mentions, plus every paragraph named in the question. pair score = s(a) + s(b) + lambda · [a and b are linked, or both
// are named in the question]. The plain top-2 pair is always a candidate, so the walk can only add options.
export function walk(q, g, opts) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const K = Number.isInteger(o.hop1) && o.hop1 > 0 ? o.hop1 : 5;
  const lambda = fin(o.lambda) ? o.lambda : 0;
  const ranked = arr(q && q.ranked);
  const sc = q && q.score;
  const s = (id) => { const v = sc instanceof Map ? sc.get(id) : (sc ? sc[id] : undefined); return fin(v) ? v : -Infinity; };
  const named = g && g.index ? mentions(q && q.text, g.index, null) : [];
  const namedSet = new Set(named);
  const hop1 = [...new Set([...ranked.slice(0, K).map((r) => r.id), ...named])];
  const pairs = [];
  if (ranked.length >= 2) pairs.push([ranked[0].id, ranked[1].id]);
  const o2 = g && g.out instanceof Map ? g.out : new Map();
  for (const a of hop1) {
    const nexts = new Set([...(o2.get(a) || []), ...named]);
    for (const b of nexts) if (b !== a) pairs.push([a, b]);
  }
  let best = null;
  for (const [a, b] of pairs) {
    const sa = s(a), sb = s(b);
    if (!fin(sa) || !fin(sb)) continue;
    const link = linked(g, a, b) || (namedSet.has(a) && namedSet.has(b));
    const score = sa + sb + (link ? lambda : 0);
    const key = [a, b].sort().join('\u0000');
    if (best === null || score > best.score || (score === best.score && key < best.key)) best = { a, b, score, linked: link, key };
  }
  if (!best) return null;
  return { a: best.a, b: best.b, score: best.score, linked: best.linked, candidates: pairs.length };
}

// themes(paragraphs, topN) → the corpus's shape: each title (theme) with how many paragraphs it holds and its most
// distinctive words (in many of ITS paragraphs, few of the others). The answer to "what is in here" a flat index lacks.
export function themes(paragraphs, topN) {
  const n = Number.isInteger(topN) && topN > 0 ? topN : 5;
  const byTitle = new Map();
  for (const p of arr(paragraphs)) {
    if (!p) continue;
    const t = str(p.title);
    if (!byTitle.has(t)) byTitle.set(t, []);
    byTitle.get(t).push(new Set(words(p.text).filter((w) => w.length >= 4)));
  }
  const df = new Map();
  for (const sets of byTitle.values()) { const u = new Set(); for (const s of sets) for (const w of s) u.add(w); for (const w of u) df.set(w, (df.get(w) || 0) + 1); }
  const T = byTitle.size;
  const out = [];
  // words and titles are unique keys: put them in plain string order first, then a stable sort by weight / size
  for (const title of [...byTitle.keys()].sort()) {
    const sets = byTitle.get(title);
    const tf = new Map();
    for (const s of sets) for (const w of s) tf.set(w, (tf.get(w) || 0) + 1);
    const scored = [...tf.keys()].sort().map((w) => ({ w, v: (tf.get(w) / sets.length) * Math.log(1 + T / df.get(w)) }))
      .sort((x, y) => y.v - x.v);
    out.push({ title, paragraphs: sets.length, words: scored.slice(0, n).map((x) => x.w) });
  }
  return out.sort((x, y) => y.paragraphs - x.paragraphs);
}

export default { words, entityName, indexTitles, mentions, build, linked, walk, themes };
