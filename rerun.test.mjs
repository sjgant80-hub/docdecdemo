// The published numbers are recomputed from the shipped raw data on every push — by the same rerun.mjs the page's
// "Re-run it yourself" button runs. If any published number, the chosen gate, or an example's label is not what the
// kernel actually produces from this data, CI fails here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import K from './kernel.mjs';
import { measureAll, cosine, prepare, searchDecisions, agrees, decide, spotCheck, publish, pickExamples } from './rerun.mjs';

const demo = JSON.parse(readFileSync(new URL('./demo-data.json', import.meta.url), 'utf8'));
const ev = JSON.parse(readFileSync(new URL('./eval-data.json', import.meta.url), 'utf8'));
const paragraphs = ev.paragraphs.map((p) => ({ ...p, vec: demo.vectors[p.id] }));
const { P, bench, free, offTopic } = measureAll(paragraphs, ev.questions, ev.outOfScope);

test('the shipped data is the pinned SQuAD 2.0 dev subset', () => {
  assert.equal(ev.squadSha256, '80a5225e94905956a6446d296ca1093975c4d3b3260f1d6c8f68bc2ab77182d8');
  assert.equal(demo.measured.squadSha256, ev.squadSha256);
  assert.equal(ev.paragraphs.length, 130);
  assert.equal(ev.questions.length, 600);
  assert.equal(ev.outOfScope.length, 600);
  for (const p of ev.paragraphs) assert.ok(Array.isArray(demo.vectors[p.id]) && demo.vectors[p.id].length > 100, 'vector for ' + p.id);
});

test('tokens + idf the page routes on are recomputed from the raw paragraph text', () => {
  for (const d of demo.docsCorpus) assert.deepEqual(d.terms, K.tokens(d.text), d.id);
  assert.deepEqual(demo.idf, [...P.idf.entries()]);
});

test('the benchmark gate is re-chosen on the tune split and the headline numbers recompute exactly', () => {
  assert.equal(bench.configsTried, 75);
  assert.deepEqual(bench.gate, demo.gate);
  assert.deepEqual(bench.gate, demo.measured.docdec.gate);
  for (const k of ['answerable', 'unanswerable', 'recall', 'precisionWhenAnswering', 'hallucinationRate', 'groundedAbstention']) {
    assert.deepEqual(bench.docdec[k], demo.measured.docdec[k], 'docdec ' + k);
    assert.deepEqual(bench.vectorRag[k], demo.measured.vectorRag[k], 'vectorRag ' + k);
  }
  assert.deepEqual(demo.measured.counts.eval, bench.eval);
  assert.equal(bench.vectorRag.groundedAbstention, 0); // top-1 cannot abstain — structural, not tuned
});

test('the free-box gate is re-chosen on its own use case and its numbers recompute exactly', () => {
  assert.equal(free.configsTried, 140);
  assert.deepEqual(free.gate, demo.freeGate);
  assert.deepEqual(free.eval, demo.freeMeasured.eval);
  assert.deepEqual(free.before, demo.freeMeasured.before);
  assert.ok(free.eval.outOfScopeAbstention > free.before.outOfScopeAbstention, 'the fix must actually abstain more on real off-topic questions');
});

test('the full DocDec off-topic number recomputes exactly, on every eval off-topic question, with no tuning', () => {
  assert.deepEqual(offTopic, demo.offTopicMeasured);
  assert.deepEqual(offTopic.gate, demo.gate, 'measured with the benchmark gate, not a gate chosen for this number');
  assert.equal(offTopic.missingVectors, 0);
  assert.equal(offTopic.total, free.counts.outOfScopeEval, 'the same eval questions the free box is reported on');
});

