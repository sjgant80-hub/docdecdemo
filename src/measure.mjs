// DocDec v2 · src/measure.mjs — THE measurement: shipped data in, every published number and every claim verdict out.
// Pure (no I/O, no clock): the generator, CI and the page all run this same function. It applies PREREG.md exactly:
// thresholds searched exhaustively on the TUNE split by decision accuracy (ties to the stricter setting), claims judged
// on the EVAL split by their pre-registered pass rules (exact McNemar). Whatever it computes is what is published.
import L from './late.mjs';
import GT from './gate.mjs';
import GR from './graph.mjs';
import M from './memory.mjs';
import ST from './stats.mjs';
import H from './hyper.mjs';
import CD from './conduct.mjs';

const arr = (x) => (Array.isArray(x) ? x : []);
const fin = (x) => typeof x === 'number' && Number.isFinite(x);
const r4 = (x) => (fin(x) ? Math.round(x * 1e4) / 1e4 : x);
const REFUSE_ALL = Number.MAX_VALUE; // a finite bar nothing clears ("refuse everything" is a candidate setting too)
export const NOW = '2026-11-18', BEFORE = '2021-01-01', V1_FROM = '2020-01-01', V2_FROM = '2026-06-01';
const split = (xs, frac) => { const c = Math.floor(xs.length * frac); return [xs.slice(0, c), xs.slice(c)]; };

// ── one question's evidence for a system, then the gate's decision ──
// the reader is asked LAZILY: the gate reads c.reader only at check 4, so a question that already failed the bar or the
// evidence check never asks it (and the measurement lists exactly the reader calls it used)
function cand(r) { return { id: r.pid, text: r.text, score: r.score, weakest: r.ev ? r.ev.weakest : undefined, weakestToken: r.ev ? r.ev.weakestToken : null, get reader() { return r.raw; } }; }
export function rowsFor(questions, scores, textOf, reader, method, prefix) {
  return arr(questions).map((q) => {
    const s = scores[q.qid];
    const list = method === 'col' ? s.col : s[prefix];
    const [pid, score] = list[0];
    const ev = method === 'col' ? s.ev[pid] : null;
    let raw, asked = false, ok;
    const r = { q, pid, score, ev, text: textOf.get(pid),
      get raw() { if (!asked) { asked = true; raw = reader(q.qid, pid); } return raw; },
      // the reader's verdict depends on the row only, so it is worked out once, on first use
      get readerOK() { if (ok === undefined) ok = GT.decide(cand(r), { useReader: true }).refuse !== true; return ok; } };
    return r;
  });
}
// a setting's null t or e is a check switched off: the gate treats any non-number as off
export function decideRow(r, setting) {
  return GT.decide(cand(r), { bar: setting.t, evidence: setting.e, useReader: setting.reader === true });
}
// replay(r, setting) → the gate's checks replayed on the row's precomputed facts (for the settings SEARCH only; every
// published number goes through decideRow, the real gate; CI proves the two agree on every decision the search makes)
export function replay(r, setting) {
  if (fin(setting.t) && !(fin(r.score) && r.score >= setting.t)) return { refuse: true };
  if (fin(setting.e) && !(r.ev && fin(r.ev.weakest) && r.ev.weakest >= setting.e)) return { refuse: true };
  if (setting.reader === true && !r.readerOK) return { refuse: true };
  return { answer: r.pid };
}
export const right = (r, d) => !r.q.impossible && !d.refuse && d.answer === r.q.goldId;
export const correct = (r, d) => (r.q.impossible ? d.refuse === true : right(r, d));
// the pass rules, one small function each, so each is tested at its own boundary
export const allTrue = (...xs) => xs.length > 0 && xs.every((x) => x === true);
export const passMatched = (beatsIt, v2Recall, baseRecall) => beatsIt === true && v2Recall >= baseRecall - 0.02;
export const passFresh = (latest, history, beatsIt) => latest >= 0.95 && history >= 0.95 && beatsIt === true;
export const passAudit = (audited, verbatim) => audited > 0 && audited === verbatim;
export const passCache = (x) => x.bar !== null && x.warm >= x.cold && x.falseServeRate <= 0.01 && x.served > 0 && x.staleServed === 0;
// C7b (PREREG §7): a match bar exists and something was served (an empty test is a fail), false serves at most 1%,
// accuracy with the memory no worse than without, no stale serve. Work saved is reported, never part of the rule.
export const passRecycle = (x) => x.bar !== null && x.served > 0 && x.falseServeRate <= 0.01 && x.warm >= x.cold && x.staleServed === 0;
// pickBar(hits, maxRate) → the lowest score whose false-serve rate on these tune hits is at most maxRate, or null.
// hits: [{ impossible, score|null }]; a false serve is an unanswerable question whose best stored match clears the bar
export function pickBar(hits, maxRate) {
  const unans = hits.filter((x) => x.impossible).length;
  const cands = [...new Set(hits.map((x) => x.score).filter(fin))].sort((a, b) => a - b);
  for (const v of cands) {
    const fs = hits.filter((x) => x.impossible && fin(x.score) && x.score >= v).length;
    if ((unans === 0 ? 0 : fs / unans) <= maxRate) return v;
  }
  return null;
}
export const servable = (hit, bar) => hit !== null && bar !== null && hit.score >= bar;
// answerFlags(answer, f) → did an answer give the changed fact's NEW value, or its OLD one? (null = it refused)
export const answerFlags = (answer, f) => ({ isNew: answer !== null && GT.em(answer, [f.newAnswer]) === 1 ? 1 : 0, isOld: answer !== null && GT.em(answer, [f.oldAnswer]) === 1 ? 1 : 0 });
// bearing(q, node) → does this index node hold q's answer? Never an article node; the gold paragraph itself; a
// sentence of the gold paragraph only if it contains a gold answer
export const bearing = (q, n) => n.depth !== 1 && n.paragraph === q.goldId && (n.depth === 2 || q.answers.some((a) => n.text.includes(a)));
export const isArticle = (n) => (n.depth === 1 ? 1 : 0);
export const firstIs = (ranked, id) => ranked.length > 0 && ranked[0].id === id;
export function metrics(rows, setting, decide) {
  const decider = typeof decide === 'function' ? decide : decideRow;
  let nA = 0, nU = 0, rt = 0, ansA = 0, refU = 0, ok = 0;
  const per = [];
  for (const r of rows) {
    const d = decider(r, setting);
    if (r.q.impossible) { nU++; if (d.refuse) refU++; } else { nA++; if (!d.refuse) ansA++; if (right(r, d)) rt++; }
    const c = correct(r, d); if (c) ok++; per.push(c ? 1 : 0);
  }
  return { n: rows.length, answerable: nA, unanswerable: nU, right: rt, answeredAnswerable: ansA, refusedUnanswerable: refU,
    recall: nA ? rt / nA : null, precision: ansA ? rt / ansA : null, refusal: nU ? refU / nU : null, accuracy: rows.length ? ok / rows.length : null, per };
}
const uniq = (xs) => [...new Set(xs.filter(fin))].sort((a, b) => b - a);
// search(rows, { evidence, reader }) → the tune-chosen setting by decision accuracy, ties to the stricter (larger t, then e)
export function search(rows, opts) {
  const o = opts || {};
  const ts = [REFUSE_ALL, ...uniq(rows.map((r) => r.score)), null];
  const es = o.evidence ? [REFUSE_ALL, ...uniq(rows.map((r) => (r.ev ? r.ev.weakest : NaN))), null] : [null];
  const settings = [];
  for (const t of ts) for (const e of es) settings.push({ t, e, reader: o.reader === true });
  let best = null;
  for (const s of settings) { const m = metrics(rows, s, replay); if (best === null || m.accuracy > best.m.accuracy) best = { s, m }; }
  return { setting: best.s, tune: strip(metrics(rows, best.s)), tried: settings.length, settings };
}
// matched(rows, baseRecall, opts) → the setting with tune recall at least the baseline's, maximising tune refusal
export function matched(rows, baseRecall, opts) {
  const { settings } = search(rows, opts);
  let best = null;
  for (const s of settings) {
    const m = metrics(rows, s, replay);
    if (!((m.recall ?? 0) >= baseRecall)) continue;
    if (best === null || m.refusal > best.m.refusal || (m.refusal === best.m.refusal && m.accuracy > best.m.accuracy)) best = { s, m };
  }
  return best ? { setting: best.s, tune: strip(best.m) } : null;
}
const strip = (m) => { const { per, ...rest } = m; return Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, r4(v)])); };
const settingOut = (s) => ({ t: s.t === REFUSE_ALL ? 'refuse all' : s.t, e: s.e === REFUSE_ALL ? 'refuse all' : s.e, reader: s.reader });

