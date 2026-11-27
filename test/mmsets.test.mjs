import { test } from 'node:test';
import assert from 'node:assert/strict';
import S from '../src/mmsets.mjs';

// a row with ten paragraphs: T<k>a and T<k>b are its sources, the other eight are its annotated distractors
const row = (k, over = {}) => {
  const titles = [`D${k}-1`, `T${k}a`, `D${k}-2`, `T${k}b`, `D${k}-3`, `D${k}-4`, `D${k}-5`, `D${k}-6`, `D${k}-7`, `D${k}-8`];
  return { id: `q${k}`, question: `Question ${k}?`, answer: `answer ${k}`, type: k % 2 ? 'bridge' : 'comparison', titles, texts: titles.map((t) => (t === `T${k}a` ? `The text of ${t} holds Answer ${k}, plainly.` : `The text of ${t}.`)), gold: [`T${k}a`, `T${k}b`], ...over };
};
const HOSTILE = [null, undefined, 7, 'x', {}, [], () => 1, NaN];

test('norm and holds: how an answer is compared with a paragraph', () => {
  assert.equal(S.norm('  The  Quick, brown-fox!  An  apple a day.'), 'quick brown fox apple day');
  assert.equal(S.norm('Émile Zola’s 1885 novel'), 'émile zola s 1885 novel');
  assert.equal(S.norm('THE'), ''); assert.equal(S.norm('a'), ''); assert.equal(S.norm('an'), ''); assert.equal(S.norm('then another'), 'then another', 'only whole articles are dropped');
  for (const x of HOSTILE) assert.equal(S.norm(x), typeof x === 'string' ? 'x' : '');
  assert.equal(S.holds('He was born in New York City, in 1950.', 'new york city'), true);
  assert.equal(S.holds('He was born in New York City.', 'York'), true);
  assert.equal(S.holds('He was born in New Yorkshire.', 'York'), false, 'whole words only');
  assert.equal(S.holds('city of New York', 'New York City'), false, 'in order');
  assert.equal(S.holds('He was born in New, York City', 'New York City'), true, 'punctuation does not part the words');
  assert.equal(S.holds('The answer is the Beatles', 'Beatles'), true);
  assert.equal(S.holds('anything', ''), false); assert.equal(S.holds('anything', 'the'), false, 'an answer of nothing is held by nothing');
  assert.equal(S.holds('', 'x'), false);
  for (const x of HOSTILE) { assert.equal(S.holds(x, 'q'), false); assert.equal(S.holds('q', x), x === 'x' ? false : false); }
  assert.deepEqual(S.YESNO, ['yes', 'no']);
});

test('usable: the reason a row is left out, or null', () => {
  assert.equal(S.usable(row(1)), null);
  assert.equal(S.usable(row(1, { answer: 'Yes' })), null, 'a yes/no answer need not be in a paragraph');
  assert.equal(S.usable(row(1, { answer: 'no.' })), null);
  assert.equal(S.usable(row(1, { answer: 'nothing like it' })), 'the answer is not word for word in a source paragraph');
  assert.equal(S.usable(row(1, { answer: 'The text of D1-1' })), 'the answer is not word for word in a source paragraph', 'a distractor does not count as a source');
  const inB = row(1); inB.texts[3] = 'T1b says seventeen.'; inB.answer = 'seventeen'; inB.texts[1] = 'The text of T1a.';
  assert.equal(S.usable(inB), null, 'either source may hold the answer');
  assert.equal(S.usable(row(1, { answer: ' ' })), 'no answer'); assert.equal(S.usable(row(1, { answer: 'the' })), 'no answer');
  assert.equal(S.usable(row(1, { id: '' })), 'no id or no question'); assert.equal(S.usable(row(1, { question: '  ' })), 'no id or no question'); assert.equal(S.usable(row(1, { id: 7 })), 'no id or no question');
  assert.equal(S.usable(row(1, { gold: ['T1a'] })), 'not exactly two source paragraphs');
  assert.equal(S.usable(row(1, { gold: ['T1a', 'T1a'] })), 'not exactly two source paragraphs', 'the same paragraph twice is one');
  assert.equal(S.usable(row(1, { gold: ['T1a', 'T1b', 'D1-1'] })), 'not exactly two source paragraphs');
  assert.equal(S.usable(row(1, { gold: ['T1a', 'elsewhere'] })), 'a source paragraph is not among its paragraphs');
  assert.equal(S.usable(row(1, { texts: ['only one'] })), 'paragraphs and titles do not pair up');
  assert.equal(S.usable(row(1, { titles: [], texts: [] })), 'paragraphs and titles do not pair up');
  const twice = row(1); twice.titles[0] = 'T1a';
  assert.equal(S.usable(twice), 'a title is carried twice');
  const blank = row(1); blank.texts[0] = '  ';
  assert.equal(S.usable(blank), 'an empty title or paragraph');
  const noTitle = row(1); noTitle.titles[0] = ' ';
  assert.equal(S.usable(noTitle), 'an empty title or paragraph');
  for (const x of HOSTILE) assert.equal(typeof S.usable(x), 'string');
});

