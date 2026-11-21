import test from 'node:test';
import assert from 'node:assert/strict';
import M from '../src/memory.mjs';
import G from '../src/gate.mjs';

const P1 = 'The Normans were the people who in the 10th and 11th centuries gave their name to Normandy, a region in France. ' +
  'They were descended from Norse raiders and pirates from Denmark, Iceland and Norway who, under their leader Rollo, ' +
  'agreed to swear fealty to King Charles III of West Francia. The Duchy of Normandy was founded in 911 by that treaty.';
const P2 = P1.replace('founded in 911', 'founded in 914');
const OTHER = 'Oxygen is a chemical element with symbol O and atomic number 8, a highly reactive nonmetal.';

test('shingles / jaccard', () => {
  assert.deepEqual([...M.shingles('a b c', 2)], ['a b', 'b c']);
  assert.deepEqual([...M.shingles('a b', 5)], ['a b'], 'shorter than k: the whole text is one shingle');
  assert.deepEqual([...M.shingles('a b c d e', 5)], ['a b c d e']);
  assert.equal(M.shingles('', 5).size, 0);
  assert.equal(M.shingles('a b c d e f', 0).size, 2, 'a bad k falls back to 5');
  assert.equal(M.jaccard(new Set(['x']), new Set(['x'])), 1);
  assert.equal(M.jaccard(new Set(), new Set()), 0);
  assert.equal(M.jaccard(new Set(['x', 'y']), new Set(['y', 'z'])), 1 / 3);
  assert.equal(M.jaccard(null, new Set(['a'])), 0);
  assert.ok(M.jaccard(M.shingles(P1, 5), M.shingles(P2, 5)) >= M.NEAR_DUPLICATE);
  assert.ok(M.jaccard(M.shingles(P1, 5), M.shingles(OTHER, 5)) < M.NEAR_DUPLICATE);
});

test('ingest by sourceId: the old version is closed, never removed; reads are as of a date', () => {
  const s = M.createStore();
  assert.deepEqual(M.ingest(s, { id: 'n@1', sourceId: 'n', text: P1, validFrom: '2020-01-01' }), { sourceId: 'n', superseded: null, matchedBy: 'sourceId' });
  const r = M.ingest(s, { id: 'n@2', sourceId: 'n', text: P2, validFrom: '2026-06-01' });
  assert.deepEqual(r, { sourceId: 'n', superseded: 'n@1', matchedBy: 'sourceId' });
  assert.equal(s.versions.length, 2);
  assert.equal(s.versions[0].validTo, '2026-06-01');
  assert.equal(M.current(s, 'n', '2026-11-18').id, 'n@2');
  assert.equal(M.current(s, 'n', '2021-01-01').id, 'n@1');
  assert.equal(M.current(s, 'n', '2026-06-01').id, 'n@2', 'the new version starts ON its date');
  assert.equal(M.current(s, 'n', '2026-05-31').id, 'n@1');
  assert.equal(M.current(s, 'n', '2019-12-31'), null);
  assert.equal(M.current(s, 'n', 'not a date'), null);
  assert.deepEqual(M.validAt(s, '2026-11-18').map((v) => v.id), ['n@2']);
  assert.deepEqual(M.validAt(s, '2020-01-01').map((v) => v.id), ['n@1']);
  assert.deepEqual(M.history(s, 'n').map((v) => v.id), ['n@1', 'n@2']);
  assert.equal(s.versions[1].supersedes, 'n@1');
});

