// docdecdemo · rerun.mjs — the ONE measurement path. The generator (build-demo-data.mjs), the CI test
// (rerun.test.mjs) and the page's "Re-run it yourself" button all import this file, so the published numbers, the
// numbers GitHub's runner recomputes on every push, and the numbers a visitor's browser recomputes are the same code.
// Pure: no Node APIs, no network. Input: raw paragraph + question TEXT and the 3-decimal embedding vectors the page
// ships; everything else (tokens, idf, the settings search, every metric) is recomputed here with the kernel.
//
// Speed without a second source of truth: the kernel's route() scores every paragraph on every call, and that
// scoring does not depend on the gate settings. So each question is routed ONCE by the real kernel with a
// wide-open gate (its best paragraph, citation, score and runner-up), and the settings SEARCH replays only the
// gate's threshold checks on that summary (decide()). Every PUBLISHED number is then computed by the real
// kernel route() — decide() only chooses which settings to publish. decide() is proven equal to route() on
// every decision the search makes (rerun.test.mjs, on every push) and spot-checked live in the browser.
import K from './kernel.mjs';

// byte-identical to the page's cosine (page-parity.test.mjs pins it), so the page's live verdicts and this file agree
export function cosine(a,b){let d=0,na=0,nb=0;for(let i=0;i<a.length;i++){d+=a[i]*b[i];na+=a[i]*a[i];nb+=b[i]*b[i];}return d/(Math.sqrt(na)*Math.sqrt(nb)||1);}
const goldOf = (qs) => qs.map((q) => ({ qid: q.qid, goldId: q.goldId, impossible: q.impossible }));
const r3 = (x) => (x == null ? null : Math.round(x * 1000) / 1000);
const fin = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
const shape = (m) => ({ answerable: m.answerable, unanswerable: m.unanswerable, recall: r3(m.recall),
  precisionWhenAnswering: r3(m.precisionWhenAnswering), hallucinationRate: r3(m.hallucinationRate), groundedAbstention: r3(m.groundedAbstention) });
const OPEN = { minScore: 0, margin: 0 }; // a wide-open gate: route() returns its best paragraph whenever one exists

// prepare(paragraphs, questions, outOfScope) — paragraphs: [{ id, text, vec }]; questions: [{ qid, text, goldId,
// impossible, vec }] in file order; outOfScope: [{ qid, text }]. Tokenises everything with the kernel and routes
// each question once through the real kernel with the gate wide open.
export function prepare(paragraphs, questions, outOfScope) {
  const docs = (Array.isArray(paragraphs) ? paragraphs : []).map((p) => ({ id: p.id, terms: K.tokens(p.text), vec: p.vec }));
  const idf = K.idf(docs);
  const summarise = (q) => { q.nq = new Set(q.qterms).size || 1; q.open = K.route(q.qterms, docs, idf, OPEN); return q; };
  const qs = (Array.isArray(questions) ? questions : []).map((q) => {
    const x = { ...q, qterms: K.tokens(q.text), conf: {} };
    for (const d of docs) x.conf[d.id] = Array.isArray(q.vec) && Array.isArray(d.vec) ? cosine(q.vec, d.vec) : 0;
    return summarise(x);
  });
  const oos = (Array.isArray(outOfScope) ? outOfScope : []).map((q) => {
    const x = { qid: q.qid, qterms: K.tokens(q.text), goldId: null, impossible: true, conf: null };
    if (Array.isArray(q.vec)) { x.conf = {}; for (const d of docs) x.conf[d.id] = Array.isArray(d.vec) ? cosine(q.vec, d.vec) : 0; }
    return summarise(x);
  });
  return { docs, idf, qs, oos, hasRunnerUp: docs.length > 1 };
}

