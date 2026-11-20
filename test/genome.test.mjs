// DocDec as a cell of the estate genome: its judge (the C6 audit), its lane, and the measurement behind the lane's share.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { judge, inLane, health, LANE } from '../genome/cell.mjs';
import { laneShare, content, vocabulary, measure, words, SHARES } from '../genome/lane-share.mjs';

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const GOOD = { source: 'Normans#33', start: 122, end: 147, text: 'in the early 11th century' };

test('judge: the C6 audit — exact words at their offsets are verified, anything else is not', async () => {
  assert.equal(await judge(GOOD), 'verified');
  assert.equal(await judge({ ...GOOD, text: 'in the late 11th century' }), 'unverified');
  assert.equal(await judge({ ...GOOD, start: 121 }), 'unverified');
  assert.equal(await judge({ ...GOOD, source: 'Normans#999' }), 'refused');
  for (const bad of [null, 'x', 5, {}, { ...GOOD, source: 33 }, { ...GOOD, start: '122' }, { ...GOOD, end: 147.5 }, { ...GOOD, text: null },
    { source: 'Normans#33', text: 'x' }, { source: 'Normans#33', start: 0, text: 'x' }, { source: 'Normans#33', end: 1, text: 'x' }, { start: 0, end: 1, text: 'x' }]) {
    assert.equal(await judge(bad), 'refused', JSON.stringify(bad));
  }
});

test('judge verifies real slices of the index, at their true offsets', async () => {
  const docs = read('../data/v2/freebox.json').docs;
  let n = 0;
  for (const d of docs.slice(0, 20)) {
    const start = 0, end = Math.min(40, d.text.length);
    assert.equal(await judge({ source: d.id, start, end, text: d.text.slice(start, end) }), 'verified');
    n++;
  }
  assert.equal(n, 20);
});

test('lane: on-topic questions are taken, off-topic ones refused, and it never reads a non-question', async () => {
  assert.equal(await inLane({ question: 'Who used the church to unify themselves?' }), true);
  assert.equal(await inLane({ question: 'What is the best pizza topping?' }), false);
  assert.equal(await inLane({ question: '' }), false);
  for (const bad of [null, 'Who used the church?', {}, { question: 5 }, { question: ['Who used the church to unify themselves?'] }]) {
    assert.equal(await inLane(bad), false, JSON.stringify(bad));
  }
});

test('lane: the share is inclusive — exactly the measured share is in lane', async () => {
  assert.equal(LANE.share, 0.67);
  const q = Array(67).fill('church').concat(Array(33).fill('zzzq')).join(' ');
  assert.equal(laneShare(q, vocabulary(read('../data/v2/freebox.json').docs)), 0.67);
  assert.equal(await inLane({ question: q }), true);
  const under = Array(66).fill('church').concat(Array(34).fill('zzzq')).join(' ');
  assert.equal(await inLane({ question: under }), false);
});

test('lane-share: content words drop stopwords and words under three letters, and keep three-letter ones', () => {
  assert.deepEqual(words('Why did Rollo WIN, in 911?'), ['why', 'did', 'rollo', 'win', 'in', '911']);
  assert.deepEqual(content('Why did Rollo WIN, in 911?'), ['rollo', 'win', '911']);   // why, did and in are DocDec's stopwords
  assert.deepEqual(content('of an is'), []);
  assert.deepEqual(words(''), []);
  const v = vocabulary([{ title: 'Normans', text: 'The dukes' }]);
  assert.deepEqual([...v].sort(), ['dukes', 'normans', 'the']);
  assert.equal(laneShare('dukes zzzq', v), 0.5);
  assert.equal(laneShare('of', v), 0);
});

test('the recorded lane measurement re-derives from DocDec’s own sets', () => {
  assert.deepEqual(measure(read('../data/v2/s1.json')), read('../data/genome-lane.json'));
  assert.deepEqual(LANE.eval, { inLaneAccepted: 0.8633, offTopicRefused: 0.82, n: [300, 300] });
});

test('measure: picks the best tune share, the first one on a tie, and splits each set in half by file order', () => {
  const s = { paragraphs: [{ title: 'a', text: 'church' }], questions: [{ text: 'church church' }, { text: 'church zzzq' }], oos: [{ text: 'zzzq' }, { text: 'church' }] };
  const m = measure(s);
  assert.equal(m.share, SHARES[0]);
  assert.deepEqual(m.tune, { inLaneAccepted: 1, offTopicRefused: 1, n: [1, 1] });
  assert.deepEqual(m.eval, { inLaneAccepted: 1, offTopicRefused: 0, n: [1, 1] });
  assert.equal(m.rule, "in lane when at least 50% of the question's content words appear as whole words in the indexed passages");
  const t = { paragraphs: [{ title: 'a', text: 'church dukes' }], questions: [{ text: 'church dukes' }, { text: 'x' }], oos: [{ text: 'church zzzq qqqz' }, { text: 'x' }] };
  assert.equal(measure(t).share, 0.5);
  const u = { paragraphs: [{ title: 'a', text: 'church dukes' }], questions: [{ text: 'church dukes zzzq' }, { text: 'x' }], oos: [{ text: 'church zzzq' }, { text: 'x' }] };
  assert.equal(measure(u).share, 0.6);
});

test('health says what DocDec cannot measure from inside its repository', async () => {
  assert.deepEqual(await health(), { used: null, dependedOn: null, lastEarned: null });
});