// spans(rows, setting) → SQuAD EM / F1 of the answers given to answerable questions (reader systems only), and the audit
// check: every answer's span is found word for word at its offsets in its cited source
const wordCount = (s) => (typeof s === 'string' ? (s.match(/\S+/g) || []).length : 0);
export function spans(rows, setting) {
  let n = 0, emS = 0, f1S = 0, audited = 0, verbatim = 0, pw = 0, sw = 0;
  for (const r of rows) {
    const d = decideRow(r, setting);
    if (d.refuse || !d.span) continue;
    audited++; if (r.text.slice(d.span.start, d.span.end) === d.span.text) verbatim++;
    pw += wordCount(r.text); sw += wordCount(d.sentence ? d.sentence.text : d.span.text);
    if (r.q.impossible) continue;
    n++; emS += GT.em(d.span.text, r.q.answers); f1S += GT.f1(d.span.text, r.q.answers);
  }
  // what a person reads to check an answer: the whole cited passage, or only the cited sentence
  return { answered: n, em: n ? r4(emS / n) : null, f1: n ? r4(f1S / n) : null, audited, verbatim,
    passageWords: audited ? r4(pw / audited) : null, sentenceWords: audited ? r4(sw / audited) : null };
}

export function measure(D) {
  const reader1 = (qid, pid) => D.reader.one[qid + '|' + pid];
  const needs = [];
  const asked = new Set();
  const readerTracked = (qid, pid) => { const v = reader1(qid, pid); const k = qid + '|' + pid; if (v === undefined && !asked.has(k)) { asked.add(k); needs.push([qid, pid]); } return v; };
  const t1 = new Map(D.s1.paragraphs.map((p) => [p.id, p.text]));
  const t2 = new Map(D.s2.paragraphs.map((p) => [p.id, p.text]));
  const qs = D.s1.questions;
  const [tuneQ, evalQ] = split(qs, 0.3);
  const R = (set, sc, textOf, method, prefix) => rowsFor(set, sc, textOf, readerTracked, method, prefix);
  const out = { v: 'docdec-v2-record/1', prereg: 'PREREG.md', splits: { s1: { tune: tuneQ.length, eval: evalQ.length } } };

  // the baseline's prefix: whichever variant's tuned threshold scores higher on tune (tie: no prefix, v1's convention)
  const bN = search(R(tuneQ, D.s1.scores, t1, 'cos', 'cosN')), bP = search(R(tuneQ, D.s1.scores, t1, 'cos', 'cosP'));
  const prefix = bP.tune.accuracy > bN.tune.accuracy ? 'cosP' : 'cosN';
  out.baselinePrefix = { chosen: prefix === 'cosP' ? 'with task prefixes' : 'without task prefixes', tuneAccuracy: { without: bN.tune.accuracy, with: bP.tune.accuracy } };

  const systems = {
    B0: { method: 'cos', search: null },
    B1: { method: 'cos', search: {} },
    L1: { method: 'col', search: {} },
    L1e: { method: 'col', search: { evidence: true } },
    'B1+R': { method: 'cos', search: { reader: true } },
    'L1+R': { method: 'col', search: { reader: true } },
    v2: { method: 'col', search: { evidence: true, reader: true } },
  };
  const chosen = {};
  for (const [name, s] of Object.entries(systems)) {
    const tuneRows = R(tuneQ, D.s1.scores, t1, s.method, prefix);
    chosen[name] = s.search ? search(tuneRows, s.search).setting : { t: null, e: null, reader: false };
  }
  const B1tune = metrics(R(tuneQ, D.s1.scores, t1, 'cos', prefix), chosen.B1);
  const v2matched = matched(R(tuneQ, D.s1.scores, t1, 'col', prefix), B1tune.recall, { evidence: true, reader: true });

  const evalOn = (sc, textOf, set) => {
    const res = {};
    for (const [name, s] of Object.entries(systems)) {
      const rows = R(set, sc, textOf, s.method, prefix);
      res[name] = { setting: settingOut(chosen[name]), ...metrics(rows, chosen[name]), spans: spans(rows, chosen[name]) };
    }
    const mrows = R(set, sc, textOf, 'col', prefix);
    res['v2 matched'] = v2matched ? { setting: settingOut(v2matched.setting), ...metrics(mrows, v2matched.setting), spans: spans(mrows, v2matched.setting) } : null;
    return res;
  };
  const e1 = evalOn(D.s1.scores, t1, evalQ), e2 = evalOn(D.s2.scores, t2, evalQ);

  // C1: right paragraph at rank 1 on answerable eval questions, ColBERT vs the pooled vector (no thresholds)
  const top1Right = (sc, method) => evalQ.filter((q) => !q.impossible).map((q) => ((method === 'col' ? sc[q.qid].col : sc[q.qid][prefix])[0][0] === q.goldId ? 1 : 0));
  const c1 = (sc) => { const a = top1Right(sc, 'col'), b = top1Right(sc, 'cos'); return { colbert: r4(a.reduce((x, y) => x + y, 0) / a.length), cosine: r4(b.reduce((x, y) => x + y, 0) / b.length), n: a.length, test: ST.paired(a, b), pass: ST.beats(a, b) }; };
  const C1 = { s1: c1(D.s1.scores), s2: c1(D.s2.scores) };
  C1.pass = allTrue(C1.s1.pass, C1.s2.pass);

  // C2: v2 vs the baseline on S1 — (a) decision accuracy; (b) refusal at a matched operating point
  const c2a = ST.paired(e1.v2.per, e1.B1.per);
  const unansPer = (res) => evalQ.map((q, i) => [q, res.per[i]]).filter(([q]) => q.impossible).map(([, c]) => c);
  const c2b = e1['v2 matched'] ? ST.paired(unansPer(e1['v2 matched']), unansPer(e1.B1)) : null;
  const C2 = { a: { v2: r4(e1.v2.accuracy), baseline: r4(e1.B1.accuracy), test: c2a, pass: ST.beats(e1.v2.per, e1.B1.per) },
    b: e1['v2 matched'] ? { v2Refusal: r4(e1['v2 matched'].refusal), baselineRefusal: r4(e1.B1.refusal), v2Recall: r4(e1['v2 matched'].recall), baselineRecall: r4(e1.B1.recall), test: c2b,
      pass: passMatched(ST.beats(unansPer(e1['v2 matched']), unansPer(e1.B1)), e1['v2 matched'].recall, e1.B1.recall) } : { pass: false, why: 'no v2 setting reaches the baseline recall on tune' } };
  C2.pass = allTrue(C2.a.pass, C2.b.pass);

  // C4: S1's settings carried to the 9x corpus unchanged
  const C4 = { v2: r4(e2.v2.accuracy), baseline: r4(e2.B1.accuracy), test: ST.paired(e2.v2.per, e2.B1.per), pass: ST.beats(e2.v2.per, e2.B1.per),
    precisionS1: r4(e1.v2.precision), precisionS2: r4(e2.v2.precision) };

  // off-topic (S1's 70% eval part of the 600 questions from other articles), each system at its chosen setting
  const [, oosE] = split(D.s1.oos.map((q) => ({ ...q, goldId: null, impossible: true })), 0.3);
  const offTopic = {};
  for (const name of ['B1', 'L1', 'L1e', 'B1+R', 'L1+R', 'v2']) {
    const s = systems[name];
    const m = metrics(R(oosE, D.s1.oosScores, t1, s.method, prefix), chosen[name]);
    offTopic[name] = { refused: m.refusedUnanswerable, of: m.n, refusal: r4(m.refusal) };
  }

  // the guild finding: DocDec v1 (its own published gate) vs the tuned-threshold baseline, same eval questions
  const V1 = D.v1 ? { accuracy: r4(D.v1.per.reduce((a, b) => a + b, 0) / D.v1.per.length), baseline: r4(e1.B1.accuracy), test: ST.paired(D.v1.per, e1.B1.per),
    v1Refusal: r4(D.v1.refusal), baselineRefusal: r4(e1.B1.refusal), v1Recall: r4(D.v1.recall), baselineRecall: r4(e1.B1.recall) } : null;

  // ── S3 multi-hop ──
  const S3 = multiHop(D, prefix);
  // ── S4 fresh ──
  const S4 = freshness(D, readerTracked);
  // ── S5 the cache ──
  const S5 = cache(D, chosen.v2, prefix, t1, readerTracked);
  // ── S5 again, claim C7b: the memory keeps each answer's work and re-checks it for the new question ──
  const S5b = recycled(D, chosen.v2, prefix, t1, readerTracked);
  // ── H1 the hyperbolic prototype ──
  const H1 = D.h1 ? hyperbolic(D, prefix, evalQ) : null;
  // ── L5 the conductor ──
  const L5 = conductor(D, prefix, evalQ, e2);
  // C6: every answer's span verbatim at its offsets
  const auditSets = [e1.v2.spans, e2.v2.spans, e1['L1+R'].spans, e1['B1+R'].spans];
  const C6 = { audited: auditSets.reduce((a, s) => a + s.audited, 0) + S3.graph.audited + S4.audited + S5.audited, verbatim: auditSets.reduce((a, s) => a + s.verbatim, 0) + S3.graph.verbatim + S4.verbatim + S5.verbatim };
  C6.pass = passAudit(C6.audited, C6.verbatim);

  // the global view a flat index cannot give: what the corpus holds (themes), and what people asked that it does not
  // (v2's eval refusals on the guild corpus, by the check that refused them)
  const byCheck = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const r of R(evalQ, D.s1.scores, t1, 'col', prefix)) { const dd = decideRow(r, chosen.v2); if (dd.refuse === true) byCheck[dd.check] += 1; }
  out.globalView = { themes: GR.themes(D.s2.paragraphs, 6), refusedByCheck: byCheck };
  const clean = (res) => Object.fromEntries(Object.entries(res).map(([k, v]) => [k, v ? strip(v) : v]));
  out.chosen = Object.fromEntries(Object.entries(chosen).map(([k, s]) => [k, settingOut(s)]));
  out.s1 = clean(e1); out.s2 = clean(e2); out.offTopic = offTopic; out.v1 = V1;
  out.s3 = S3.report; out.s4 = S4.report; out.s5 = S5.report; out.s5b = S5b.report; out.h1 = H1; out.l5 = L5;
  out.claims = {
    C1: { claim: 'Finds the specific fact a pooled vector blurs', pass: C1.pass, detail: C1 },
    C2: { claim: "Won't answer what it can't ground, better than the baseline", pass: C2.pass, detail: C2 },
    C3: { claim: 'Composes two cited sources where single retrieval returns one piece', pass: S3.pass, detail: S3.claim },
    C4: { claim: 'Precision holds at 9x the corpus', pass: C4.pass, detail: C4 },
    C5: { claim: 'Current, not stale', pass: S4.pass, detail: S4.claim },
    C6: { claim: 'Auditable: every answer is its source’s own words, at offsets anyone can check', pass: C6.pass, detail: C6 },
    C7: { claim: 'Gets better with use', pass: S5.pass, detail: S5.claim },
    C7b: { claim: 'Gets better with use, by reusing its own work and re-checking it for each new question', pass: S5b.pass, detail: S5b.claim },
  };
  out.needs = needs;
  out.hotPairs = S3.pairs;
  // for the example picker (src/examples.mjs); dropped before publishing
  out._evalQ = evalQ; out._chosen = chosen; out._prefix = prefix; out._fresh = S4.rows;
  out._hot = { evalQ: S3._evalQ, walkPair: S3._walkPair, lambda: S3._lambda, prefix: S3._prefix, top2: S3._top2 };
  return out;
}