test('ingest without a sourceId: a near-duplicate of a current version is a new version of it; anything else is new', () => {
  const s = M.createStore();
  M.ingest(s, { id: 'a', text: P1, validFrom: '2020-01-01' });
  M.ingest(s, { id: 'o', text: OTHER, validFrom: '2020-01-01' });
  const r = M.ingest(s, { id: 'b', text: P2, validFrom: '2026-06-01' });
  assert.deepEqual(r, { sourceId: 'a', superseded: 'a', matchedBy: 'near-duplicate' });
  assert.equal(M.current(s, 'a', '2026-07-01').id, 'b');
  const n = M.ingest(s, { id: 'c', text: 'Something else entirely about the moon and tides.', validFrom: '2026-06-01' });
  assert.deepEqual(n, { sourceId: 'c', superseded: null, matchedBy: 'new' });
  const again = M.ingest(s, { id: 'd', text: P1, validFrom: '2026-07-01' });
  assert.equal(again.sourceId, 'a', 'matched against the CURRENT version b, not the closed one');
  assert.deepEqual(M.ingest(s, { id: 'x', text: 'x', validFrom: 'nope' }).matchedBy, 'invalid');
  assert.deepEqual(M.ingest(null, null).matchedBy, 'invalid');
  assert.deepEqual(M.ingest(s, { text: 'x', validFrom: '2020-01-01' }).matchedBy, 'invalid');
});

test('ingest: the near-duplicate line is inclusive; partial overlap is a new source; ties go to the first match', () => {
  const A8 = 'w1 w2 w3 w4 w5 w6 w7 w8';
  assert.equal(M.jaccard(M.shingles(A8, 5), M.shingles('w1 w2 w3 w4 w5 w6 w7 x8', 5)), 0.6);
  const s = M.createStore();
  M.ingest(s, { id: 'a', text: A8, validFrom: '2020-01-01' });
  assert.equal(M.ingest(s, { id: 'b', text: 'w1 w2 w3 w4 w5 w6 w7 x8', validFrom: '2021-01-01' }).matchedBy, 'near-duplicate', 'exactly 0.6 counts');
  assert.equal(M.ingest(s, { id: 'c', text: 'w1 w2 w3 w4 w5 y6 y7 y8', validFrom: '2022-01-01' }).matchedBy, 'new', 'one shared shingle is not a duplicate');
  const t = M.createStore();
  M.ingest(t, { id: 'first', sourceId: 'first', text: A8, validFrom: '2020-01-01' });
  M.ingest(t, { id: 'second', sourceId: 'second', text: A8, validFrom: '2020-01-01' });
  assert.equal(M.ingest(t, { id: 'z', text: A8, validFrom: '2021-01-01' }).sourceId, 'first', 'equal similarity: the first current version');
  assert.equal(M.shingles('a b c d e f', 5).size, 2);
  assert.equal(M.shingles('a b c d e', 5).size, 1, 'exactly k words: one shingle');
});

test('current / validAt: the end date is exclusive; equal start dates keep the first', () => {
  const s = { versions: [
    { id: 'x', sourceId: 's', text: '', validFrom: '2020-01-01', validTo: '2026-06-01' },
    { id: 'y', sourceId: 't', text: '', validFrom: '2020-01-01', validTo: null },
    { id: 'z', sourceId: 't', text: '', validFrom: '2020-01-01', validTo: null },
  ] };
  assert.equal(M.current(s, 's', '2026-06-01'), null, 'valid up to, not on, its end date');
  assert.equal(M.current(s, 's', '2026-05-31').id, 'x');
  assert.equal(M.current(s, 't', '2021-01-01').id, 'y');
  assert.deepEqual(M.validAt(s, '2026-06-01').map((v) => v.id), ['y', 'z']);
  assert.deepEqual(M.validAt(s, '2026-05-31').map((v) => v.id), ['x', 'y', 'z']);
  const n = M.createStore();
  M.ingest(n, { id: 'n@1', sourceId: 'n', text: P1, validFrom: '2020-01-01' });
  M.ingest(n, { id: 'n@2', sourceId: 'n', text: P2, validFrom: '2026-06-01' });
  assert.deepEqual(M.validAt(n, '2026-06-01').map((v) => v.id), ['n@2'], 'on the change date only the new version is valid');
});

test('guards: a missing store, document or answer never throws', () => {
  assert.equal(M.ingest(null, { id: 'a', text: 'x', validFrom: '2020-01-01' }).matchedBy, 'invalid');
  assert.equal(M.ingest(M.createStore(), null).matchedBy, 'invalid');
  assert.equal(M.remember(M.createStore(), null), null);
  assert.equal(M.remember(null, { qid: 'q', sourceId: 'n', span: 'x', at: '2026-01-01' }), null);
  const s = M.createStore();
  const f = M.remember(s, { qid: 'q', sourceId: 'n', span: 'x', at: '2026-01-01T00:00:00Z' });
  M.remember(s, { qid: 'r', sourceId: 'n', span: 'x', at: '2026-01-01' });
  assert.equal(f.lastUsed, '2026-01-01T00:00:00Z', 'the same day written another way does not replace it');
});

