// DocDec v2 · src/examples.mjs — the page's examples, picked by FIXED RULES on the eval split in file order, never by
// hand. Pure; CI re-picks them and requires the published ones to be identical. Failures are picked by rule too.
import L from './late.mjs';
import GT from './gate.mjs';
import GR from './graph.mjs';
import M from './memory.mjs';
import { decideRow, rowsFor, NOW } from './measure.mjs';

const DIM = 96;
const col = (e) => ({ tokens: e.tokens, m: L.fromInt8(L.b64ToInt8(e.v), DIM) });
const evidenceRows = (F, qid, pid, para) => {
  const q = col(para ? F.s5.col.para['para:' + qid] : F.s1.col.q[qid]), d = col(F.s1.col.docs[pid]);
  const m = L.maxsim(q.m, d.m, DIM);
  return L.evidence(q.tokens, m.sims, m.best, d.tokens).tokens.map((t) => ({ token: t.token, matched: t.matched, sim: Math.round(t.sim * 1000) / 1000 }));
};

// the fixed rules, one predicate each (tested on their own in test/mini.test.mjs)
export const lateWin = (q, cosId, colId) => cosId !== q.goldId && colId === q.goldId;
export const lateLoss = (q, cosId, colId) => cosId === q.goldId && colId !== q.goldId;
export const groundedRight = (q, d) => d.refuse !== true && d.answer === q.goldId && GT.em(d.span.text, q.answers) === 1;
export const pairExact = (gold, p) => p[0] !== p[1] && gold.includes(p[0]) && gold.includes(p[1]);
export const walkOnly = (gold, walk, single) => pairExact(gold, walk) && !pairExact(gold, single);
export const composedRight = (d, answer) => d !== null && d.refuse !== true && GT.em(d.answer, [answer]) === 1;
export const staleThenFresh = (row) => row.staleFlat === 1 && row.latestMem === 1;