// ── S3: the graph walk vs single-vector top-2 ──
function multiHop(D, prefixFromS1) {
  const qs = D.s3.questions;
  const [tuneQ, evalQ] = split(qs, 0.3);
  const g = GR.build(D.s3.paragraphs);
  const P = new Map(D.s3.paragraphs.map((p) => [p.id, p]));
  const exact = (q, a, b) => { const gs = new Set(q.gold); return a !== b && gs.size === 2 && gs.has(a) && gs.has(b) ? 1 : 0; };
  const recall2 = (q, a, b) => q.gold.filter((x) => x === a || x === b).length / q.gold.length;
  const top2 = (q, key) => { const l = D.s3.scores[q.qid][key]; return [l[0][0], l[1][0]]; };
  // the baseline's prefix for multi-hop, by the same rule: whichever cosine top-2 is right more often on tune
  const tuneExact = (key) => tuneQ.reduce((a, q) => a + exact(q, ...top2(q, key)), 0);
  const prefix = tuneExact('cosP') > tuneExact('cosN') ? 'cosP' : 'cosN';
  const walkPair = (q, lambda) => {
    const s = D.s3.scores[q.qid];
    const ranked = s.col.map(([id, score]) => ({ id, score }));
    const w = GR.walk({ text: q.text, ranked, score: s.colOf }, g, { hop1: 5, lambda });
    return w ? [w.a, w.b] : top2(q, 'col');
  };
  const LAMBDAS = Array.from({ length: 61 }, (_, i) => Math.round(i * 0.005 * 1000) / 1000);
  let best = null;
  for (const lambda of LAMBDAS) { const v = tuneQ.reduce((a, q) => a + exact(q, ...walkPair(q, lambda)), 0); if (best === null || v > best.v) best = { lambda, v }; }
  const lambda = best.lambda;
  const per = (fn) => evalQ.map((q) => exact(q, ...fn(q)));
  const graph = per((q) => walkPair(q, lambda)), cos2 = per((q) => top2(q, prefix)), col2 = per((q) => top2(q, 'col'));
  const rate = (xs) => r4(xs.reduce((a, b) => a + b, 0) / xs.length);
  const rec = (fn) => r4(evalQ.reduce((a, q) => a + recall2(q, ...fn(q)), 0) / evalQ.length);
  // answers: the reader on each pair, the gate (decideTwo) on its output
  const pairs = {};
  for (const q of evalQ) pairs[q.qid] = [top2(q, prefix), walkPair(q, lambda)];
  const ans = (fn) => {
    let n = 0, emS = 0, f1S = 0, refused = 0, audited = 0, verbatim = 0, missing = 0;
    for (const q of evalQ) {
      const [a, b] = fn(q);
      const raw = D.reader.two[q.qid + '|' + a + '|' + b];
      if (raw === undefined) { missing++; continue; }
      n++;
      const d = GT.decideTwo({ a: P.get(a), b: P.get(b), reader: raw }, q.text);
      if (d.refuse) { refused++; continue; }
      emS += GT.em(d.answer, [q.answer]); f1S += GT.f1(d.answer, [q.answer]);
      for (const c of d.cites) { audited++; if (P.get(c.id).text.slice(c.start, c.end).trim() === c.text) verbatim++; }
    }
    return { n, missing, refused, em: n ? r4(emS / n) : null, f1: n ? r4(f1S / n) : null, audited, verbatim };
  };
  const gA = ans((q) => walkPair(q, lambda)), cA = ans((q) => top2(q, prefix));
  const test = ST.paired(graph, cos2);
  const byType = (type) => { const idx = evalQ.map((q, i) => [q, i]).filter(([q]) => q.type === type).map(([, i]) => i); return { n: idx.length, graph: rate(idx.map((i) => graph[i])), cosine: rate(idx.map((i) => cos2[i])) }; };
  return {
    pass: ST.beats(graph, cos2), pairs, graph: gA,
    claim: { graph: rate(graph), cosineTop2: rate(cos2), colbertTop2: rate(col2), test, n: evalQ.length },
    report: { tune: tuneQ.length, eval: evalQ.length, paragraphs: D.s3.paragraphs.length, edges: [...g.out.values()].reduce((a, s) => a + s.size, 0), baselinePrefix: prefix === 'cosP' ? 'with task prefixes' : 'without task prefixes', lambda, lambdasTried: LAMBDAS.length,
      pairExact: { graph: rate(graph), cosineTop2: rate(cos2), colbertTop2: rate(col2) }, recallAt2: { graph: rec((q) => walkPair(q, lambda)), cosineTop2: rec((q) => top2(q, prefix)), colbertTop2: rec((q) => top2(q, 'col')) },
      bridge: byType('bridge'), comparison: byType('comparison'), answers: { graph: gA, cosineTop2: cA } },
    _walkPair: walkPair, _lambda: lambda, _prefix: prefix, _evalQ: evalQ, _top2: top2,
  };
}

