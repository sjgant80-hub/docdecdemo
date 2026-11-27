import { test } from 'node:test';
import assert from 'node:assert/strict';
import M from '../src/mmscore.mjs';

const HOSTILE = [null, undefined, 7, {}, [], () => 1, NaN];
const yes = { answer: 'New York City', answerable: true }, no = { answer: 'New York City', answerable: false };
// n outcomes: the first `right` right, then `wrong` wrong, the rest no answer
const run = (n, right, wrong = 0) => Array.from({ length: n }, (_, i) => (i < right ? 'right' : i < right + wrong ? 'wrong' : 'none'));
// the same count right, but on the LAST questions (so two runs can disagree question by question)
const late = (n, right) => Array.from({ length: n }, (_, i) => (i >= n - right ? 'right' : 'wrong'));
const SHA = 'a'.repeat(64);
const full = (over = {}) => ({
  nAnswerable: 100, nUnanswerable: 50, ended: true,
  answerable: { mm: { corpus: run(100, 70, 20), doubled: run(100, 69, 20) }, mmEdge: { corpus: run(100, 60, 30) }, rag: { corpus: run(100, 50, 40), doubled: run(100, 44, 40) }, docdec: { corpus: run(100, 55, 5), doubled: run(100, 52, 5) } },
  unanswerable: { mm: { corpus: run(50, 40, 10) }, rag: { corpus: run(50, 38, 12) }, docdec: { corpus: run(50, 48, 2) } },
  integrity: { testQuestionsInTraining: 0, outsideParagraphsInCorpus: 0, generatorInputsWithATestQuestion: 0, adapterSha256: SHA, adapterSha256Edge: SHA },
  ...over,
});
const K = (v, id) => v.verdicts.find((x) => x.id === id);

test('the final answer: the first line with any text, cut at twenty words', () => {
  assert.equal(M.FINAL_WORDS, 20);
  assert.equal(M.final('\n  \n  Paris, of course.  \nBecause it is the capital.'), 'Paris, of course.');
  assert.equal(M.final('one\r\ntwo'), 'one');
  const words = Array.from({ length: 25 }, (_, i) => `w${i}`);
  assert.equal(M.final(words.join('  ')), words.slice(0, 20).join(' '));
  assert.equal(M.final(words.slice(0, 20).join(' ')), words.slice(0, 20).join(' '));
  assert.equal(M.final(''), ''); assert.equal(M.final('   \n \n'), '');
  for (const x of HOSTILE) assert.equal(M.final(x), '');
});

test('a refusal: empty, or the phrase, whatever its case and punctuation', () => {
  assert.equal(M.REFUSAL, 'not in the documents');
  for (const a of ['not in the documents', 'Not in the documents.', 'That is NOT in the documents, sorry', 'not in documents', 'It is not in the  documents']) assert.equal(M.refused(a), true, a);
  for (const a of ['', '   ', '...', 'the', undefined, null, 7]) assert.equal(M.refused(a), true, `empty: ${String(a)}`);
  for (const a of ['Paris', 'not in Paris', 'in the documents', 'documents not in', 'cannot in the documents', 'not in the documentsx', 'xnot in the documents', 'I do not know']) assert.equal(M.refused(a), false, a);
});

