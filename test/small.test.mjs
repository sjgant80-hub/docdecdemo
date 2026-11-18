import test from 'node:test';
import assert from 'node:assert/strict';
import S from '../src/stats.mjs';
import H from '../src/hyper.mjs';
import C from '../src/conduct.mjs';

test('lnChoose', () => {
  assert.ok(Math.abs(S.lnChoose(5, 2) - Math.log(10)) < 1e-12);
  assert.ok(Math.abs(S.lnChoose(5, 3) - Math.log(10)) < 1e-12);
  assert.equal(S.lnChoose(5, 0), 0);
  assert.equal(S.lnChoose(5, 5), 0);
  assert.equal(S.lnChoose(5, 6), -Infinity);
  assert.equal(S.lnChoose(5, -1), -Infinity);
  assert.equal(S.lnChoose(5.5, 1), -Infinity);
  assert.ok(Math.abs(S.lnChoose(1000, 500) - 689.4672) < 1e-3);
});

test('mcnemar: exact two-sided p', () => {
  assert.equal(S.mcnemar(0, 0), 1);
  assert.equal(S.mcnemar(5, 5), 1, 'capped at 1');
  assert.ok(Math.abs(S.mcnemar(0, 6) - 2 / 64) < 1e-12);
  assert.ok(Math.abs(S.mcnemar(6, 0) - 2 / 64) < 1e-12);
  assert.ok(Math.abs(S.mcnemar(1, 9) - 2 * 11 / 1024) < 1e-12);
  assert.ok(Math.abs(S.mcnemar(2, 10) - 0.0385742) < 1e-6);
  assert.equal(S.mcnemar(-3, 4), S.mcnemar(0, 4), 'negative counts read as 0');
  assert.equal(S.mcnemar(1.5, 4), S.mcnemar(0, 4));
  assert.equal(S.mcnemar(4, 1.5), S.mcnemar(4, 0));
  assert.equal(S.mcnemar(4, -2), S.mcnemar(4, 0));
});

test('paired / beats', () => {
  const t = S.paired([1, 1, 1, 0, 1, 1, 1, 1], [0, 0, 0, 0, 1, 0, 0, 0]);
  assert.deepEqual({ ...t, p: undefined }, { n: 8, a: 7, b: 1, aOnly: 6, bOnly: 0, p: undefined });
  assert.ok(Math.abs(t.p - 2 / 64) < 1e-12);
  assert.equal(S.beats([1, 1, 1, 0, 1, 1, 1, 1], [0, 0, 0, 0, 1, 0, 0, 0]), true);
  assert.equal(S.beats([0, 0, 0, 0, 1, 0, 0, 0], [1, 1, 1, 0, 1, 1, 1, 1]), false, 'significant but the wrong way');
  assert.equal(S.beats([1, 1, 0], [0, 0, 0]), false, 'right way but not significant');
  assert.equal(S.beats([1, 1, 1, 1, 1, 1], [0, 0, 0, 0, 0, 0], 0.01), false, 'p = 0.03125 is not below 0.01');
  assert.equal(S.beats([1, 1, 1, 1, 1, 1], [0, 0, 0, 0, 0, 0], 'x'), true, 'a bad alpha falls back to 0.05');
  assert.equal(S.beats([1, 1, 1, 1, 1, 1], [0, 0, 0, 0, 0, 0], S.mcnemar(6, 0)), false, 'p equal to alpha is not below it');
  assert.equal(S.beats([1, 0], [0, 1], 2), false, 'a tie never beats, even with a loose alpha');
  assert.equal(S.paired([1, true, 0], [0, 0, 1, 1]).n, 3);
  assert.equal(S.paired(null, null).p, 1);
  const eq = S.paired([1, 0], [1, 0]);
  assert.equal(eq.aOnly + eq.bOnly, 0);
});

test('median', () => {
  assert.equal(S.median([3, 1, 2]), 2);
  assert.equal(S.median([4, 1, 3, 2]), 2.5);
  assert.equal(S.median([]), null);
  assert.equal(S.median([NaN, 5]), 5);
  assert.equal(S.median(null), null);
});