test('ingest: re-ingesting the same id does not close itself; history sorts by date', () => {
  const s = M.createStore();
  M.ingest(s, { id: 'v', sourceId: 's', text: P1, validFrom: '2020-01-01' });
  M.ingest(s, { id: 'v', sourceId: 's', text: P1, validFrom: '2021-01-01' });
  assert.equal(s.versions[0].validTo, null);
  const h = M.createStore();
  M.ingest(h, { id: 'late', sourceId: 'z', text: 'b', validFrom: '2025-01-01' });
  M.ingest(h, { id: 'early', sourceId: 'z', text: 'a', validFrom: '2020-01-01' });
  assert.deepEqual(M.history(h, 'z').map((v) => v.id), ['early', 'late']);
  assert.equal(M.current(h, 'z', '2026-01-01').id, 'late', 'the latest valid version wins when two overlap');
});

test('remember: one fact per (source, span), provenance grows, uses count, the latest use is kept', () => {
  const s = M.createStore();
  const f = M.remember(s, { qid: 'q1', question: 'When?', sourceId: 'n', versionId: 'n@1', span: '911', at: '2026-01-01' });
  M.remember(s, { qid: 'q2', question: 'What year?', sourceId: 'n', versionId: 'n@1', span: '911', at: '2026-02-01' });
  M.remember(s, { qid: 'q2', question: 'What year?', sourceId: 'n', versionId: 'n@1', span: '911', at: '2026-01-15' });
  assert.equal(s.facts.length, 1);
  assert.equal(f.asked.length, 2); assert.equal(f.uses, 3); assert.equal(f.lastUsed, '2026-02-01');
  M.remember(s, { qid: 'q3', sourceId: 'n', span: 'Rollo', at: '2026-01-01' });
  assert.equal(s.facts.length, 2);
  assert.equal(M.remember(s, { qid: 'q', sourceId: 'n', span: '' }), null);
  assert.equal(M.remember(s, { qid: 'q', span: 'x' }), null);
  assert.equal(M.remember(null, {}), null);
  const g = M.remember(M.createStore(), { qid: 'q', sourceId: 'n', span: 'x', at: 'bad' });
  M.remember({ facts: [g] }, { qid: 'r', sourceId: 'n', span: 'x', at: '2026-01-01' });
  assert.equal(g.lastUsed, '2026-01-01', 'a valid date replaces an unreadable one');
});

test('reground: a stored answer is served only while it is still in the current version', () => {
  const s = M.createStore();
  M.ingest(s, { id: 'n@1', sourceId: 'n', text: P1, validFrom: '2020-01-01' });
  const f = M.remember(s, { qid: 'q', sourceId: 'n', versionId: 'n@1', span: '911', at: '2026-01-01' });
  assert.equal(M.reground(s, f, '2026-01-02', G.findSpan).ok, true);
  assert.equal(M.reground(s, f, '2026-01-02', G.findSpan).version, 'n@1');
  M.ingest(s, { id: 'n@2', sourceId: 'n', text: P2, validFrom: '2026-06-01' });
  const r = M.reground(s, f, '2026-07-01', G.findSpan);
  assert.deepEqual(r, { ok: false, why: 'the source changed: the stored answer is no longer in it' });
  assert.equal(M.reground(s, f, '2026-05-01', G.findSpan).ok, true, 'as of before the change it still holds');
  assert.equal(M.reground(s, null, '2026-01-01', G.findSpan).why, 'no stored answer');
  assert.equal(M.reground(s, { sourceId: 'gone', span: 'x' }, '2026-01-01', G.findSpan).why, 'the source is no longer valid');
  assert.equal(M.reground(s, f, '2026-01-02', null).ok, false, 'no span finder: never served');
});

