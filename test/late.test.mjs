import test from 'node:test';
import assert from 'node:assert/strict';
import L from '../src/late.mjs';

const F = (rows) => Float32Array.from(rows.flat());

test('isContent: specials, punctuation and stopwords are not content; words, numbers and ## pieces are', () => {
  for (const t of ['[CLS]', '[SEP]', '[MASK]', '[PAD]', '[unused0]', '[unused1]', '[UNK]', '?', '.', '##', '', 'the', 'of', 'What', '##s', 's', 't']) assert.equal(L.isContent(t), false, t);
  for (const t of ['normans', 'Normandy', '911', '##ans', 'x9', 'oxygen']) assert.equal(L.isContent(t), true, t);
  assert.equal(L.isContent(null), false);
  assert.equal(L.isContent(42), false);
});

test('fromInt8: divides by 127 and drops a ragged tail', () => {
  const v = L.fromInt8(Int8Array.from([127, -127, 0, 64, 5]), 2);
  assert.equal(v.length, 4);
  assert.equal(v[0], 1); assert.equal(v[1], -1); assert.equal(v[2], 0);
  assert.ok(Math.abs(v[3] - 64 / 127) < 1e-7);
  assert.equal(L.fromInt8([1, 2, 3], 3).length, 3);
  assert.equal(L.fromInt8([1, 2, 3], 4).length, 0);
  assert.equal(L.fromInt8(null, 2).length, 0);
  assert.equal(L.fromInt8([127, 127], 0).length, 2, 'a bad dim falls back to 1');
  assert.equal(L.fromInt8(['x', 127], 1)[0], 0, 'non-numbers read as 0');
});

test('b64ToInt8: round-trips signed bytes and survives garbage', () => {
  const bytes = Int8Array.from([0, 1, -1, 127, -128, 64, -64]);
  const b64 = Buffer.from(bytes.buffer).toString('base64');
  assert.deepEqual([...L.b64ToInt8(b64)], [...bytes]);
  assert.equal(L.b64ToInt8('%%%not base64').length, 0);
  assert.equal(L.b64ToInt8(null).length, 0);
  const edge = L.b64ToInt8(Buffer.from([127, 128, 255]).toString('base64'));
  assert.deepEqual([...edge], [127, -128, -1]);
});

test('maxsim: each question row takes its best passage row; the score is the mean of those bests', () => {
  const Q = F([[1, 0], [0, 1]]);
  const D = F([[0.6, 0.8], [1, 0], [0, -1]]);
  const m = L.maxsim(Q, D, 2);
  assert.equal(m.best[0], 1); assert.equal(m.sims[0], 1);
  assert.equal(m.best[1], 0); assert.ok(Math.abs(m.sims[1] - 0.8) < 1e-6);
  assert.ok(Math.abs(m.score - 0.9) < 1e-6);
});

test('maxsim: first best wins a tie; an empty passage scores 0 with no match', () => {
  const m = L.maxsim(F([[1, 0]]), F([[1, 0], [1, 0]]), 2);
  assert.equal(m.best[0], 0);
  const e = L.maxsim(F([[1, 0]]), new Float32Array(0), 2);
  assert.equal(e.score, 0); assert.equal(e.best[0], -1); assert.equal(e.sims[0], 0);
  const z = L.maxsim(new Float32Array(0), F([[1, 0]]), 2);
  assert.equal(z.score, 0); assert.equal(z.sims.length, 0);
  const neg = L.maxsim(F([[1, 0]]), F([[-1, 0]]), 2);
  assert.equal(neg.sims[0], -1, 'a negative best is kept, not floored');
  assert.equal(L.maxsim(null, null, 0).score, 0);
});