test('reading an answer to an answerable question: right, a confident wrong answer, or no answer', () => {
  assert.deepEqual(M.read('It was New York City.\nMore text.', yes), { final: 'It was New York City.', outcome: 'right' });
  assert.equal(M.read('new york city', yes).outcome, 'right');
  assert.equal(M.read('The city of New York', yes).outcome, 'wrong', 'the words in order, as whole words');
  assert.equal(M.read('Boston', yes).outcome, 'wrong');
  assert.equal(M.read('not in the documents', yes).outcome, 'none');
  assert.equal(M.read('', yes).outcome, 'none');
  assert.equal(M.read('New York City', yes, { refused: true }).outcome, 'none', 'a system that refused has given no answer, whatever its text');
  for (const r of [1, 'true', {}, null]) assert.equal(M.read('New York City', yes, { refused: r }).outcome, 'right', 'only a real refusal is one');
  // the gold answer past the twentieth word does not count
  const long = Array.from({ length: 20 }, () => 'word').join(' ') + ' New York City';
  assert.equal(M.read(long, yes).outcome, 'wrong');
  assert.equal(M.read('word '.repeat(17) + 'New York City', yes).outcome, 'right');
  // yes and no: the first word decides
  const y = { answer: 'yes', answerable: true }, n = { answer: 'No', answerable: true };
  assert.equal(M.read('Yes, both are American.', y).outcome, 'right');
  assert.equal(M.read('No. Although yes in one sense.', y).outcome, 'wrong', 'a yes later in the answer is not a yes');
  assert.equal(M.read('They are; yes.', y).outcome, 'wrong');
  assert.equal(M.read('no', n).outcome, 'right'); assert.equal(M.read('The no', n).outcome, 'right', 'an article is not a word here');
  assert.equal(M.read('The answer is no', n).outcome, 'wrong', 'its first word is "answer"');
  assert.equal(M.read('Answer: no', n).outcome, 'wrong');
  assert.equal(M.read('yes', n).outcome, 'wrong');
  // a question with no gold answer can never be right
  assert.equal(M.read('anything', { answer: '', answerable: true }).outcome, 'wrong');
  assert.equal(M.read('anything', { answer: 'the', answerable: true }).outcome, 'wrong');
  assert.equal(M.read('anything', { answerable: true }).outcome, 'wrong');
});

test('reading an answer to an unanswerable question: a refusal is right, any answer is wrong', () => {
  assert.deepEqual(M.read('Not in the documents.', no), { final: 'Not in the documents.', outcome: 'right' });
  assert.equal(M.read('', no).outcome, 'right');
  assert.equal(M.read('New York City', no).outcome, 'wrong', 'even the "gold" answer is an invention here');
  assert.equal(M.read('Boston', no, { refused: true }).outcome, 'right');
  for (const q of [null, undefined, {}, { answerable: 1 }, { answerable: 'true' }, 7]) assert.equal(M.read('Boston', q).outcome, 'wrong', 'a question not marked answerable is read as unanswerable');
  for (const x of HOSTILE) assert.equal(typeof M.read(x, x, x).outcome, 'string');
});

test('tally', () => {
  assert.deepEqual(M.tally(['right', 'wrong', 'none', 'right', 'x', null]), { n: 6, right: 2, wrong: 1, none: 1 });
  assert.deepEqual(M.tally([]), { n: 0, right: 0, wrong: 0, none: 0 });
  for (const x of HOSTILE) assert.deepEqual(M.tally(x), { n: 0, right: 0, wrong: 0, none: 0 });
});