// ── S4: flat retrieval over every version vs the memory read as of a date ──
function freshness(D, reader1) {
  const store = M.createStore();
  for (const p of D.s1.paragraphs) M.ingest(store, { id: p.id + '@v1', text: p.text, validFrom: V1_FROM });
  let linkedRight = 0, linkedWrong = 0, linkedNone = 0;
  for (const f of D.s4.items) {
    const r = M.ingest(store, { id: f.v2.id, text: f.v2.text, validFrom: V2_FROM });
    if (r.superseded === f.sourceId + '@v1') linkedRight++; else if (r.superseded) linkedWrong++; else linkedNone++;
  }
  const textOf = new Map(store.versions.map((v) => [v.id, v.text]));
  const topAmong = (f, ids) => { const ok = new Set(ids); const hit = D.s4.scores[f.qid].col.find(([id]) => ok.has(id)); return hit ? hit[0] : null; };
  const allIds = store.versions.map((v) => v.id);
  const nowIds = M.validAt(store, NOW).map((v) => v.id), thenIds = M.validAt(store, BEFORE).map((v) => v.id);
  let audited = 0, verbatim = 0;
  const rows = D.s4.items.map((f) => {
    const flat = topAmong(f, allIds), mem = topAmong(f, nowIds), then = topAmong(f, thenIds);
    const answerOf = (pid) => { const raw = reader1(f.qid, pid); const d = GT.decide({ id: pid, text: textOf.get(pid), score: 1, reader: raw }, { useReader: true });
      if (!d.refuse) { audited++; if (textOf.get(pid).slice(d.span.start, d.span.end) === d.span.text) verbatim++; } return d.refuse ? null : d.span.text; };
    const aF = answerFlags(answerOf(flat), f), aM = answerFlags(answerOf(mem), f);
    return { f, flat, mem, then, latestFlat: flat === f.v2.id ? 1 : 0, latestMem: mem === f.v2.id ? 1 : 0, staleFlat: flat === f.sourceId + '@v1' ? 1 : 0, history: then === f.sourceId + '@v1' ? 1 : 0,
      newFlat: aF.isNew, oldFlat: aF.isOld, newMem: aM.isNew, oldMem: aM.isOld };
  });
  const sum = (k) => rows.reduce((a, r) => a + r[k], 0);
  const n = rows.length;
  const latestMem = sum('latestMem') / n, history = sum('history') / n;
  const test = ST.paired(rows.map((r) => r.latestMem), rows.map((r) => r.latestFlat));
  return {
    pass: passFresh(latestMem, history, ST.beats(rows.map((r) => r.latestMem), rows.map((r) => r.latestFlat))), audited, verbatim, rows,
    claim: { latestMemory: r4(latestMem), latestFlat: r4(sum('latestFlat') / n), history: r4(history), test, n },
    report: { n, detection: { linkedToItsOwnOldVersion: linkedRight, linkedWrong, notLinked: linkedNone, rule: `5-word shingle Jaccard >= ${M.NEAR_DUPLICATE}, no source ids given` },
      retrieval: { latestMemory: sum('latestMem'), latestFlat: sum('latestFlat'), staleFlat: sum('staleFlat'), historyAsOf2021: sum('history') },
      answers: { memoryNewValue: sum('newMem'), memoryOldValue: sum('oldMem'), flatNewValue: sum('newFlat'), flatOldValue: sum('oldFlat') } },
  };
}