// decide(q, opts, hasRunnerUp) — route()'s gate checks, replayed on the question's wide-open summary.
export function decide(q, opts, hasRunnerUp) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const s = q.open;
  if (!s || s.abstain) return { abstain: true };
  const minScore = fin(o.minScore) || (o.minScore === 0 ? 0 : 1);
  if (s.score < minScore) return { abstain: true };
  if (hasRunnerUp && s.score - s.runnerUp < fin(o.margin)) return { abstain: true };
  if (s.cite.length / q.nq < fin(o.minCoverage)) return { abstain: true };
  if (o.minConfidence != null && Number.isFinite(o.minConfidence)) {
    if (!(fin(q.conf && q.conf[s.answer]) >= o.minConfidence)) return { abstain: true };
  }
  return { answer: s.answer };
}
const viaKernel = (P, q, opts) => K.route(q.qterms, P.docs, P.idf, q.conf ? { ...opts, confidence: q.conf } : opts);
const asPred = (q, r) => ({ qid: q.qid, ...(r.abstain ? { abstain: true } : { answer: r.answer }) });

// ── the settings grids (what the search tries; the test proves decide() == route() on all of it) ──
export const BENCH_GRID = { minScore: [1, 1.5, 2, 2.5, 3], margin: [0, 0.5, 1], minConfidence: [null, 0.5, 0.6, 0.65, 0.7] };
export const FREE_GRID = { minScore: [1, 1.5, 2, 2.5, 3, 4, 5], margin: [0, 0.5, 1, 1.5, 2], minCoverage: [0, 0.3, 0.5, 0.7] };
export const FREE_BEFORE = { minScore: 1, margin: 0.5, minCoverage: 0 }; // what the free box ran before 2026-11-16
const benchConfigs = () => BENCH_GRID.minScore.flatMap((minScore) => BENCH_GRID.margin.flatMap((margin) => BENCH_GRID.minConfidence.map((minConfidence) => ({ minScore, margin, minConfidence }))));
const freeConfigs = () => FREE_GRID.minScore.flatMap((minScore) => FREE_GRID.margin.flatMap((margin) => FREE_GRID.minCoverage.map((minCoverage) => ({ minScore, margin, minCoverage }))));
const split = (xs) => { const c = Math.floor(xs.length * 0.3); return [xs.slice(0, c), xs.slice(c)]; };
function freeSets(P) {
  const [ansT, ansE] = split(P.qs.filter((q) => !q.impossible)), [advT, advE] = split(P.qs.filter((q) => q.impossible)), [oosT, oosE] = split(P.oos);
  // the free box has no embeddings: its decisions never see a confidence map
  const noConf = (xs) => xs.map((q) => ({ ...q, conf: null }));
  return { ansT: noConf(ansT), ansE: noConf(ansE), advT: noConf(advT), advE: noConf(advE), oosT: noConf(oosT), oosE: noConf(oosE) };
}

// ── 1 · the headline benchmark: DocDec (structure + local-embedding veto) vs vector-RAG cosine top-1 ──
export function benchmark(P) {
  const cut = Math.floor(P.qs.length * 0.3);
  const tune = P.qs.slice(0, cut), evalQs = P.qs.slice(cut);
  const balanced = (m) => ((m.recall ?? 0) + (m.groundedAbstention ?? 0)) / 2;
  let best = { opts: null, obj: -1 }; const configs = benchConfigs();
  for (const opts of configs) {
    const o = balanced(K.evaluate(tune.map((q) => asPred(q, decide(q, opts, P.hasRunnerUp))), goldOf(tune)));
    if (o > best.obj) best = { opts, obj: o };
  }
  const dd = K.evaluate(evalQs.map((q) => asPred(q, viaKernel(P, q, best.opts))), goldOf(evalQs)); // published: the real kernel
  const rag = K.evaluate(evalQs.map((q) => ({ qid: q.qid, ...K.top1(P.docs.map((d) => ({ id: d.id, score: q.conf[d.id] }))) })), goldOf(evalQs));
  return { tune: tune.length, eval: evalQs.length, configsTried: configs.length, gate: best.opts, docdec: shape(dd), vectorRag: shape(rag), evalQs, tuneQs: tune };
}