test('EVERY published field rebuilds exactly from the raw data — numbers, counts, and the sentences that quote them', () => {
  const pub = publish({ bench, free, offTopic }, { paragraphs: ev.paragraphs.length, questions: ev.questions.length,
    answerable: ev.questions.filter((q) => !q.impossible).length, unanswerable: ev.questions.filter((q) => q.impossible).length });
  for (const k of Object.keys(pub)) assert.deepEqual(demo[k], pub[k], 'published field ' + k);
  assert.deepEqual(demo.counts, { paragraphs: ev.paragraphs.length, evalQuestions: bench.eval });
  assert.deepEqual(demo.corpus, ['Normans', 'Oxygen', 'Computational_complexity_theory']);
  for (const p of ev.paragraphs) assert.equal(demo.docsCorpus.find((d) => d.id === p.id).text, p.text, 'paragraph text ' + p.id);
});

test('the 12 side-by-side examples are chosen by the fixed first-4/4/2/2 rule, not by hand', () => {
  assert.deepEqual(demo.demoQuestions, pickExamples(P, bench));
  assert.deepEqual(demo.demoQuestions.map((q) => q.label), ['win', 'win', 'win', 'win', 'both-right', 'both-right', 'both-right', 'both-right', 'dd-missed', 'dd-missed', 'dd-hallucinated', 'dd-hallucinated']);
});

test('every side-by-side example shows the verdict the gate actually gives it (confidence recomputed live, not stored)', () => {
  const docs = P.docs;
  for (const q of demo.demoQuestions) {
    const conf = {}; for (const d of docs) conf[d.id] = cosine(q.qvec, demo.vectors[d.id]);
    const dd = K.route(q.qterms, docs, P.idf, { ...demo.gate, confidence: conf });
    const label = q.impossible ? (dd.abstain ? 'win' : 'dd-hallucinated') : (!dd.abstain && dd.answer === q.goldId ? 'both-right' : (dd.abstain ? 'dd-missed' : 'other'));
    assert.equal(label, q.label, q.qid);
    assert.deepEqual(q.qterms, K.tokens(q.text), q.qid);
  }
});

test('the fast settings search IS the kernel: decide() == route() on every one of the 63,900 decisions it makes', () => {
  const all = searchDecisions(P);
  assert.equal(all.length, 75 * 180 + 140 * (90 + 180 + 90));
  let bad = 0, first = null, abstains = 0;
  for (const x of all) { if (!agrees(P, x)) { bad++; first = first || x; } if (decide(x.q, x.opts, P.hasRunnerUp).abstain) abstains++; }
  assert.equal(bad, 0, first ? 'first disagreement: ' + JSON.stringify({ qid: first.q.qid, opts: first.opts }) : '');
  // not a vacuous agreement: the search really does both answer and abstain, many times each
  assert.ok(abstains > 5000 && all.length - abstains > 5000, `abstain ${abstains} / answer ${all.length - abstains}`);
  // and the browser's spot-check samples that same set
  const sc = spotCheck(P, 2000);
  assert.equal(sc.checked, 2000); assert.equal(sc.agree, 2000); assert.equal(sc.of, all.length);
});

test('decide() would be caught if it drifted from the kernel (each gate check matters)', () => {
  const all = searchDecisions(P);
  const drift = [
    (q, o, h) => decide(q, { ...o, margin: 0 }, h),                      // margin check dropped
    (q, o, h) => decide(q, { ...o, minCoverage: 0 }, h),                 // coverage check dropped
    (q, o, h) => decide(q, { ...o, minConfidence: null }, h),            // confidence veto dropped
    (q, o, h) => decide(q, { ...o, minScore: (o.minScore || 1) + 0.5 }, h), // score floor shifted
  ];
  for (const [i, f] of drift.entries()) {
    const differs = all.some((x) => { const a = f(x.q, x.opts, P.hasRunnerUp), b = decide(x.q, x.opts, P.hasRunnerUp); return (a.abstain === true) !== (b.abstain === true); });
    assert.ok(differs, 'drift ' + i + ' must change some decision, or the equality test could not see it');
  }
});

test('prepare() is total on garbage — the browser re-run never throws on a bad file', () => {
  assert.doesNotThrow(() => prepare([], [], []));
  assert.doesNotThrow(() => prepare([{ id: 'x', text: '', vec: [] }], [{ qid: 'q', text: '', vec: [] }], undefined));
});