// ── S5: verified answers remembered, paraphrases served from memory only after re-grounding ──
function cache(D, v2setting, prefix, t1, reader) {
  if (!D.s5) return { pass: false, report: null, claim: { why: 'no paraphrase data' }, audited: 0, verbatim: 0 };
  const qs = D.s1.questions;
  const [tuneQ, evalQ] = split(qs, 0.3);
  const store = M.createStore();
  for (const p of D.s1.paragraphs) M.ingest(store, { id: p.id, sourceId: p.id, text: p.text, validFrom: V1_FROM });
  // use: every original question goes through v2; each verified answer is remembered with its source and span
  const factOf = new Map();
  for (const q of qs) {
    const [r] = rowsFor([q], D.s1.scores, t1, reader, 'col', prefix);
    const d = decideRow(r, v2setting);
    if (d.refuse) { M.refused(store, { qid: q.qid, question: q.text, why: d.why, at: NOW }); continue; }
    factOf.set(q.qid, M.remember(store, { qid: q.qid, question: q.text, sourceId: d.answer, versionId: d.answer, span: d.span.text, at: NOW }));
  }
  const bestStored = (pq) => { const l = arr(D.s5.qq[pq.qid]).filter(([oq]) => factOf.has(oq)); return l.length ? { oq: l[0][0], score: l[0][1] } : null; };
  // c: the lowest tune score whose tune false-serve rate (a stored answer given to an unanswerable paraphrase) is <= 1%
  const c = pickBar(tuneQ.map((q) => { const h = bestStored(q); return { impossible: q.impossible, score: h ? h.score : null }; }), 0.01);
  let audited = 0, verbatim = 0;
  const cold = (q) => { const s = D.s5.paraScores[q.qid]; const [pid, score] = s.col[0];
    const r = { q, pid, score, ev: s.ev[pid], text: t1.get(pid), get raw() { return reader('para:' + q.qid, pid); } };
    const d = decideRow(r, v2setting); if (d.span) { audited++; if (r.text.slice(d.span.start, d.span.end) === d.span.text) verbatim++; } return d; };
  const warmServe = (q, asOf, st) => { const h = bestStored(q); if (!servable(h, c)) return null; const f = factOf.get(h.oq);
    const g = M.reground(st, f, asOf, GT.findSpan); return g.ok ? { fact: f, g } : { stale: true, why: g.why }; };
  const rows = evalQ.map((q) => {
    const dc = cold(q);
    const okCold = correct({ q }, dc) ? 1 : 0;
    const w = warmServe(q, NOW, store);
    let okWarm = okCold, served = 0, falseServe = 0;
    if (w && !w.stale) { served = 1; okWarm = correct({ q }, { answer: w.fact.sourceId }) ? 1 : 0; falseServe = q.impossible ? 1 : 0; }
    return { q, okCold, okWarm, served, falseServe };
  });
  // after the S4 changes land: every stored answer whose source changed must be caught by the re-grounding
  const changedStore = M.createStore();
  for (const p of D.s1.paragraphs) M.ingest(changedStore, { id: p.id, sourceId: p.id, text: p.text, validFrom: V1_FROM });
  for (const f of D.s4.items) M.ingest(changedStore, { id: f.v2.id, sourceId: f.sourceId, text: f.v2.text, validFrom: V2_FROM });
  let staleServed = 0, staleCaught = 0;
  for (const q of evalQ) {
    const h = bestStored(q); if (!servable(h, c)) continue;
    const f = factOf.get(h.oq);
    const nowV = M.current(changedStore, f.sourceId, NOW);
    const stillThere = nowV && GT.findSpan(nowV.text, f.span);
    const w = warmServe(q, NOW, changedStore);
    if (!stillThere) { if (w && !w.stale) staleServed++; else staleCaught++; }
  }
  const sum = (k) => rows.reduce((a, r) => a + r[k], 0);
  const n = rows.length, unansE = rows.filter((r) => r.q.impossible).length;
  const warm = sum('okWarm') / n, coldA = sum('okCold') / n, fsr = unansE ? sum('falseServe') / unansE : 0;
  const metab = M.metabolise(store, '2027-03-18', { halfLifeDays: 30, minWeight: 0.05 }, GT.findSpan);
  const pass = passCache({ bar: c, warm, cold: coldA, falseServeRate: fsr, served: sum('served'), staleServed });
  return { pass, audited, verbatim,
    claim: { warmAccuracy: r4(warm), coldAccuracy: r4(coldA), falseServeRate: r4(fsr), readerCallsSaved: sum('served'), staleServed, staleCaught, threshold: c },
    report: { remembered: store.facts.length, answersGiven: factOf.size, askedOfRemembered: store.facts.reduce((a, f) => a + f.asked.length, 0), refusedLogged: store.gaps.length, threshold: c, eval: n, served: sum('served'), falseServes: sum('falseServe'), staleServed, staleCaught,
      warmRight: sum('okWarm'), coldRight: sum('okCold'), metabolismFourMonthsLater: { kept: metab.kept, pruned: metab.pruned.length } } };
}