test('evidence: only content tokens are audited and the weakest is named', () => {
  const qTokens = ['[CLS]', '[unused0]', 'when', 'normans', 'founded', '?', '[SEP]', '[MASK]'];
  const sims = Float32Array.from([0.9, 0.9, 0.2, 0.95, 0.41, 0.1, 0.9, 0.05]);
  const best = Int32Array.from([0, 0, 0, 1, 2, 0, 0, 0]);
  const e = L.evidence(qTokens, sims, best, ['in', 'normandy', 'established']);
  assert.deepEqual(e.tokens.map((t) => t.token), ['normans', 'founded']);
  assert.equal(e.weakestToken, 'founded');
  assert.ok(Math.abs(e.weakest - 0.41) < 1e-6);
  assert.equal(e.tokens[0].matched, 'normandy');
  assert.equal(e.tokens[1].matched, 'established');
  assert.equal(e.tokens[1].at, 2);
});

test('evidence: equal sims keep the first as weakest; out-of-range matches read as null; nothing to audit is 0', () => {
  const e = L.evidence(['alpha', 'beta'], Float32Array.from([0.5, 0.5]), Int32Array.from([5, -1]), ['x']);
  assert.equal(e.weakestToken, 'alpha');
  assert.equal(e.tokens[0].matched, null); assert.equal(e.tokens[1].matched, null);
  const n = L.evidence(['the', '?'], Float32Array.from([1, 1]), Int32Array.from([0, 0]), ['x']);
  assert.equal(n.weakest, 0); assert.equal(n.weakestToken, null);
  const g = L.evidence(null, null, null, null);
  assert.equal(g.tokens.length, 0);
  const m = L.evidence(['alpha'], [NaN], [0], ['x']);
  assert.equal(m.weakest, 0, 'a non-finite sim reads as 0');
  const k = L.evidence(['alpha'], [0.7], [0.5], ['x']);
  assert.equal(k.tokens[0].matched, null, 'a non-integer match index is no match');
  const last = L.evidence(['alpha'], [0.7], [0], ['only']);
  assert.equal(last.tokens[0].matched, 'only', 'index 0 of a one-token passage is a match');
  const past = L.evidence(['alpha'], [0.7], [1], ['only']);
  assert.equal(past.tokens[0].matched, null, 'an index equal to the passage length is no match');
});

test('rank: equal ids keep their input order; ids compare as strings', () => {
  const r = L.rank([{ id: 'a', score: 1, tag: 1 }, { id: 'a', score: 1, tag: 2 }, { id: 'a', score: 1, tag: 3 }]);
  assert.deepEqual(r.map((x) => x.tag), [1, 2, 3]);
  assert.deepEqual(L.rank([{ id: 10, score: 0 }, { id: 9, score: 0 }]).map((x) => x.id), [10, 9], '"10" sorts before "9"');
  assert.deepEqual([...L.byIdOrder([{ id: 'b' }, { id: 'a' }, { id: 'b' }, null])], [['a', 0], ['b', 1], ['null', 2]]);
});

test('rank: best first, non-finite scores last, ties by id', () => {
  const r = L.rank([{ id: 'b', score: 1 }, { id: 'a', score: 1 }, { id: 'c', score: NaN }, { id: 'd', score: 2 }, null, 3]);
  assert.deepEqual(r.map((x) => x.id), ['d', 'a', 'b', 'c']);
  assert.equal(r[3].score, -Infinity);
  assert.deepEqual(L.rank([{ id: 'a', score: 1 }, { id: 'a', score: 1 }]).map((x) => x.id), ['a', 'a']);
  assert.deepEqual(L.rank(null), []);
  assert.deepEqual(L.rank([{ id: 'z', score: 0 }, { id: 'y', score: 0 }]).map((x) => x.id), ['y', 'z']);
});

test('cosine: matches the v1 definition, zero-safe', () => {
  assert.ok(Math.abs(L.cosine([1, 0], [1, 1]) - Math.SQRT1_2) < 1e-12);
  assert.equal(L.cosine([0, 0], [1, 1]), 0);
  assert.equal(L.cosine([], []), 0);
  assert.equal(L.cosine(null, [1]), 0);
  assert.equal(L.cosine([1], null), 0);
  assert.ok(Math.abs(L.cosine([1, 2, 3], [1, 2]) - L.cosine([1, 2], [1, 2])) < 1e-12, 'extra dims are ignored');
  assert.equal(L.cosine([3, 4], [3, 4]), 1);
  assert.equal(L.cosine([1, 0], [-1, 0]), -1);
});