test('K1: five points above the better baseline, and significant', () => {
  assert.deepEqual(M.BARS, { liftPoints: 5, alpha: 0.05, noisePoints: 3 });
  const v = M.verdicts(full());
  assert.equal(K(v, 'K1').pass, true);
  assert.equal(K(v, 'K1').result, 'MM 70.0% (70 of 100); DocDec v2 55.0% (55); RAG 50.0% (50); against the better, DocDec v2: 15 only MM right, 0 only DocDec v2 right, p = 0.000061');
  assert.equal(K(v, 'K1').name, 'Long-document lift');
  // the better baseline is the one with more right; DocDec v2 when they tie
  const f = full(); f.answerable.rag.corpus = run(100, 68, 20);
  assert.match(K(M.verdicts(f), 'K1').result, /against the better, RAG: 2 only MM right, 0 only RAG right, p = 0\.50$/);
  assert.equal(K(M.verdicts(f), 'K1').pass, false, 'two points is under the bar');
  const tie = full(); tie.answerable.rag.corpus = late(100, 55);
  assert.match(K(M.verdicts(tie), 'K1').result, /against the better, DocDec v2:/);
  // exactly five points passes the bar; a point under does not
  const five = full(); five.answerable.mm.corpus = run(100, 60, 20);
  assert.match(K(M.verdicts(five), 'K1').result, /5 only MM right, 0 only DocDec v2 right, p = 0\.063$/);
  assert.equal(K(M.verdicts(five), 'K1').pass, false, 'five points, but p is not under 0.05');
  const six = full(); six.answerable.mm.corpus = run(100, 61, 20);
  assert.equal(K(M.verdicts(six), 'K1').pass, true, 'six questions one way and none the other: p = 0.031');
  const small = full(); small.nAnswerable = 20; for (const s of ['mm', 'rag', 'docdec']) for (const c of ['corpus', 'doubled']) small.answerable[s][c] = run(20, s === 'mm' ? 17 : 10, 3); small.answerable.mmEdge.corpus = run(20, 9, 3);
  assert.equal(K(M.verdicts(small), 'K1').pass, true);
  // five points with disagreement both ways is a lift without significance
  const noisy = full(); noisy.answerable.mm.corpus = late(100, 60);
  assert.equal(K(M.verdicts(noisy), 'K1').pass, false);
  assert.match(K(M.verdicts(noisy), 'K1').result, /45 only MM right, 40 only DocDec v2 right/);
  // exactly on the lift bar, and significant: 6 of 120 is five points, six one way and none the other is p = 0.031
  const on = full(); on.nAnswerable = 120; for (const s of Object.keys(on.answerable)) for (const c of Object.keys(on.answerable[s])) on.answerable[s][c] = run(120, 60, 20); on.answerable.mm.corpus = run(120, 66, 20);
  assert.deepEqual([K(M.verdicts(on), 'K1').pass, /6 only MM right, 0 only DocDec v2 right, p = 0\.031$/.test(K(M.verdicts(on), 'K1').result)], [true, true]);
  on.answerable.mm.corpus = run(120, 65, 20);
  assert.equal(K(M.verdicts(on), 'K1').pass, false, 'five of 120 is under five points');
  // p must be UNDER alpha: with the bar put exactly on a p-value that can happen, that p-value does not pass
  assert.equal(K(M.verdicts(five, { alpha: 0.0625 }), 'K1').pass, false, 'five one way and none the other is p = 0.0625 exactly');
  assert.equal(K(M.verdicts(five, { alpha: 0.07 }), 'K1').pass, true);
  assert.equal(K(M.verdicts(five, { alpha: '0.07' }), 'K1').pass, false, 'a bar that is not a number is the sealed bar');
  assert.equal(K(M.verdicts(six, { liftPoints: 7 }), 'K1').pass, false); assert.equal(K(M.verdicts(six, { liftPoints: 6 }), 'K1').pass, true);
  assert.equal(K(M.verdicts(six, { liftPoints: NaN }), 'K1').pass, true); assert.equal(K(M.verdicts(six, { liftPoints: Infinity }), 'K1').pass, true, 'no bar is a bar of infinity: the sealed bar stands');
  // K1 needs all three runs: with any one missing it is not measured
  for (const [s, also] of [['mm', ['K2', 'K3']], ['docdec', []], ['rag', ['K2']]]) { const g = full(); delete g.answerable[s].corpus; const w = M.verdicts(g); assert.deepEqual([K(w, 'K1').pass, K(w, 'K1').result], [null, 'not measured'], `without ${s}`); for (const k of also) assert.equal(K(w, k).pass, null, `${k} without ${s}`); }
  // worse than the baseline is a fail, not a pass by significance
  const worse = full(); worse.answerable.mm.corpus = run(100, 30, 20);
  assert.equal(K(M.verdicts(worse), 'K1').pass, false);
});

