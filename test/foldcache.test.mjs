// test/foldcache.test.mjs — the retrieval memo (G1, PREREG §8): the same question on the same index is computed once;
// a new index is never answered from the old one; the least recently used entry goes beyond capacity. Mutation gate
// for src/foldcache.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import FC from '../src/foldcache.mjs';

test('createMemo: the capacity is a whole number above 0, else 1,000', () => {
  assert.deepEqual(FC.createMemo(5), { capacity: 5, version: null, entries: new Map(), hits: 0, misses: 0, evicted: 0 });
  assert.equal(FC.createMemo(1).capacity, 1);
  for (const bad of [0, -1, 2.5, '5', null, undefined, NaN]) assert.equal(FC.createMemo(bad).capacity, 1000, String(bad));
});

test('questionKey / indexVersion: equal keys for the same words; the version is the exact set of passage versions', () => {
  assert.equal(FC.questionKey('  When was   the Duchy\tfounded? '), 'when was the duchy founded?');
  assert.equal(FC.questionKey(null), '');
  assert.equal(FC.indexVersion(['b', 'a', 'c']), '["a","b","c"]');
  assert.equal(FC.indexVersion(['a', 'b']), FC.indexVersion(['b', 'a']), 'the order of the ids does not matter');
  assert.notEqual(FC.indexVersion(['a', 'b']), FC.indexVersion(['a', 'b@v2']), 'one changed passage is a new version');
  assert.equal(FC.indexVersion(null), '[]');
  assert.equal(FC.indexVersion([1, 2]), '["1","2"]');
});

test('scored: the same question on the same index is computed once; a new index is computed again', () => {
  const m = FC.createMemo(10);
  let calls = 0;
  const f = () => { calls++; return { col: [['p', 0.9]] }; };
  const a = FC.scored(m, 'When was it founded?', 'v1', f);
  assert.deepEqual([a.hit, calls], [false, 1]);
  const b = FC.scored(m, 'when was it  FOUNDED?', 'v1', f);
  assert.deepEqual([b.hit, calls], [true, 1], 'the same words: answered from the memo');
  assert.equal(b.value, a.value, 'the kept value itself');
  const c = FC.scored(m, 'When was it founded?', 'v2', f);
  assert.deepEqual([c.hit, calls], [false, 2], 'a new index version is never answered from the old one');
  assert.notEqual(c.value, a.value);
  assert.equal(FC.lookup(m, 'When was it founded?', 'v1'), undefined, 'and the old entries are gone');
  assert.deepEqual([m.hits, m.misses, m.evicted, m.version, m.entries.size], [1, 2, 1, 'v2', 1]);
  const d = FC.scored(m, 'Other?', 'v2', () => undefined);
  assert.deepEqual([d.hit, d.value, m.entries.size], [false, undefined, 1], 'nothing computed, nothing kept');
  assert.deepEqual(FC.scored(m, 'x', 'v2', null), { value: undefined, hit: false });
});

test('put / lookup: beyond the capacity the least recently used goes; a hit counts as a use', () => {
  const m = FC.createMemo(2);
  assert.equal(FC.put(m, 'a', 'v', 1), 0);
  assert.equal(FC.put(m, 'b', 'v', 2), 0);
  assert.equal(m.entries.size, 2, 'exactly at the capacity nothing goes');
  assert.equal(FC.lookup(m, 'a', 'v'), 1, 'a is now the most recently used');
  assert.equal(FC.put(m, 'c', 'v', 3), 1, 'so b goes');
  assert.deepEqual([...m.entries.keys()], ['a', 'c']);
  assert.equal(FC.lookup(m, 'b', 'v'), undefined);
  FC.put(m, 'a', 'v', 4);
  assert.deepEqual([...m.entries.entries()], [['c', 3], ['a', 4]], 'keeping a again replaces it and makes it the most recent');
  assert.equal(FC.put(m, 'd', 'w', 5), 2, 'a new version drops both old entries');
  assert.deepEqual([...m.entries.keys()], ['d']);
  assert.equal(m.evicted, 3);
  assert.equal(FC.lookup(m, 'd', 'v'), undefined, 'an older version is never answered');
  assert.equal(FC.lookup(m, 'zz', 'w'), undefined);
});

test('garbage never throws and is never answered from', () => {
  const circular = {}; circular.self = circular;
  for (const x of [null, undefined, NaN, '', 'memo', [], {}, { entries: {} }, true, 0, 10n, () => {}, circular]) {
    assert.equal(FC.lookup(x, 'q', 'v'), undefined);
    assert.equal(FC.put(x, 'q', 'v', 1), 0);
    assert.deepEqual(FC.scored(x, 'q', 'v', () => 7), { value: 7, hit: false }, 'without a usable memo it simply computes');
  }
  assert.doesNotThrow(() => { FC.questionKey({ toString() { throw new Error('no'); } }); FC.indexVersion('abc'); });
});