test('hyper: radius grows with depth inside the ball; Poincaré distance; fusion', () => {
  assert.equal(H.radius(0), 0);
  assert.ok(Math.abs(H.radius(1) - Math.tanh(0.5)) < 1e-12);
  assert.ok(H.radius(H.DEPTH.article) < H.radius(H.DEPTH.paragraph) && H.radius(H.DEPTH.paragraph) < H.radius(H.DEPTH.sentence));
  assert.ok(H.radius(H.DEPTH.sentence) < 1);
  assert.equal(H.radius(-2), 0); assert.equal(H.radius('x'), 0);
  const b = H.toBall([3, 4], 2);
  assert.ok(Math.abs(Math.hypot(b[0], b[1]) - H.radius(2)) < 1e-12);
  assert.ok(Math.abs(b[0] / b[1] - 0.75) < 1e-12);
  assert.deepEqual([...H.toBall([0, 0], 2)], [0, 0]);
  assert.equal(H.toBall(null, 1).length, 0);
  assert.equal(H.poincare([0, 0], [0, 0]), 0);
  const r = 0.5;
  assert.ok(Math.abs(H.poincare([0, 0], [r, 0]) - 2 * Math.atanh(r)) < 1e-12, 'distance from the centre is 2·artanh(r)');
  assert.ok(Math.abs(H.poincare([0.3, 0], [-0.4, 0.1]) - H.poincare([-0.4, 0.1], [0.3, 0])) < 1e-12);
  assert.equal(H.poincare([1, 0], [0, 0]), Infinity, 'on the boundary: infinitely far');
  assert.equal(H.poincare(null, [0.1]), 0);
  assert.ok(H.poincare([0.9, 0], [0.85, 0.05]) < H.poincare([0.9, 0], [0, 0.9]), 'deep neighbours are near, deep strangers far');
  assert.deepEqual(H.rrf([['a', 'b', 'c'], ['b', 'a', 'c']], 60), ['a', 'b', 'c']);
  assert.deepEqual(H.rrf([['x', 'y'], ['y']], 60), ['y', 'x']);
  assert.deepEqual(H.rrf([['b'], ['a']], 0), ['a', 'b'], 'a bad k falls back to 60; ties by id');
  assert.deepEqual(H.rrf(null), []);
  const s = H.rrf([['p', 'q']], 1);
  assert.deepEqual(s, ['p', 'q']);
  // one rank-1 vote against three rank-5 votes: k decides it (k=60 → the repeated one; tiny k → the rank-1 one)
  const L3 = [['a', 'p', 'q', 'r', 'b'], ['s', 't', 'u', 'v', 'b'], ['w', 'x', 'y', 'z', 'b']];
  assert.equal(H.rrf(L3, 60)[0], 'b');
  assert.equal(H.rrf(L3)[0], 'b', 'default k is 60');
  assert.equal(H.rrf(L3, 2)[0], 'b', 'k=2: 3/7 beats 1/3');
  assert.equal(H.rrf(L3, 0.1)[0], 'a', 'k=0.1: 1/1.1 beats 3/5.1');
  assert.equal(H.rrf(L3, -0.5)[0], 'b', 'a negative k falls back to 60');
  assert.equal(H.rrf(L3, 0)[0], 'b', 'k 0 falls back to 60');
  assert.equal(H.rrf(L3, NaN)[0], 'b');
  assert.equal(H.radius(NaN), 0);
  assert.equal(H.poincare([1, 0], [1, 0]), Infinity, 'two boundary points: never NaN');
  assert.equal(H.poincare([0.1], null), 0);
});

test('conduct: compositional vs lookup, the fast shortlist, the plan', () => {
  assert.equal(C.classify('Were Scott Derrickson and Ed Wood of the same nationality?').route, 'compositional');
  assert.equal(C.classify('Which band was formed first, Hole or The Strokes?').route, 'compositional');
  assert.equal(C.classify('What government position was held by the woman who portrayed Corliss Archer in the film Kiss and Tell?').route, 'compositional');
  assert.equal(C.classify('The director of the film that won Best Picture was born where?').why, 'a fact hangs off another fact');
  assert.equal(C.classify('In what country is Normandy located?').route, 'lookup');
  assert.equal(C.classify('Who was the duke in the battle of Hastings?').route, 'lookup');
  assert.equal(C.classify('Which gas is more reactive?').route, 'lookup', 'a comparison word without two names is one fact');
  assert.equal(C.classify('').why, 'empty');
  assert.equal(C.classify(null).route, 'lookup');
  assert.equal(C.classify('Who was born first?').route, 'lookup');
  assert.deepEqual(C.shortlist([{ id: 'a', score: 0.1 }, { id: 'b', score: 0.9 }, { id: 'c', score: 0.9 }, { id: 'd', score: NaN }, null], 2), ['b', 'c']);
  assert.equal(C.shortlist(Array.from({ length: 30 }, (_, i) => ({ id: 'x' + i, score: i }))).length, 20, 'default 20');
  assert.equal(C.shortlist(Array.from({ length: 30 }, (_, i) => ({ id: 'x' + i, score: i })), 0).length, 20, 'k 0 falls back to 20');
  assert.equal(C.shortlist(Array.from({ length: 30 }, (_, i) => ({ id: 'x' + i, score: i })), -1).length, 20, 'a negative k falls back to 20');
  assert.deepEqual(C.shortlist([{ id: 'b', score: 1 }, { id: 'a', score: 1 }, { id: 'c', score: 2 }], 3), ['c', 'a', 'b'], 'equal scores by id');
  assert.deepEqual(C.shortlist(null, 3), []);
  assert.deepEqual(C.plan('In what country is Normandy located?').steps, ['cosine shortlist', 'late-interaction re-rank', 'as-of filter', 'verifier gate']);
  assert.ok(C.plan('Were Scott Derrickson and Ed Wood of the same nationality?').steps.includes('graph walk'));
});