test('K2: the drop on the doubled corpus is at least three points smaller than RAG\'s', () => {
  const v = M.verdicts(full());
  assert.equal(K(v, 'K2').pass, true);
  assert.equal(K(v, 'K2').result, 'on the doubled corpus MM went 70 → 69 of 100 (a drop of 1.0 points); RAG 50 → 44 (6.0 points); DocDec v2 55 → 52');
  const edge = full(); edge.answerable.mm.doubled = run(100, 67, 20);
  assert.equal(K(M.verdicts(edge), 'K2').pass, true, 'exactly three points smaller passes');
  const under = full(); under.answerable.mm.doubled = run(100, 66, 20);
  assert.equal(K(M.verdicts(under), 'K2').pass, false, 'two points smaller does not');
  const both = full(); both.answerable.mm.doubled = run(100, 72, 20); both.answerable.rag.doubled = run(100, 51, 40);
  assert.equal(K(M.verdicts(both), 'K2').pass, false, 'when neither drops, the memory has shown nothing: a gain of 2 against a gain of 1');
  assert.match(K(M.verdicts(both), 'K2').result, /a drop of -2\.0 points\); RAG 50 → 51 \(-1\.0 points\)/);
  const noDoc = full(); delete noDoc.answerable.docdec.doubled;
  assert.equal(K(M.verdicts(noDoc), 'K2').result, 'on the doubled corpus MM went 70 → 69 of 100 (a drop of 1.0 points); RAG 50 → 44 (6.0 points)');
  assert.equal(K(M.verdicts(full(), { noisePoints: 5 }), 'K2').pass, true); assert.equal(K(M.verdicts(full(), { noisePoints: 6 }), 'K2').pass, false, 'the noise bar can be moved by a caller, and only by a number');
  for (const s of ['mm', 'rag']) { const g = full(); delete g.answerable[s].doubled; assert.equal(K(M.verdicts(g), 'K2').pass, null, `K2 without ${s} on the doubled corpus`); }
});

test('K3: the same memory weights, and the larger executive is not worse than the edge one', () => {
  const v = M.verdicts(full());
  assert.deepEqual([K(v, 'K3').pass, K(v, 'K3').result], [true, 'the same memory weights: 60 of 100 right with the edge executive, 70 with the larger one']);
  const equal = full(); equal.answerable.mmEdge.corpus = run(100, 70, 0);
  assert.equal(K(M.verdicts(equal), 'K3').pass, true, 'not below: equal passes');
  const fell = full(); fell.answerable.mmEdge.corpus = run(100, 71, 0);
  assert.equal(K(M.verdicts(fell), 'K3').pass, false);
  for (const edgeSha of ['b'.repeat(64), undefined, '', SHA.slice(1)]) {
    const other = full(); other.integrity.adapterSha256Edge = edgeSha;
    assert.deepEqual([K(M.verdicts(other), 'K3').pass, /^NOT shown to be the same memory weights/.test(K(M.verdicts(other), 'K3').result)], [false, true]);
  }
  const bad = full(); bad.integrity.adapterSha256 = 'zz'; bad.integrity.adapterSha256Edge = 'zz';
  assert.equal(K(M.verdicts(bad), 'K3').pass, false, 'two equal strings that are no SHA-256 show nothing');
  const upper = full(); upper.integrity.adapterSha256 = 'A'.repeat(64); upper.integrity.adapterSha256Edge = 'A'.repeat(64);
  assert.equal(K(M.verdicts(upper), 'K3').pass, false);
  const long = full(); long.integrity.adapterSha256 = SHA + 'a'; long.integrity.adapterSha256Edge = SHA + 'a';
  assert.equal(K(M.verdicts(long), 'K3').pass, false);
});

test('K4: on questions that are not in the documents, no more confident wrong answers than RAG', () => {
  const v = M.verdicts(full());
  assert.deepEqual([K(v, 'K4').pass, K(v, 'K4').result], [true, 'confident wrong answers on 50 questions that are not in the documents: MM 10, RAG 12, DocDec v2 2']);
  const same = full(); same.unanswerable.mm.corpus = run(50, 38, 12);
  assert.equal(K(M.verdicts(same), 'K4').pass, true, 'no more than: equal passes');
  const more = full(); more.unanswerable.mm.corpus = run(50, 37, 13);
  assert.equal(K(M.verdicts(more), 'K4').pass, false);
  const noDoc = full(); delete noDoc.unanswerable.docdec;
  assert.equal(K(M.verdicts(noDoc), 'K4').result, 'confident wrong answers on 50 questions that are not in the documents: MM 10, RAG 12');
});

