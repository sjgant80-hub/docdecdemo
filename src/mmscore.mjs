// DocDec · src/mmscore.mjs — how a Memory Model answer is read, and how the five claims are ruled on. Pure.
// PREREG.md, addendum 3, sections 9.4 and 9.5, as code: no model judges anything.
//
//   final(output)                 the answer a system gave: its first line with any text, cut at 20 words
//   refused(answer)               true when it is empty or says the refusal phrase
//   read(output, question, opt)   → { final, outcome }: 'right', 'wrong' (a confident wrong answer) or 'none'
//       question { answer, answerable }      opt { refused: true } when the system itself refused (DocDec's reader)
//   tally(outcomes)               → { n, right, wrong, none }
//   verdicts(run, bars)           → { verdicts: [K1…K5], adopt, dissolved, why }: (bars default to BARS, the sealed ones)
//                                   each claim's pass (true, false, or
//                                   null when a run it needs was not measured) and the counts it was ruled on
//       run { nAnswerable, nUnanswerable, ended,
//             answerable: { mm: { corpus, doubled }, mmEdge: { corpus }, rag: { corpus, doubled }, docdec: { corpus, doubled } },
//             unanswerable: { mm: { corpus }, rag: { corpus }, docdec: { corpus } },
//             integrity: { testQuestionsInTraining, outsideParagraphsInCorpus, generatorInputsWithATestQuestion,
//                          adapterSha256, adapterSha256Edge } }
import { norm, holds, YESNO } from './mmsets.mjs';
import { paired } from './stats.mjs';

const str = (x) => (typeof x === 'string' ? x : '');
const arr = (x) => (Array.isArray(x) ? x : []);
const get = (o, k) => { try { return o == null ? undefined : o[k]; } catch { return undefined; } };

export const FINAL_WORDS = 20;
export const REFUSAL = 'not in the documents';
export const BARS = { liftPoints: 5, alpha: 0.05, noisePoints: 3 };
export const NAMES = { K1: 'Long-document lift', K2: 'Noise robustness', K3: 'Executive swap', K4: 'Honest boundary', K5: 'Held-out integrity' };

export function final(output) {
  const line = str(output).split(/\r?\n/).map((l) => l.trim()).find((l) => l !== '') || '';
  return line.split(/\s+/).slice(0, FINAL_WORDS).join(' ');
}
export function refused(answer) {
  const a = norm(answer);
  return a === '' || (' ' + a + ' ').includes(' ' + norm(REFUSAL) + ' ');
}
export function read(output, question, opt) {
  const f = final(output), no = get(opt, 'refused') === true || refused(f);
  if (get(question, 'answerable') !== true) return { final: f, outcome: no ? 'right' : 'wrong' };
  if (no) return { final: f, outcome: 'none' };
  const gold = norm(get(question, 'answer'));
  if (gold === '') return { final: f, outcome: 'wrong' };
  const right = YESNO.includes(gold) ? norm(f).split(' ')[0] === gold : holds(f, get(question, 'answer'));
  return { final: f, outcome: right ? 'right' : 'wrong' };
}
export function tally(outcomes) {
  const o = arr(outcomes), count = (k) => o.filter((x) => x === k).length;
  return { n: o.length, right: count('right'), wrong: count('wrong'), none: count('none') };
}

// a run's outcomes for one system on one set and corpus: an array of 'right' | 'wrong' | 'none', one per question in
// the set's own order, or anything else when that run was not measured
const whole = (x, n) => Array.isArray(x) && x.length === n && n > 0 && x.every((o) => o === 'right' || o === 'wrong' || o === 'none');
const pct = (r, n) => `${(100 * r / n).toFixed(1)}%`;