// ── S5 again, claim C7b (PREREG §7): keep the WORK behind each answer, re-check it for the new question, then serve ──
// Use is C7's: every original question through v2, the same reader outputs. What is kept differs: the passage, score,
// evidence, the reader's raw output and the span at its offsets (src/memory.mjs keep). A paraphrase is served only if
// its best remembered match clears the bar m (chosen on tune) AND the real gate passes again for the paraphrase on the
// current version of that one passage, with the kept reader output and the span at its kept offsets (memory recheck).
// Anything else takes the cold path, DocDec v2 as usual. No new reader call is ever made here.
function recycled(D, v2, prefix, t1, reader) {
  if (!D.s5) return { pass: false, report: null, claim: { why: 'no paraphrase data' } };
  const qs = D.s1.questions;
  const [tuneQ, evalQ] = split(qs, 0.3);
  const bars = { bar: v2.t, evidence: v2.e };
  const fill = () => { const st = M.createStore(); for (const p of D.s1.paragraphs) M.ingest(st, { id: p.id, sourceId: p.id, text: p.text, validFrom: V1_FROM }); return st; };
  const store = fill();
  for (const q of qs) {
    const [r] = rowsFor([q], D.s1.scores, t1, reader, 'col', prefix);
    const d = decideRow(r, v2);
    if (d.refuse !== true) M.keep(store, { qid: q.qid, question: q.text, sourceId: d.answer, versionId: d.answer, score: r.score, weakest: r.ev.weakest, weakestToken: r.ev.weakestToken, raw: r.raw, span: d.span, at: NOW });
  }
  const attempt = (q, st) => { const h = M.nearest(st, D.s5.qq[q.qid]); return { h, g: h ? M.recheck(st, h.work, NOW, (v) => D.s5.match(q.qid, v.id), GT.decide, bars) : null }; };
  // m: the lowest tune match score whose tune false-serve rate is at most 1%; a match that fails the re-check never serves
  const m = pickBar(tuneQ.map((q) => { const { h, g } = attempt(q, store); return { impossible: q.impossible, score: h && g.ok ? h.score : null }; }), 0.01);
  const stoppedBy = { 2: 0, 3: 0, 4: 0, 5: 0, offsets: 0, other: 0 };
  // added after the first result (reported, never part of the rule): each question the memory got wrong that the cold
  // path got right, by the check that refused it on the cold path ('answered': the cold path answered it right)
  const lostWhereColdWasRight = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, answered: 0 };
  let audited = 0, verbatim = 0, servedAnswerable = 0, emServed = 0, emCold = 0;
  const rows = evalQ.map((q) => {
    const s = D.s5.paraScores[q.qid]; const [pid, score] = s.col[0];
    const r = { q, pid, score, ev: s.ev[pid], text: t1.get(pid), get raw() { return reader('para:' + q.qid, pid); } };
    const dc = decideRow(r, v2);
    const okCold = correct({ q }, dc) ? 1 : 0;
    // would the cold path have asked the reader? only if its own best passage passed checks 2 and 3
    const asks = decideRow(r, { t: v2.t, e: v2.e, reader: false }).refuse !== true;
    const { h, g } = attempt(q, store);
    const tried = servable(h, m), served = tried && g.ok;
    const okWarm = served ? (correct({ q }, { answer: g.answer }) ? 1 : 0) : okCold;
    if (served) {
      if (okCold === 1 && okWarm === 0) lostWhereColdWasRight[dc.refuse === true ? dc.check : 'answered'] += 1;
      audited++; if (M.current(store, g.answer, NOW).text.slice(g.span.start, g.span.end) === g.span.text) verbatim++;
      if (!q.impossible) { servedAnswerable++; emServed += GT.em(g.span.text, q.answers); emCold += dc.span ? GT.em(dc.span.text, q.answers) : 0; }
    } else if (tried) stoppedBy[g.check in stoppedBy ? g.check : 'other'] += 1;
    return { q, okCold, okWarm, tried: tried ? 1 : 0, served: served ? 1 : 0,
      falseServe: served && q.impossible ? 1 : 0, saved: served && asks ? 1 : 0 };
  });
  // after the S4 changes land: the same serve against the changed store; a kept answer whose span is no longer at its
  // offsets in its source's current version is stale, and must never be served
  const changed = fill();
  for (const w of store.work) M.keep(changed, w);
  for (const f of D.s4.items) M.ingest(changed, { id: f.v2.id, sourceId: f.sourceId, text: f.v2.text, validFrom: V2_FROM });
  let servedAfter = 0, staleServed = 0, staleCaught = 0;
  for (const q of evalQ) {
    const { h, g } = attempt(q, changed);
    if (!servable(h, m)) continue;
    if (g.ok) servedAfter++;
    if (M.holds(changed, h.work, NOW)) continue;
    if (g.ok) staleServed++; else staleCaught++;
  }
  const sum = (k) => rows.reduce((a, x) => a + x[k], 0);
  const n = rows.length, unans = rows.filter((x) => x.q.impossible).length, P = D.s1.paragraphs.length;
  const warm = sum('okWarm') / n, cold = sum('okCold') / n, fsr = unans ? sum('falseServe') / unans : 0;
  return { pass: passRecycle({ bar: m, served: sum('served'), falseServeRate: fsr, warm, cold, staleServed }),
    claim: { warmAccuracy: r4(warm), coldAccuracy: r4(cold), falseServeRate: r4(fsr), served: sum('served'), staleServed, staleCaught, matchBar: m,
      readerCallsSaved: sum('saved'), test: ST.paired(rows.map((x) => x.okWarm), rows.map((x) => x.okCold)) },
    report: { kept: store.work.length, matchBar: m, eval: n, unanswerable: unans, tried: sum('tried'), served: sum('served'), falseServes: sum('falseServe'),
      warmRight: sum('okWarm'), coldRight: sum('okCold'), readerCallsSaved: sum('saved'), stoppedBy,
      passagesScored: { withMemory: sum('tried') + (n - sum('served')) * P, without: n * P }, matchedAgainstPerQuestion: store.work.length,
      servedSpans: { answerable: servedAnswerable, exactMatch: emServed, coldExactMatchOnSame: emCold, audited, verbatim },
      afterChanges: { served: servedAfter, staleServed, staleCaught }, lostWhereColdWasRight } };
}