test('refused / weight / metabolise: faded and stale answers pruned, versions kept', () => {
  const s = M.createStore();
  M.refused(s, { qid: 'q9', question: 'Who?', why: 'no source clears the grounding bar', at: '2026-01-01' });
  M.refused(null, {}); M.refused(s, null);
  assert.equal(s.gaps.length, 1);
  assert.equal(s.gaps[0].why, 'no source clears the grounding bar');
  M.ingest(s, { id: 'n@1', sourceId: 'n', text: P1, validFrom: '2020-01-01' });
  const fresh = M.remember(s, { qid: 'a', sourceId: 'n', span: 'Rollo', at: '2026-11-01' });
  const old = M.remember(s, { qid: 'b', sourceId: 'n', span: 'West Francia', at: '2025-01-01' });
  M.remember(s, { qid: 'c', sourceId: 'n', span: 'Charles III', at: '2026-11-01' });
  assert.equal(M.weight(fresh, '2026-11-01', 30), 1);
  assert.equal(M.weight(fresh, '2026-12-01', 30), 0.5);
  assert.equal(M.weight(fresh, '2026-10-01', 30), 1, 'a future use is not boosted above its uses');
  assert.equal(M.weight(fresh, 'bad', 30), 0);
  assert.equal(M.weight({ lastUsed: '2026-11-01' }, '2026-11-01', 30), 0);
  assert.equal(M.weight(fresh, '2026-12-01', 0), 0.5, 'a bad half-life falls back to 30 days');
  assert.ok(M.weight(old, '2026-11-18', 30) < 0.05);
  M.ingest(s, { id: 'n@2', sourceId: 'n', text: P1.replace('Charles III', 'Louis IV'), validFrom: '2026-11-10' });
  const r = M.metabolise(s, '2026-11-18', { halfLifeDays: 30, minWeight: 0.05 }, G.findSpan);
  assert.equal(r.kept, 1);
  assert.deepEqual(r.pruned.map((x) => x.why).sort(), ['the source changed: the stored answer is no longer in it', 'unused: faded below the keep line']);
  assert.equal(s.facts[0].span, 'Rollo');
  assert.equal(s.versions.length, 2, 'versions are provenance: never pruned');
  const d = M.createStore(); M.ingest(d, { id: 'v', sourceId: 'v', text: 'abc', validFrom: '2020-01-01' });
  const f = M.remember(d, { qid: 'q', sourceId: 'v', span: 'abc', at: '2026-11-18' });
  f.uses = 0.05;
  assert.equal(M.metabolise(d, '2026-11-18', {}, G.findSpan).kept, 1, 'exactly at the default keep line is kept');
  assert.equal(M.metabolise(null, '2026-11-18', null, G.findSpan).kept, 0);
  const h = M.createStore(); M.ingest(h, { id: 'v', sourceId: 'v', text: 'abc', validFrom: '2020-01-01' });
  M.remember(h, { qid: 'q', sourceId: 'v', span: 'abc', at: '2026-11-18' });
  assert.equal(M.metabolise(h, '2026-11-18', { minWeight: 2 }, G.findSpan).kept, 0, 'the keep line is read from the options');
});

// ── C7b: kept work, re-checked for each new question ──
const AT = P1.indexOf('911');
const WORK = { qid: 'q1', question: 'When was the duchy founded?', sourceId: 'n', versionId: 'n@1', score: 0.95, weakest: 0.8, weakestToken: 'founded',
  raw: '911', span: { start: AT, end: AT + 3, text: '911' }, at: '2026-11-18' };
const GOOD = () => ({ score: 0.95, weakest: 0.8, weakestToken: 'founded' });
const BARS = { bar: 0.9, evidence: 0.7 };
const withP1 = () => { const s = M.createStore(); M.ingest(s, { id: 'n@1', sourceId: 'n', text: P1, validFrom: '2020-01-01' }); return s; };