test('K5: nothing of the test in the training, nothing kept outside in a corpus', () => {
  const v = M.verdicts(full());
  assert.deepEqual([K(v, 'K5').pass, K(v, 'K5').result], [true, '0 test questions in the training files; 0 paragraphs kept outside found in a corpus; 0 generator inputs that held a test question']);
  for (const k of ['testQuestionsInTraining', 'outsideParagraphsInCorpus', 'generatorInputsWithATestQuestion']) {
    const f = full(); f.integrity[k] = 1;
    assert.equal(K(M.verdicts(f), 'K5').pass, false, k);
    for (const bad of [undefined, -1, 0.5, '0', null]) { const g = full(); g.integrity[k] = bad; assert.deepEqual([K(M.verdicts(g), 'K5').pass, K(M.verdicts(g), 'K5').result], [null, 'not measured'], `${k} = ${String(bad)}`); }
  }
});

test('the rule: adopt only if all five pass; a failed claim dissolves it; so does an unmeasured one once the run has ended', () => {
  const all = M.verdicts(full());
  assert.deepEqual([all.adopt, all.dissolved, all.why], [true, false, 'all five claims passed: the memory path is proposed, and waits for a person\'s yes']);
  assert.deepEqual(all.verdicts.map((x) => x.id), ['K1', 'K2', 'K3', 'K4', 'K5']);
  const f = full(); f.answerable.mm.corpus = run(100, 30, 20); f.unanswerable.mm.corpus = run(50, 30, 20);
  const failed = M.verdicts(f);
  assert.deepEqual([failed.adopt, failed.dissolved, failed.why], [false, true, 'it dissolves: K1, K3, K4 failed']);
  // a run that was not measured: a wrong length, a wrong word, a missing system
  const part = full({ ended: false }); part.answerable.mm.doubled = run(99, 60); part.answerable.mmEdge.corpus = [...run(99, 60), 'maybe']; delete part.unanswerable.rag;
  const open = M.verdicts(part);
  assert.deepEqual(open.verdicts.map((x) => x.pass), [true, null, null, null, true]);
  assert.deepEqual(open.verdicts.filter((x) => x.pass === null).map((x) => x.result), ['not measured', 'not measured', 'not measured']);
  assert.deepEqual([open.adopt, open.dissolved, open.why], [false, false, 'no outcome yet: K2, K3, K4 not measured']);
  const ended = M.verdicts({ ...part, ended: true });
  assert.deepEqual([ended.adopt, ended.dissolved, ended.why], [false, true, 'it dissolves: K2, K3, K4 not measured when the run ended']);
  for (const e of [1, 'true', undefined]) assert.equal(M.verdicts({ ...part, ended: e }).dissolved, false, 'only a run marked ended has ended');
  const mixed = full({ ended: false }); mixed.answerable.mm.corpus = run(100, 30, 20); delete mixed.unanswerable.rag;
  assert.equal(M.verdicts(mixed).why, 'it dissolves: K1, K3 failed; K4 not measured');
  assert.equal(M.verdicts(mixed).dissolved, true);
  // nothing at all
  for (const x of [...HOSTILE, 'x']) {
    const v = M.verdicts(x);
    assert.deepEqual(v.verdicts.map((k) => k.pass), [null, null, null, null, null]);
    assert.deepEqual([v.adopt, v.dissolved, v.why], [false, false, 'no outcome yet: K1, K2, K3, K4, K5 not measured']);
  }
  // an empty set is not a measured set
  const none = full(); none.nAnswerable = 0; for (const s of Object.keys(none.answerable)) for (const c of Object.keys(none.answerable[s])) none.answerable[s][c] = [];
  assert.deepEqual(M.verdicts(none).verdicts.slice(0, 3).map((k) => k.pass), [null, null, null]);
  const trap = new Proxy({}, { get() { throw new Error('trap'); } });
  assert.equal(M.verdicts(trap).adopt, false);
  assert.deepEqual(M.NAMES, { K1: 'Long-document lift', K2: 'Noise robustness', K3: 'Executive swap', K4: 'Honest boundary', K5: 'Held-out integrity' });
});