test('plan: answerable first, then unanswerable, then foreign, in file order; sources of answerable questions are the corpus', () => {
  const rows = Array.from({ length: 12 }, (_, i) => row(i));
  const p = S.plan(rows, { start: 2, answerable: 3, unanswerable: 2, foreign: 2, perQuestion: 2 });
  assert.deepEqual(p.answerable.map((q) => q.qid), ['q2', 'q3', 'q4']);
  assert.deepEqual(p.unanswerable.map((q) => q.qid), ['q5', 'q6']);
  assert.deepEqual(p.foreign.map((q) => q.qid), ['q7', 'q8']);
  assert.deepEqual(p.corpus.map((x) => x.id), ['T2a', 'T2b', 'T3a', 'T3b', 'T4a', 'T4b']);
  assert.deepEqual(p.corpus[0], { id: 'T2a', title: 'T2a', text: 'The text of T2a holds Answer 2, plainly.' });
  assert.deepEqual(p.answerable[0], { qid: 'q2', text: 'Question 2?', answer: 'answer 2', type: 'comparison', gold: ['T2a', 'T2b'] });
  assert.deepEqual(p.foreign[0].paragraphs.map((x) => x.id), ['T7a', 'T7b'], 'a foreign question carries its own paragraphs: they are in no corpus');
  assert.equal(p.unanswerable[0].paragraphs, undefined);
  // the noise: each answerable question's first two annotated distractors, in its own order, until as large as the corpus
  assert.deepEqual(p.noise.map((x) => x.id), ['D2-1', 'D2-2', 'D3-1', 'D3-2', 'D4-1', 'D4-2']);
  assert.deepEqual(p.counts, { read: 7, answerable: 3, unanswerable: 2, foreign: 2, corpus: 6, noise: 6, skipped: 0, titleClashes: 0, full: true });
  assert.deepEqual(S.check(p), []);
  // nothing before the start is read, and it stops as soon as every set is full
  assert.equal(S.plan(rows, { start: 0, answerable: 1, unanswerable: 0, foreign: 0, perQuestion: 2 }).counts.read, 1);
  assert.deepEqual(S.plan(rows, { start: 11, answerable: 1, unanswerable: 0, foreign: 0 }).answerable.map((q) => q.qid), ['q11']);
  const out = S.plan(rows, { start: 12, answerable: 1, unanswerable: 0, foreign: 0 });
  assert.deepEqual([out.counts.full, out.counts.read, out.skipped], [false, 0, []], 'the file ran out: nothing past its end is read');
  assert.deepEqual(S.plan(rows, { start: 11, answerable: 2 }).counts.read, 1);
  assert.equal(S.plan(rows, { start: 9, answerable: 1, unanswerable: 1, foreign: 2 }).counts.full, false);
});