test('keep: one record per question, its work copied; anything incomplete is refused', () => {
  const s = M.createStore();
  assert.deepEqual(s.work, [], 'a new store keeps no work');
  const r = M.keep(s, WORK);
  assert.deepEqual(r, WORK);
  assert.notEqual(r.span, WORK.span, 'the span is copied, not shared');
  assert.deepEqual(M.keep(s, { ...WORK, qid: 'q2', question: undefined, raw: 7 }).question, '');
  assert.equal(s.work[1].raw, '', 'a raw output that is not text is kept as empty text');
  assert.equal(s.work.length, 2);
  M.keep(s, { ...WORK, raw: 'in 911' });
  assert.deepEqual(s.work.map((x) => [x.qid, x.raw]), [['q1', 'in 911'], ['q2', '']], 'the first question kept again replaces its own record');
  M.keep(s, { ...WORK, qid: 'q2', raw: 'again' });
  assert.deepEqual(s.work.map((x) => [x.qid, x.raw]), [['q1', 'in 911'], ['q2', 'again']], 'so does the second');
  assert.equal(M.keep(null, WORK), null);
  assert.equal(M.keep(s, null), null);
  assert.equal(M.keep(s, { ...WORK, span: undefined }), null);
  assert.equal(M.keep(s, { ...WORK, sourceId: undefined }), null);
  assert.equal(M.keep(s, { ...WORK, qid: null }), null);
  assert.equal(M.keep(s, { ...WORK, span: { start: 3, end: 3, text: '' } }), null, 'an empty span is no answer');
  assert.equal(s.work.length, 2, 'nothing refused was added');
  const older = { versions: [] };
  M.keep(older, WORK);
  assert.equal(older.work.length, 1, 'a store made before work was kept gets a list');
});

test('nearest: the best-ranked remembered question that has kept work', () => {
  const s = M.createStore();
  M.keep(s, { ...WORK, qid: 'b' }); M.keep(s, { ...WORK, qid: 'c' });
  assert.deepEqual(M.nearest(s, [['a', 0.99], ['b', 0.9], ['c', 0.8]]), { work: s.work[0], score: 0.9 }, "'a' has no work, so 'b' is the nearest");
  assert.deepEqual(M.nearest(s, [['c', 0.7], ['b', 0.6]]), { work: s.work[1], score: 0.7 });
  assert.equal(M.nearest(s, [['a', 0.99]]), null);
  assert.equal(M.nearest(null, [['b', 1]]), null);
  assert.equal(M.nearest(s, null), null);
  assert.equal(M.nearest(s, ['b', 'junk']), null, 'malformed entries never match');
});

test('recheck: kept work is served to a new question only when the gate passes again for it, at the kept offsets', () => {
  const s = withP1();
  const w = M.keep(s, WORK);
  const seen = [];
  assert.deepEqual(M.recheck(s, w, '2026-01-01', (v) => { seen.push(v.id); return GOOD(); }, G.decide, BARS),
    { ok: true, answer: 'n', version: 'n@1', span: { start: AT, end: AT + 3, text: '911' } });
  assert.deepEqual(seen, ['n@1'], 'the new question is matched against the current version, and only that one passage');
  assert.deepEqual(M.recheck(s, w, '2026-01-01', () => ({ ...GOOD(), score: 0.89 }), G.decide, BARS), { ok: false, check: 2, why: 'no source clears the grounding bar' });
  assert.deepEqual(M.recheck(s, w, '2026-01-01', () => ({ ...GOOD(), weakest: 0.5, weakestToken: 'paris' }), G.decide, BARS),
    { ok: false, check: 3, why: "the best source does not support 'paris'" });
  const none = M.keep(s, { ...WORK, qid: 'q9', raw: 'NONE' });
  assert.equal(M.recheck(s, none, '2026-01-01', GOOD, G.decide, { ...BARS, useReader: false }).check, 4, 'the reader check is always on');
  M.ingest(s, { id: 'n@2', sourceId: 'n', text: P2, validFrom: '2026-06-01' });
  assert.deepEqual(M.recheck(s, w, '2026-07-01', GOOD, G.decide, BARS), { ok: false, check: 5, why: "the reader's phrase is not in the source" }, 'the source changed: caught');
  assert.equal(M.recheck(s, w, '2026-05-01', GOOD, G.decide, BARS).ok, true, 'as of before the change it still holds');
});