export function verdicts(run, bars) {
  const num = (k) => (typeof get(bars, k) === 'number' && Number.isFinite(bars[k]) ? bars[k] : BARS[k]);
  const B = { liftPoints: num('liftPoints'), alpha: num('alpha'), noisePoints: num('noisePoints') };
  const A = get(run, 'answerable'), U = get(run, 'unanswerable'), I = get(run, 'integrity');
  const nA = Number.isInteger(get(run, 'nAnswerable')) ? run.nAnswerable : 0, nU = Number.isInteger(get(run, 'nUnanswerable')) ? run.nUnanswerable : 0;
  const a = (sys, corpus) => { const x = get(get(A, sys), corpus); return whole(x, nA) ? x : null; };
  const u = (sys) => { const x = get(get(U, sys), 'corpus'); return whole(x, nU) ? x : null; };
  const out = [], put = (id, pass, result) => out.push({ id, name: NAMES[id], pass, result });
  const rights = (x) => x.filter((o) => o === 'right').length, bits = (x) => x.map((o) => (o === 'right' ? 1 : 0));

  // K1 · MM at least 5 points above the better of DocDec v2 and RAG on the answerable questions, and p < 0.05
  const mm = a('mm', 'corpus'), dd = a('docdec', 'corpus'), rag = a('rag', 'corpus');
  if (mm && dd && rag) {
    const best = rights(rag) > rights(dd) ? ['RAG', rag] : ['DocDec v2', dd], t = paired(bits(mm), bits(best[1]));
    const lift = (rights(mm) - rights(best[1])) * 100 >= B.liftPoints * nA;
    put('K1', lift && t.p < B.alpha, `MM ${pct(rights(mm), nA)} (${rights(mm)} of ${nA}); DocDec v2 ${pct(rights(dd), nA)} (${rights(dd)}); RAG ${pct(rights(rag), nA)} (${rights(rag)}); against the better, ${best[0]}: ${t.aOnly} only MM right, ${t.bOnly} only ${best[0]} right, p = ${t.p.toPrecision(2)}`);
  } else put('K1', null, 'not measured');

  // K2 · MM's drop on the doubled corpus at least 3 points smaller than RAG's
  const mm2 = a('mm', 'doubled'), rag2 = a('rag', 'doubled'), dd2 = a('docdec', 'doubled');
  if (mm && mm2 && rag && rag2) {
    const dm = rights(mm) - rights(mm2), dr = rights(rag) - rights(rag2);
    put('K2', (dr - dm) * 100 >= B.noisePoints * nA, `on the doubled corpus MM went ${rights(mm)} → ${rights(mm2)} of ${nA} (a drop of ${(100 * dm / nA).toFixed(1)} points); RAG ${rights(rag)} → ${rights(rag2)} (${(100 * dr / nA).toFixed(1)} points)${dd && dd2 ? `; DocDec v2 ${rights(dd)} → ${rights(dd2)}` : ''}`);
  } else put('K2', null, 'not measured');

  // K3 · the same memory weights: accuracy with the larger executive is not below accuracy with the edge executive
  const edge = a('mmEdge', 'corpus'), sha = get(I, 'adapterSha256'), shaEdge = get(I, 'adapterSha256Edge');
  if (mm && edge) {
    const same = typeof sha === 'string' && /^[0-9a-f]{64}$/.test(sha) && sha === shaEdge;
    put('K3', same && rights(mm) >= rights(edge), `${same ? 'the same memory weights' : 'NOT shown to be the same memory weights'}: ${rights(edge)} of ${nA} right with the edge executive, ${rights(mm)} with the larger one`);
  } else put('K3', null, 'not measured');

  // K4 · on the unanswerable questions MM gives no more confident wrong answers than RAG
  const um = u('mm'), ur = u('rag'), ud = u('docdec');
  if (um && ur) {
    const w = (x) => x.filter((o) => o === 'wrong').length;
    put('K4', w(um) <= w(ur), `confident wrong answers on ${nU} questions that are not in the documents: MM ${w(um)}, RAG ${w(ur)}${ud ? `, DocDec v2 ${w(ud)}` : ''}`);
  } else put('K4', null, 'not measured');

  // K5 · nothing of the test is in the training, and nothing kept outside is in a corpus
  const counts = ['testQuestionsInTraining', 'outsideParagraphsInCorpus', 'generatorInputsWithATestQuestion'].map((k) => get(I, k));
  if (counts.every((c) => Number.isInteger(c) && c >= 0)) put('K5', counts.every((c) => c === 0), `${counts[0]} test questions in the training files; ${counts[1]} paragraphs kept outside found in a corpus; ${counts[2]} generator inputs that held a test question`);
  else put('K5', null, 'not measured');

  // the rule: adopt only if all five pass. A failed claim dissolves it. So does a claim left unmeasured once the run
  // has ended (the spend wall). Until then an unmeasured claim is no outcome.
  const adopt = out.every((v) => v.pass === true), failed = out.filter((v) => v.pass === false).map((v) => v.id), open = out.filter((v) => v.pass === null).map((v) => v.id), ended = get(run, 'ended') === true;
  const why = adopt ? 'all five claims passed: the memory path is proposed, and waits for a person\'s yes'
    : failed.length ? `it dissolves: ${failed.join(', ')} failed${open.length ? `; ${open.join(', ')} not measured` : ''}`
    : ended ? `it dissolves: ${open.join(', ')} not measured when the run ended` : `no outcome yet: ${open.join(', ')} not measured`;
  return { verdicts: out, adopt, dissolved: !adopt && (failed.length > 0 || ended), why };
}

export default { FINAL_WORDS, REFUSAL, BARS, NAMES, final, refused, read, tally, verdicts };