// ── 2 · the free box: structure only (a browser has no embedding model), chosen on its own use case ──
// in-scope answerable vs real out-of-scope questions (other SQuAD articles); objective (recall + out-of-scope
// abstention)/2 on the 30% tune split, pre-specified 2026-11-16; adversarial look-alikes reported alongside.
export function freebox(P) {
  const S = freeSets(P);
  const searchRun = (set, opts) => K.evaluate(set.map((q) => asPred(q, decide(q, opts, P.hasRunnerUp))), goldOf(set));
  const kernelRun = (set, opts) => K.evaluate(set.map((q) => asPred(q, viaKernel(P, q, opts))), goldOf(set));
  const measure = (run, opts, A, O, V) => { const a = run(A, opts), o = run(O, opts), v = run(V, opts);
    return { recall: a.recall, precision: a.precisionWhenAnswering, outOfScopeAbstention: o.groundedAbstention, adversarialAbstention: v.groundedAbstention,
      objective: ((a.recall ?? 0) + (o.groundedAbstention ?? 0)) / 2 }; };
  let best = { opts: null, o: -1 }; const configs = freeConfigs();
  for (const opts of configs) { const o = measure(searchRun, opts, S.ansT, S.oosT, S.advT).objective; if (o > best.o) best = { opts, o }; }
  const round = (m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, r3(v)]));
  return { configsTried: configs.length, gate: best.opts,
    eval: round(measure(kernelRun, best.opts, S.ansE, S.oosE, S.advE)), before: round(measure(kernelRun, FREE_BEFORE, S.ansE, S.oosE, S.advE)), // published: the real kernel
    counts: { answerableEval: S.ansE.length, outOfScopeEval: S.oosE.length, adversarialEval: S.advE.length } };
}

// ── 3 · the full DocDec (benchmark gate, with the embedding check) on real off-topic questions ──
// no tuning happens here: the gate is the one the benchmark chose; this only measures it on the same 70% eval part
// of the out-of-scope questions the free box is reported on. Every decision by the real kernel route().
export function offTopic(P, gate) {
  const [, oosE] = split(P.oos);
  const withVec = oosE.filter((q) => q.conf);
  const preds = withVec.map((q) => asPred(q, viaKernel(P, q, gate)));
  const m = K.evaluate(preds, goldOf(withVec));
  return { gate, total: withVec.length, abstained: m.unanswerable.abstained, abstention: r3(m.groundedAbstention), missingVectors: oosE.length - withVec.length };
}

// ── 4 · the proof that the fast search is the kernel: every (question, settings) decision the search makes ──
export function searchDecisions(P) {
  const out = [];
  const cut = Math.floor(P.qs.length * 0.3);
  for (const opts of benchConfigs()) for (const q of P.qs.slice(0, cut)) out.push({ q, opts });
  const S = freeSets(P);
  for (const opts of freeConfigs()) for (const q of [...S.ansT, ...S.oosT, ...S.advT]) out.push({ q, opts });
  return out;
}
export function agrees(P, { q, opts }) {
  const a = decide(q, opts, P.hasRunnerUp), b = viaKernel(P, q, opts);
  return (a.abstain === true) === (b.abstain === true) && (a.abstain === true || a.answer === b.answer);
}
// a deterministic, evenly spread sample of the search's decisions, re-run through the real kernel (for the browser)
export function spotCheck(P, n) {
  const all = searchDecisions(P), step = Math.max(1, Math.floor(all.length / n));
  let checked = 0, agree = 0;
  for (let i = 0; i < all.length && checked < n; i += step) { checked++; if (agrees(P, all[i])) agree++; }
  return { checked, agree, of: all.length };
}

// ── 5 · everything, as the page publishes it ──
export function measureAll(paragraphs, questions, outOfScope) {
  const P = prepare(paragraphs, questions, outOfScope);
  const bench = benchmark(P);
  return { P, bench, free: freebox(P), offTopic: offTopic(P, bench.gate) };
}