test('recheck: the same words at other offsets, or a kept span that does not add up, are never served', () => {
  const OFFSETS = { ok: false, check: 'offsets', why: 'the kept answer is not at its offsets in the current version' };
  const moved = M.createStore();
  M.ingest(moved, { id: 'm', sourceId: 'n', text: 'In 911 ' + P1, validFrom: '2020-01-01' });
  assert.deepEqual(M.recheck(moved, M.keep(moved, WORK), '2026-01-01', GOOD, G.decide, BARS), OFFSETS, 'the phrase is now found earlier: moved');
  const s = withP1();
  assert.deepEqual(M.recheck(s, M.keep(s, { ...WORK, span: { start: 0, end: AT + 3, text: '911' } }), '2026-01-01', GOOD, G.decide, BARS), OFFSETS, 'start does not match');
  assert.deepEqual(M.recheck(s, M.keep(s, { ...WORK, span: { start: AT, end: AT + 4, text: '911' } }), '2026-01-01', GOOD, G.decide, BARS), OFFSETS, 'end does not match');
  assert.deepEqual(M.recheck(s, M.keep(s, { ...WORK, span: { start: AT, end: AT + 3, text: '914' } }), '2026-01-01', GOOD, G.decide, BARS), OFFSETS, 'text does not match');
  assert.deepEqual(M.recheck(s, M.keep(s, WORK), '2026-01-01', GOOD, () => ({ answer: 'n' }), BARS), OFFSETS, 'a decision without a span is not served');
});

test('recheck / holds: nothing kept, no valid source or no way to check is never a serve, and garbage never throws', () => {
  const s = withP1();
  const w = M.keep(s, WORK);
  assert.deepEqual(M.recheck(s, null, '2026-01-01', GOOD, G.decide, BARS), { ok: false, check: null, why: 'nothing kept' });
  assert.deepEqual(M.recheck(s, { sourceId: 'n', raw: '911' }, '2026-01-01', GOOD, G.decide, BARS), { ok: false, check: null, why: 'nothing kept' }, 'work without a span');
  assert.deepEqual(M.recheck(s, { ...w, sourceId: 'gone' }, '2026-01-01', GOOD, G.decide, BARS), { ok: false, check: null, why: 'the source is no longer valid' });
  assert.equal(M.recheck(s, w, '2019-01-01', GOOD, G.decide, BARS).why, 'the source is no longer valid', 'before the source existed');
  const noWay = { ok: false, check: null, why: 'no way to re-check the new question' };
  assert.deepEqual(M.recheck(s, w, '2026-01-01', null, G.decide, BARS), noWay);
  assert.deepEqual(M.recheck(s, w, '2026-01-01', () => null, G.decide, BARS), noWay);
  assert.deepEqual(M.recheck(s, w, '2026-01-01', GOOD, null, BARS), noWay);
  assert.deepEqual(M.recheck(s, w, '2026-01-01', GOOD, () => null, BARS), { ok: false, check: null, why: 'the gate gave no decision' });
  assert.equal(M.holds(s, w, '2026-01-01'), true);
  M.ingest(s, { id: 'n@2', sourceId: 'n', text: P2, validFrom: '2026-06-01' });
  assert.equal(M.holds(s, w, '2026-07-01'), false, 'the source changed under it: stale');
  assert.equal(M.holds(s, w, '2026-05-01'), true);
  assert.equal(M.holds(s, null, '2026-01-01'), false);
  assert.equal(M.holds(s, { ...w, sourceId: 'gone' }, '2026-01-01'), false, 'no valid version: nothing holds');
  assert.equal(M.holds(s, { sourceId: 'n' }, '2026-05-01'), false, 'no span: nothing holds');
  const circular = {}; circular.self = circular;
  for (const x of [null, undefined, NaN, '', 'x', [], {}, true, 0, -1, 10n, () => {}, circular, { a: { b: null } }]) {
    assert.doesNotThrow(() => { M.keep(x, x); M.keep(s, x); M.nearest(x, x); M.nearest(s, [x]); M.recheck(x, x, x, x, x, x); M.recheck(s, x, '2026-01-01', GOOD, G.decide, BARS); M.holds(x, x, x); M.holds(s, x, '2026-01-01'); });
  }
});