// ── H1: training-free hyperbolic retrieval over a mixed-granularity index ──
function hyperbolic(D, prefix, evalQ) {
  const nodes = D.h1.nodes; // [{ id, depth, paragraph (id or null), text, v: { cosN, cosP } }]
  const key = prefix;
  const ball = new Map(nodes.map((n) => [n.id, H.toBall(n.v[key], n.depth)]));
  let cosRight = 0, fusedRight = 0, hypRight = 0, cosHub = 0, fusedHub = 0, hypHub = 0;
  const per = { cos: [], fused: [] };
  const answerQs = evalQ.filter((q) => !q.impossible);
  for (const q of answerQs) {
    const qv = D.h1.questions[q.qid][key];
    const qb = H.toBall(qv, H.QUERY_DEPTH);
    const cosR = L.rank(nodes.map((n) => ({ id: n.id, score: L.cosine(qv, n.v[key]) }))).map((x) => x.id);
    const hypR = L.rank(nodes.map((n) => ({ id: n.id, score: -H.poincare(qb, ball.get(n.id)) }))).map((x) => x.id);
    const fused = H.rrf([cosR, hypR], 60);
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const c = byId.get(cosR[0]), f = byId.get(fused[0]), h = byId.get(hypR[0]);
    const cr = bearing(q, c) ? 1 : 0, fr = bearing(q, f) ? 1 : 0;
    cosRight += cr; fusedRight += fr; hypRight += bearing(q, h) ? 1 : 0;
    cosHub += isArticle(c); fusedHub += isArticle(f); hypHub += isArticle(h);
    per.cos.push(cr); per.fused.push(fr);
  }
  const n = answerQs.length;
  return { nodes: { article: nodes.filter((x) => x.depth === 1).length, paragraph: nodes.filter((x) => x.depth === 2).length, sentence: nodes.filter((x) => x.depth === 3).length }, n,
    rank1AnswerBearing: { cosine: r4(cosRight / n), hyperbolic: r4(hypRight / n), fused: r4(fusedRight / n) },
    hubness: { cosine: r4(cosHub / n), hyperbolic: r4(hypHub / n), fused: r4(fusedHub / n) },
    test: ST.paired(per.fused, per.cos), reproduced: ST.beats(per.fused, per.cos) };
}

