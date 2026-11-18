import test from 'node:test';
import assert from 'node:assert/strict';
import G from '../src/gate.mjs';

test('parseReader: first line, outer quotes, one full stop, NONE', () => {
  assert.deepEqual(G.parseReader('  France.\nbecause it says so'), { phrase: 'France' });
  assert.deepEqual(G.parseReader('"the Duchy of Normandy"'), { phrase: 'the Duchy of Normandy' });
  assert.deepEqual(G.parseReader("'Rollo'"), { phrase: 'Rollo' });
  assert.deepEqual(G.parseReader('U.S..'), { phrase: 'U.S.' });
  assert.deepEqual(G.parseReader('NONE'), { none: true });
  assert.deepEqual(G.parseReader('None of the above'), { none: true });
  assert.deepEqual(G.parseReader('Nonesuch'), { phrase: 'Nonesuch' });
  assert.deepEqual(G.parseReader(''), { none: true });
  assert.deepEqual(G.parseReader('"."'), { none: true });
  assert.deepEqual(G.parseReader(null), { none: true });
  assert.deepEqual(G.parseReader('"x'), { phrase: '"x' }, 'one quote is not a pair');
  assert.deepEqual(G.parseReader('"'), { phrase: '"' }, 'a lone quote is not stripped');
  assert.deepEqual(G.parseReader('"ab"'), { phrase: 'ab' });
  assert.deepEqual(G.parseReader('""'), { none: true }, 'a pair of empty quotes is no answer');
});

test('findSpan: case and whitespace insensitive, returns the passage’s own characters', () => {
  const p = 'The Normans were in\n  Normandy, a region in France.';
  const s = G.findSpan(p, 'in normandy');
  assert.deepEqual(s, { start: 17, end: 30, text: 'in\n  Normandy' });
  assert.equal(G.findSpan(p, 'Germany'), null);
  assert.equal(G.findSpan(p, '   '), null);
  assert.equal(G.findSpan(null, 'x'), null);
  assert.deepEqual(G.findSpan('abc', 'ABC'), { start: 0, end: 3, text: 'abc' });
  assert.deepEqual(G.findSpan('  lead', 'lead'), { start: 2, end: 6, text: 'lead' });
  assert.deepEqual(G.findSpan('x  y', 'x y'), { start: 0, end: 4, text: 'x  y' });
  assert.deepEqual(G.findSpan('end.', '.'), { start: 3, end: 4, text: '.' });
});

test('sentenceAround: the sentence holding the span', () => {
  const p = 'First one. The Normans came. Last one!';
  const at = p.indexOf('Normans');
  assert.deepEqual(G.sentenceAround(p, at, at + 7), { start: 11, end: 28, text: 'The Normans came.' });
  assert.equal(G.sentenceAround(p, -1, 2), null);
  assert.equal(G.sentenceAround(p, 3, 2), null);
  assert.equal(G.sentenceAround(p, 0, p.length + 1), null);
  assert.equal(G.sentenceAround(p, NaN, 2), null);
  assert.equal(G.sentenceAround(p, 0, 5).text, 'First one.');
  assert.equal(G.sentenceAround(p, 30, 33).text, 'Last one!');
  assert.equal(G.sentenceAround(p, 2, 2).text, 'First one.', 'an empty span at a valid place still finds its sentence');
  assert.equal(G.sentenceAround('ab', 0, 2).text, 'ab', 'a span reaching the end is allowed');
  assert.deepEqual(G.sentenceAround('ab cd', 0, 1), { start: 0, end: 5, text: 'ab cd' }, 'no full stop: the sentence runs to the end, not past it');
});

const C = { id: 'p1', text: 'Rollo founded the Duchy of Normandy in 911.', score: 0.8, weakest: 0.6, weakestToken: '##dy', reader: '911' };
test('decide: each check refuses with its own reason, in order', () => {
  assert.equal(G.decide(null, {}).check, 1);
  assert.equal(G.decide({ text: 'x' }, {}).check, 1);
  assert.equal(G.decide(C, { bar: 0.81 }).check, 2);
  assert.equal(G.decide(C, { bar: 0.81 }).why, 'no source clears the grounding bar');
  assert.equal(G.decide({ ...C, score: NaN }, { bar: 0 }).check, 2);
  assert.equal(G.decide(C, { bar: 0.8, evidence: 0.61 }).check, 3);
  assert.equal(G.decide(C, { evidence: 0.61 }).why, "the best source does not support 'dy'");
  assert.equal(G.decide({ ...C, weakest: undefined }, { evidence: 0 }).check, 3);
  assert.equal(G.decide({ ...C, reader: 'NONE' }, { useReader: true }).check, 4);
  assert.equal(G.decide({ ...C, reader: 'in 912' }, { useReader: true }).check, 5);
  assert.equal(G.decide({ ...C, weakestToken: null }, { evidence: 0.9 }).why, "the best source does not support ''");
});