export function pick(F, D, rec) {
  const evalQ = rec._evalQ, chosen = rec._chosen, prefix = rec._prefix;
  const t1 = new Map(D.s1.paragraphs.map((p) => [p.id, p.text]));
  const reader = (qid, pid) => D.reader.one[qid + '|' + pid];
  const v2 = (q) => { const [r] = rowsFor([q], D.s1.scores, t1, reader, 'col', prefix); return { r, d: decideRow(r, chosen.v2) }; };
  const b1 = (q) => { const [r] = rowsFor([q], D.s1.scores, t1, reader, 'cos', prefix); return { r, d: decideRow(r, chosen.B1) }; };
  const para = (pid) => ({ id: pid, text: t1.get(pid) });
  const out = {};

  // 1 · late interaction finds what the pooled vector blurs (and one case where it is the other way round)
  const ans = evalQ.filter((q) => !q.impossible);
  const cosTop = (q) => D.s1.scores[q.qid][prefix][0], colTop = (q) => D.s1.scores[q.qid].col[0];
  const li = (q) => ({ qid: q.qid, question: q.text, answers: q.answers, gold: q.goldId,
    cosine: { ...para(cosTop(q)[0]), score: cosTop(q)[1] }, colbert: { ...para(colTop(q)[0]), score: colTop(q)[1], evidence: evidenceRows(F, q.qid, colTop(q)[0]) } });
  out.lateWins = ans.filter((q) => lateWin(q, cosTop(q)[0], colTop(q)[0])).slice(0, 3).map(li);
  out.lateLoses = ans.filter((q) => lateLoss(q, cosTop(q)[0], colTop(q)[0])).slice(0, 1).map(li);

  // 2 · the gate refusing: an off-topic question, and a near-miss the baseline answered
  const [, oosE] = [null, D.s1.oos.slice(Math.floor(D.s1.oos.length * 0.3))];
  const oosRows = rowsFor(oosE.map((q) => ({ ...q, goldId: null, impossible: true })), D.s1.oosScores, t1, reader, 'col', prefix);
  const offRef = oosRows.find((r) => decideRow(r, chosen.v2).refuse);
  out.offTopic = offRef ? { qid: offRef.q.qid, question: offRef.q.text, nearest: para(offRef.pid), score: offRef.score, why: decideRow(offRef, chosen.v2).why } : null;
  const nearMiss = evalQ.filter((q) => q.impossible).map((q) => ({ q, a: v2(q), b: b1(q) })).filter((x) => x.a.d.refuse && !x.b.d.refuse);
  const byCheck = (k) => nearMiss.find((x) => x.a.d.check === k);
  out.nearMiss = [2, 3, 4, 5].map(byCheck).filter(Boolean).map((x) => ({ qid: x.q.qid, question: x.q.text, check: x.a.d.check, why: x.a.d.why,
    baselineAnswered: para(x.b.r.pid), v2Looked: para(x.a.r.pid), weakestToken: x.a.r.ev ? x.a.r.ev.weakestToken : null, reader: x.a.r.raw }));

  // 3 · a grounded answer, its span at offsets anyone can check
  const g = ans.map((q) => ({ q, a: v2(q) })).find((x) => groundedRight(x.q, x.a.d));
  out.grounded = g ? { qid: g.q.qid, question: g.q.text, answers: g.q.answers, source: para(g.a.d.answer), span: g.a.d.span, sentence: g.a.d.sentence, evidence: evidenceRows(F, g.q.qid, g.a.d.answer) } : null;

  // 4 · multi-hop: the walk composes the two sources the single-vector top-2 does not
  const P3 = new Map(D.s3.paragraphs.map((p) => [p.id, p]));
  const hot = rec._hot;
  const mh = hot.evalQ.map((q) => {
    const w = hot.walkPair(q, hot.lambda), c = hot.top2(q, hot.prefix);
    const raw = D.reader.two[q.qid + '|' + w[0] + '|' + w[1]];
    const d = raw === undefined ? null : GT.decideTwo({ a: P3.get(w[0]), b: P3.get(w[1]), reader: raw }, q.text);
    return { q, w, c, ok: walkOnly(q.gold, w, c), d };
  }).filter((x) => x.ok);
  const mhPick = mh.find((x) => composedRight(x.d, x.q.answer)) || mh[0];
  out.multiHop = mhPick ? { qid: mhPick.q.qid, question: mhPick.q.text, answer: mhPick.q.answer, type: mhPick.q.type, gold: mhPick.q.gold,
    single: mhPick.c.map((id) => ({ id, text: P3.get(id).text })), walk: mhPick.w.map((id) => ({ id, text: P3.get(id).text })), linked: GR.linked(GR.build([P3.get(mhPick.w[0]), P3.get(mhPick.w[1])]), mhPick.w[0], mhPick.w[1]),
    composed: mhPick.d } : null;

  // 5 · fresh: the flat index answers from the old version; the memory answers from the current one, history kept
  const fr = rec._fresh.find(staleThenFresh);
  out.fresh = fr ? { qid: fr.f.qid, question: fr.f.text, oldAnswer: fr.f.oldAnswer, newAnswer: fr.f.newAnswer, v1: fr.f.v1, v2: fr.f.v2,
    flatPicked: fr.flat, memoryPicked: fr.mem, flatSaid: GT.parseReader(reader(fr.f.qid, fr.flat)).phrase || null, memorySaid: GT.parseReader(reader(fr.f.qid, fr.mem)).phrase || null } : null;

  // 6 · failures, kept: v2 refusing answerable questions, and v2 answering unanswerable ones
  out.refusedAnswerable = ans.map((q) => ({ q, a: v2(q) })).filter((x) => x.a.d.refuse).slice(0, 2).map((x) => ({ qid: x.q.qid, question: x.q.text, answers: x.q.answers, why: x.a.d.why, check: x.a.d.check }));
  out.answeredUnanswerable = evalQ.filter((q) => q.impossible).map((q) => ({ q, a: v2(q) })).filter((x) => !x.a.d.refuse).slice(0, 2)
    .map((x) => ({ qid: x.q.qid, question: x.q.text, source: para(x.a.d.answer), span: x.a.d.span }));
  void M; void NOW;
  return out;
}
export default { pick };
