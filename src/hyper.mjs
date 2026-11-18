// DocDec v2 · src/hyper.mjs — the FRONTIER PROTOTYPE (H1), pure. Not a product feature; measured, never claimed.
//
// Flat space only knows angle. The hyperbolic idea: put the corpus in a Poincaré ball, where room grows exponentially
// toward the edge the way a tree branches, and let RADIUS carry specificity — general things (a whole article) near the
// centre, specific things (one sentence) near the edge. Then "what contains this" is a direction you can travel and a
// generic node stops sitting next to everything. This is the training-free version: direction from the ordinary
// embedding, radius from the node's depth in the corpus hierarchy (article 1, paragraph 2, sentence 3), Poincaré
// distance, and the two rankings fused. The published method trains its projection; this one does not (stated on page).

const fin = (x) => (typeof x === 'number' && Number.isFinite(x));
const arr = (x) => (Array.isArray(x) ? x : []);

export const DEPTH = Object.freeze({ article: 1, paragraph: 2, sentence: 3 });
export const QUERY_DEPTH = 3; // a fact question is asked at the most specific level
export const CURVE = 0.5;     // radius = tanh(CURVE · depth): 1 → 0.462, 2 → 0.762, 3 → 0.905

export function radius(depth) { return Math.tanh(CURVE * (fin(depth) ? Math.max(0, depth) : 0)); }

// toBall(vec, depth) → the unit direction of vec scaled to radius(depth): a point strictly inside the unit ball
export function toBall(vec, depth) {
  const v = arr(vec).length ? vec : [];
  let s = 0; for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  s = Math.sqrt(s);
  const r = radius(depth);
  if (s === 0) return new Float64Array(v.length);
  return Float64Array.from(v, (x) => (x / s) * r);
}

// poincare(x, y) → hyperbolic distance in the unit ball: arcosh(1 + 2|x−y|² / ((1−|x|²)(1−|y|²)))
export function poincare(x, y) {
  const a = x && x.length ? x : [], b = y && y.length ? y : [];
  let d = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { const t = a[i] - b[i]; d += t * t; na += a[i] * a[i]; nb += b[i] * b[i]; }
  const den = (1 - na) * (1 - nb);
  if (!(den > 0)) return Infinity;
  const z = 1 + (2 * d) / den;
  return Math.log(z + Math.sqrt(Math.max(0, z * z - 1)));
}

// rrf(rankings, k) → reciprocal-rank fusion of several best-first id lists: score(id) = Σ 1/(k + rank)
export function rrf(rankings, k) {
  const K = fin(k) && k > 0 ? k : 60;
  const s = new Map();
  for (const list of arr(rankings)) arr(list).forEach((id, i) => s.set(id, (s.get(id) || 0) + 1 / (K + i + 1)));
  // ids are unique keys: plain string order first, then a stable sort by fused score
  return [...s.keys()].sort().sort((p, q) => s.get(q) - s.get(p));
}

export default { DEPTH, QUERY_DEPTH, CURVE, radius, toBall, poincare, rrf };