// ── L5: does the conductor read the question's shape, and is the cosine shortlist a safe first stage? ──
function conductor(D, prefix, evalQ, e2) {
  const s1 = evalQ.map((q) => CD.classify(q.text).route === 'lookup' ? 1 : 0);
  const [, hotE] = split(D.s3.questions, 0.3);
  const s3 = hotE.map((q) => CD.classify(q.text).route === 'compositional' ? 1 : 0);
  const answerable = evalQ.filter((q) => !q.impossible);
  let full = 0, fast = 0;
  for (const q of answerable) {
    const s = D.s2.scores[q.qid];
    if (s.col[0][0] === q.goldId) full++;
    const short = CD.shortlist(s[prefix].map(([id, score]) => ({ id, score })), 20);
    const re = L.rank(short.map((id) => ({ id, score: s.colOf[id] })));
    if (firstIs(re, q.goldId)) fast++;
  }
  return { routing: { lookupReadAsLookup: r4(s1.reduce((a, b) => a + b, 0) / s1.length), compositionalReadAsCompositional: r4(s3.reduce((a, b) => a + b, 0) / s3.length), lookupN: s1.length, compositionalN: s3.length },
    fastPath: { corpus: 'S2 (1,204 paragraphs)', fullColbertTop1: r4(full / answerable.length), shortlist20ThenColbert: r4(fast / answerable.length), n: answerable.length } };
}

export default { measure, metrics, search, matched, spans, rowsFor, decideRow, NOW, BEFORE };
