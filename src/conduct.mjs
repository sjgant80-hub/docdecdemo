// DocDec v2 · src/conduct.mjs — L5, the conductor's routing rules. Pure.
//
// Per question, decide which machinery runs: the cheap cosine shortlist (always: it is the fast first stage), ColBERT
// re-ranking of that shortlist, the graph walk when the question is COMPOSITIONAL (it needs two facts), the memory's
// "as of" filter, then the verifier gate. These rules are word-and-shape rules, measured on labelled questions; a
// question they misread still goes through the gate, so a misroute costs an answer, it never invents one.

const str = (x) => (typeof x === 'string' ? x : '');
const arr = (x) => (Array.isArray(x) ? x : []);

// the shapes of a two-fact question: comparisons of two named things, and a relative clause that hangs a second fact
// off the first ("the director of the film that ...", "the band whose ...")
const COMPARE = /\b(both|either|neither|which (one|of (the|these|those) (two|2))|older|younger|earlier|later|first|longer|shorter|larger|smaller|bigger|higher|lower|more|fewer|less|same|different|in common|also)\b/i;
const BRIDGE = /\b(that|who|which|whose|where|when)\b[^?]*\b(is|was|were|are|has|had|did|does|won|wrote|directed|founded|created|starred|played|released|born|located|based|owned|known)\b/i;
const NESTED = /\b(of|by|for|from|in) the \w+ (that|who|which|whose)\b/i;
const TWO_NAMES = /\b[A-Z][\w.'-]+(?:\s+[A-Z][\w.'-]+)*\b[^?]*\b(and|or)\b[^?]*\b[A-Z][\w.'-]+/;

// classify(question) → { route: 'compositional' | 'lookup', why }
export function classify(question) {
  const q = str(question).trim();
  if (q.length === 0) return { route: 'lookup', why: 'empty' };
  const body = q.replace(/^\s*\S+/, ''); // drop the first word: "Which"/"Who" opening a question is not a relative clause
  if (COMPARE.test(q) && TWO_NAMES.test(body)) return { route: 'compositional', why: 'compares two named things' };
  if (NESTED.test(q)) return { route: 'compositional', why: 'a fact hangs off another fact' };
  if (BRIDGE.test(body)) return { route: 'compositional', why: 'a relative clause names a second fact' };
  return { route: 'lookup', why: 'one fact' };
}

// shortlist(cosScored, k) → the top k ids by the cheap single-vector score (the fast path's first stage)
export function shortlist(cosScored, k) {
  const K = Number.isInteger(k) && k > 0 ? k : 20;
  const xs = arr(cosScored).filter((x) => x && Number.isFinite(x.score));
  const ids = [...new Set(xs.map((x) => String(x.id)))].sort();
  const pos = new Map(ids.map((id, i) => [id, i]));
  return xs.slice().sort((a, b) => (b.score - a.score) || (pos.get(String(a.id)) - pos.get(String(b.id)))).slice(0, K).map((x) => x.id);
}

// plan(question) → the ordered steps the conductor runs for this question
export function plan(question) {
  const c = classify(question);
  const steps = ['cosine shortlist', 'late-interaction re-rank'];
  if (c.route === 'compositional') steps.push('graph walk');
  steps.push('as-of filter', 'verifier gate');
  return { ...c, steps };
}

export default { classify, shortlist, plan };