test('plan: a row that is not usable is skipped with its reason; a question kept outside shares no source with the corpus or with another outside question', () => {
  const rows = [row(0), row(1, { answer: 'not there' }), row(2),
    row(3, { gold: ['T3a', 'D3-1'] }),                       // usable: an answerable question
    (() => { const r = row(4); r.titles[1] = 'T0a'; r.gold = ['T0a', 'T4b']; r.texts[1] = 'The text of T0a holds Answer 0, plainly.'; r.answer = 'answer 0'; return r; })(),   // a source is already in the corpus
    row(5), row(6),
    (() => { const r = row(7); r.titles[3] = 'T5b'; r.gold = ['T7a', 'T5b']; return r; })(),   // shares a source with the outside question q5
    row(8)];
  rows[3].texts[rows[3].titles.indexOf('T3a')] = 'The text of T3a holds Answer 3, plainly.';
  const p = S.plan(rows, { start: 0, answerable: 3, unanswerable: 2, foreign: 1, perQuestion: 2 });
  assert.deepEqual(p.answerable.map((q) => q.qid), ['q0', 'q2', 'q3']);
  assert.deepEqual(p.unanswerable.map((q) => q.qid), ['q5', 'q6']);
  assert.deepEqual(p.foreign.map((q) => q.qid), ['q8']);
  assert.deepEqual(p.skipped, [{ row: 1, why: 'the answer is not word for word in a source paragraph' }, { row: 4, why: 'a source paragraph is already in the corpus' }, { row: 7, why: 'a source paragraph belongs to another question kept outside the corpus' }]);
  assert.deepEqual(p.corpus.map((x) => x.id), ['T0a', 'T0b', 'T2a', 'T2b', 'T3a', 'D3-1']);
  // q3's source D3-1 is corpus, so it is not noise; T3b is no source of q3 here, so it is one of its distractors
  assert.deepEqual(p.noise.map((x) => x.id), ['D0-1', 'D0-2', 'D2-1', 'D2-2', 'D3-2', 'T3b']);
  assert.deepEqual(S.check(p), []);
  assert.equal(p.counts.skipped, 3);
});

test('plan: two answerable questions that share a source put it in the corpus once, and the noise still matches the corpus in size', () => {
  const a = row(0), b = row(1); b.titles[1] = 'T0a'; b.gold = ['T0a', 'T1b']; b.texts[1] = a.texts[1]; b.answer = 'answer 0';
  const p = S.plan([a, b], { start: 0, answerable: 2, unanswerable: 0, foreign: 0, perQuestion: 2 });
  assert.deepEqual(p.corpus.map((x) => x.id), ['T0a', 'T0b', 'T1b']);
  assert.deepEqual(p.noise.map((x) => x.id), ['D0-1', 'D0-2', 'D1-1'], 'it stops when it is as large as the corpus');
  assert.equal(p.counts.titleClashes, 0);
  // the same title with other text is counted
  const c = row(1); c.titles[1] = 'T0a'; c.gold = ['T0a', 'T1b']; c.texts[1] = 'Other words: answer 0.'; c.answer = 'answer 0';
  assert.equal(S.plan([a, c], { start: 0, answerable: 2, unanswerable: 0, foreign: 0 }).counts.titleClashes, 1);
});