// pickExamples(P, bench) — the side-by-side examples by a fixed rule, never by hand: on the EVAL split in file order,
// the first 4 where DocDec refuses an unanswerable question, the first 4 both get right, the first 2 where DocDec
// refuses an answerable one, and the first 2 where DocDec is fooled. The kernel decides every label.
export function pickExamples(P, bench) {
  const rows = bench.evalQs.map((q) => {
    const dd = viaKernel(P, q, bench.gate), ddAbstain = dd.abstain === true;
    const rag = K.top1(P.docs.map((d) => ({ id: d.id, score: q.conf[d.id] })));
    return { q, ddAbstain, ddRight: !ddAbstain && dd.answer === q.goldId, ragRight: rag.answer === q.goldId };
  });
  const pick = [...rows.filter((r) => r.q.impossible && r.ddAbstain).slice(0, 4), ...rows.filter((r) => !r.q.impossible && r.ddRight && r.ragRight).slice(0, 4),
    ...rows.filter((r) => !r.q.impossible && r.ddAbstain).slice(0, 2), ...rows.filter((r) => r.q.impossible && !r.ddAbstain).slice(0, 2)];
  const label = (r) => (r.q.impossible ? (r.ddAbstain ? 'win' : 'dd-hallucinated') : (r.ddRight ? 'both-right' : (r.ddAbstain ? 'dd-missed' : 'other')));
  return pick.map((r) => ({ qid: r.q.qid, text: r.q.text, qterms: r.q.qterms, goldId: r.q.goldId, impossible: r.q.impossible, answerText: r.q.answerText ?? null, qvec: r.q.vec, label: label(r) }));
}

// publish(...) — EVERY published field, built in one place from the measurement. The generator writes exactly this;
// the CI test rebuilds it from the shipped raw data and requires it to equal what is published, field for field —
// numbers, counts and the sentences that quote numbers alike.
export const SQUAD_SHA256 = '80a5225e94905956a6446d296ca1093975c4d3b3260f1d6c8f68bc2ab77182d8';
export const ARTICLES = ['Normans', 'Oxygen', 'Computational_complexity_theory'];
export const EMBED_MODEL = 'nomic-embed-text';
export function publish({ bench, free, offTopic: ot }, counts) {
  const rag = bench.vectorRag, dd = bench.docdec;
  return {
    gate: bench.gate,
    freeGate: free.gate,
    freeMeasured: { eval: free.eval, before: free.before, counts: free.counts, configsTried: free.configsTried, objective: '(recall + out-of-scope abstention)/2 on the 30% tune split, pre-specified 2026-11-16' },
    offTopicMeasured: ot,
    measured: {
      what: 'DocDec grounded router vs local vector-RAG, MEASURED on a public corpus (demo/benchmark, not a client result)',
      corpus: 'SQuAD 2.0 dev (rajpurkar.github.io, CC BY-SA 4.0)', squadSha256: SQUAD_SHA256, articles: ARTICLES, embedModel: EMBED_MODEL + ' (local), vectors rounded to 3 decimals before measuring',
      counts: { paragraphs: counts.paragraphs, questions: counts.questions, answerable: counts.answerable, unanswerable: counts.unanswerable, tune: bench.tune, eval: bench.eval },
      docdec: { gate: bench.gate, ...dd }, vectorRag: { method: 'nomic-embed cosine top-1, no abstain', ...rag }, configsTried: bench.configsTried,
      readMe: {
        architectureTruthsProvenByCode: ['DocDec abstains ("not in your documents") when no paragraph grounds the question', 'every DocDec answer cites the paragraph + the terms that resolved it', 'runs entirely local'],
        measuredHere: 'the recall / precision / hallucination / grounded-abstention numbers above, on this public corpus only',
        theKeyContrast: `on the ${rag.unanswerable.total} unanswerable questions, the vector-RAG answered ${rag.unanswerable.answered} (hallucinated) because top-1 cannot abstain; DocDec abstained on ${dd.unanswerable.abstained}`,
      },
    },
  };
}