test('decide: passing checks answer; the bar and evidence are inclusive; the span is the source text', () => {
  assert.deepEqual(G.decide(C, { bar: 0.8, evidence: 0.6 }), { answer: 'p1' });
  assert.deepEqual(G.decide(C, {}), { answer: 'p1' });
  assert.deepEqual(G.decide(C, null), { answer: 'p1' });
  const r = G.decide(C, { bar: 0.8, evidence: 0.6, useReader: true });
  assert.equal(r.answer, 'p1');
  assert.deepEqual(r.span, { start: 39, end: 42, text: '911' });
  assert.equal(r.sentence.text, 'Rollo founded the Duchy of Normandy in 911.');
  assert.deepEqual(G.decide(C, { useReader: 'yes' }), { answer: 'p1' }, 'only useReader === true turns the reader on');
});

const A = { id: 'A', title: 'Scott Derrickson', text: 'Scott Derrickson is an American director. He was born in 1966.' };
const B = { id: 'B', title: 'Ed Wood', text: 'Edward Wood was an American filmmaker. He made cult films.' };
test('decideTwo: the answer must be in a source or be yes/no; both sources are cited by sentence', () => {
  assert.equal(G.decideTwo(null, 'q').check, 1);
  assert.equal(G.decideTwo({ a: A }, 'q').check, 1);
  assert.equal(G.decideTwo({ a: A, b: B, reader: 'NONE' }, 'q').check, 4);
  assert.equal(G.decideTwo({ a: A, b: B, reader: 'Canadian' }, 'q').check, 5);
  const yes = G.decideTwo({ a: A, b: B, reader: 'Yes' }, 'Were Scott Derrickson and Ed Wood of the same nationality?');
  assert.equal(yes.answer, 'yes'); assert.equal(yes.verdict, true); assert.equal(yes.spanIn, null);
  assert.equal(yes.cites[0].text, 'Scott Derrickson is an American director.');
  assert.equal(yes.cites[1].text, 'Edward Wood was an American filmmaker.');
  const inB = G.decideTwo({ a: A, b: B, reader: 'cult films' }, 'What did he make?');
  assert.equal(inB.answer, 'cult films'); assert.equal(inB.spanIn, 'b'); assert.equal(inB.verdict, false);
  assert.equal(inB.cites[1].text, 'He made cult films.');
  const inA = G.decideTwo({ a: A, b: B, reader: '1966' }, 'When was the director born?');
  assert.equal(inA.spanIn, 'a'); assert.equal(inA.cites[0].text, 'He was born in 1966.');
  const both = G.decideTwo({ a: A, b: B, reader: 'American' }, 'q');
  assert.equal(both.spanIn, 'a', 'found in both: the first source is the span');
  assert.equal(G.decideTwo({ a: A, b: B, reader: 'nope' }, 'q').check, 5, '"nope" is not a yes/no verdict');
});

test('bestSentence: most shared 3+ letter words, first wins ties, whole text when there is no sentence', () => {
  assert.equal(G.bestSentence('Alpha beta. Gamma delta. Gamma beta.', 'gamma beta').text, 'Gamma beta.');
  assert.equal(G.bestSentence('One two. Three four.', 'zzz').text, 'One two.');
  assert.deepEqual(G.bestSentence('', 'x'), { start: 0, end: 0, text: '' });
  assert.equal(G.bestSentence('Go to it. Go on.', 'go on').text, 'Go to it.', 'two-letter words do not count');
  assert.equal(G.bestSentence('Cat sat. Dog ran far. ', 'dog far').text, 'Dog ran far.');
  assert.equal(G.bestSentence('Cat sat. Dog ran far.', 'dog far').start, 8);
  assert.deepEqual(G.bestSentence('!   ', 'x'), { start: 0, end: 4, text: '!' }, 'a whitespace-only piece is not a sentence');
});

test('normalize / em / f1: SQuAD rules', () => {
  assert.equal(G.normalize('The  Duchy, of Normandy!'), 'duchy of normandy');
  assert.equal(G.normalize('An apple a day'), 'apple day');
  assert.equal(G.em('the Normans', ['Normans']), 1);
  assert.equal(G.em('Normans', ['Vikings']), 0);
  assert.equal(G.em('x', null), 0);
  assert.equal(G.f1('Duchy of Normandy', ['Normandy']), 0.5);
  assert.equal(G.f1('Normandy', ['Duchy of Normandy']), 0.5);
  assert.equal(G.f1('a b c', ['x y']), 0);
  assert.equal(G.f1('the', ['an']), 1, 'both empty after normalising is a match');
  assert.equal(G.f1('the', ['x']), 0);
  assert.equal(G.f1('x x', ['x']), 2 / 3, 'a repeated word is counted once against one gold use');
  assert.equal(G.f1('1966', ['1966', 'nope']), 1);
  assert.equal(G.f1('', ['x']), 0);
});