test('plan: the noise never takes a paragraph kept outside, and goes round again when the first pass is short', () => {
  // q0's first distractor is q1's source (q1 is kept outside): it may not be noise
  const a = row(0), u = row(1); a.titles[0] = 'T1a'; a.texts[0] = u.texts[1];
  const p = S.plan([a, u], { start: 0, answerable: 1, unanswerable: 1, foreign: 0, perQuestion: 2 });
  assert.deepEqual(p.noise.map((x) => x.id), ['D0-2', 'D0-3']);
  assert.deepEqual(S.check(p), []);
  // one distractor a question on the first pass leaves the noise short; later passes take one more each
  const q = S.plan([row(0), row(1)], { start: 0, answerable: 2, unanswerable: 0, foreign: 0, perQuestion: 1 });
  assert.deepEqual(q.noise.map((x) => x.id), ['D0-1', 'D1-1', 'D0-2', 'D1-2']);
  assert.equal(q.counts.full, true);
  // a row with too few distractors: the noise ends short, and the set is not full
  const thin = row(0); thin.titles = ['T0a', 'T0b', 'D0-1']; thin.texts = [thin.texts[1], 'The text of T0b.', 'The text of D0-1.'];
  const r = S.plan([thin], { start: 0, answerable: 1, unanswerable: 0, foreign: 0, perQuestion: 2 });
  assert.deepEqual([r.noise.map((x) => x.id), r.counts.full], [['D0-1'], false]);
  // perQuestion defaults to two; none a question on the first pass means no noise at all
  assert.equal(S.plan([row(0)], { start: 0, answerable: 1 }).noise.length, 2);
  assert.deepEqual(S.plan([row(0)], { start: 0, answerable: 1, perQuestion: 0 }).noise, []);
  // a distractor that is another answerable question's source is corpus, not noise; one two questions share is noise once
  const x = row(0), y = row(1); x.titles[0] = 'T1a'; x.texts[0] = y.texts[1]; y.titles[0] = 'D0-2'; y.texts[0] = 'The text of D0-2.';
  const z = S.plan([x, y], { start: 0, answerable: 2, unanswerable: 0, foreign: 0, perQuestion: 2 });
  assert.deepEqual(z.noise.map((n) => n.id), ['D0-2', 'D0-3', 'D1-2', 'D1-3']);
  assert.deepEqual(S.check(z), []);
});

test('check: every way a built set can break its rule is named', () => {
  const rows = Array.from({ length: 8 }, (_, i) => row(i));
  const good = () => S.plan(rows, { start: 0, answerable: 2, unanswerable: 2, foreign: 2, perQuestion: 2 });
  assert.deepEqual(S.check(good()), []);
  const has = (set, re) => assert.ok(S.check(set).some((b) => re.test(b)), `${re} not in ${JSON.stringify(S.check(set))}`);
  let s = good(); s.corpus.push(s.corpus[0]); has(s, /in the corpus twice/);
  s = good(); s.noise.push(s.noise[0]); has(s, /in the noise twice/);
  s = good(); s.noise[0] = s.corpus[0]; has(s, /is both corpus and noise/);
  s = good(); s.corpus.push({ id: 'T2a' }); has(s, /"T2a" is kept outside and is in the corpus/);
  s = good(); s.noise[0] = { id: 'T4b' }; has(s, /"T4b" is kept outside and is in the noise/);
  s = good(); s.corpus.shift(); has(s, /"T0a", a source of an answerable question, is not in the corpus/);
  s = good(); s.unanswerable.push(s.answerable[0]); has(s, /question q0 is in two sets/);
  s = good(); s.foreign[0].gold = ['T2a', 'T4b']; has(s, /"T2a" is a source of both an unanswerable question and a foreign one/);
  s = good(); s.noise.pop(); has(s, /the noise \(3\) is not the size of the corpus \(4\)/);
  for (const x of HOSTILE) assert.deepEqual(S.check(x), []);
  assert.deepEqual(S.check({ corpus: [null, 7], noise: 'x', answerable: [null], unanswerable: [{}], foreign: [{ gold: 7 }] }).filter((b) => !/twice|size|two sets/.test(b)), []);
});

test('pure and total: hostile rows and options give an empty plan, and nothing throws', () => {
  for (const r of HOSTILE) for (const o of HOSTILE) {
    const p = S.plan(r, o);
    assert.deepEqual([p.answerable, p.unanswerable, p.foreign, p.corpus, p.noise], [[], [], [], [], []]);
  }
  const p = S.plan([null, 7, {}, row(0)], { start: 0, answerable: 1, unanswerable: 0, foreign: 0 });
  assert.deepEqual([p.answerable.length, p.skipped.length, p.counts.read], [1, 3, 4]);
  assert.equal(S.plan([row(0)], { start: -1, answerable: 1 }).counts.read, 1, 'a start that is no index is the beginning');
  assert.equal(S.plan([row(0)], { start: 0.5, answerable: 1 }).counts.read, 1);
  assert.equal(S.plan([row(0)], { start: 0, answerable: -3 }).answerable.length, 0);
});
