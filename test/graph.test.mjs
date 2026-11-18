import test from 'node:test';
import assert from 'node:assert/strict';
import G from '../src/graph.mjs';

const P = [
  { id: 'Scott Derrickson', title: 'Scott Derrickson', text: 'Scott Derrickson directed Sinister.' },
  { id: 'Ed Wood (film)', title: 'Ed Wood (film)', text: 'Ed Wood is a 1994 film about Ed Wood, made in Hollywood.' },
  { id: 'Hollywood', title: 'Hollywood', text: 'Hollywood is a district of Los Angeles.' },
  { id: 'Los Angeles', title: 'Los Angeles', text: 'Los Angeles is a city.' },
  { id: 'Sinister', title: 'Sinister', text: 'Sinister is a horror film.' },
];

test('words / entityName', () => {
  assert.deepEqual(G.words('Ed Wood, 1994!'), ['ed', 'wood', '1994']);
  assert.deepEqual(G.words(null), []);
  assert.equal(G.entityName('Ed Wood (film)'), 'Ed Wood');
  assert.equal(G.entityName('Ed Wood (film) '), 'Ed Wood');
  assert.equal(G.entityName('A (b) c'), 'A (b) c', 'only a TRAILING bracket is dropped');
  assert.equal(G.entityName(null), '');
});

test('mentions: whole-word title runs, never the paragraph itself, each once, in order', () => {
  const idx = G.indexTitles(P);
  assert.deepEqual(G.mentions(P[0].text, idx, P[0].id), ['Sinister']);
  assert.deepEqual(G.mentions(P[1].text, idx, P[1].id), ['Hollywood']);
  assert.deepEqual(G.mentions('Los', idx, null), [], 'a title cut short by the end of the text is no mention');
  assert.deepEqual(G.mentions('Los Gatos and Los Angeles', idx, null), ['Los Angeles']);
  assert.deepEqual(G.mentions('Sinisterly', idx, null), []);
  assert.deepEqual(G.mentions('Sinister, then Sinister again', idx, null), ['Sinister'], 'a second mention is not a second link');
  assert.deepEqual(G.mentions('Los Angeles', idx, null), ['Los Angeles'], 'a two-word title matched in full');
  assert.deepEqual(G.mentions('Los Angeles Hollywood', idx, 'Hollywood'), ['Los Angeles']);
  assert.deepEqual(G.mentions('x', null, null), []);
  assert.deepEqual(G.mentions('Sinister', { first: new Map() }, null), []);
  const one = G.indexTitles([{ id: 'X', title: '(only)', text: '' }, null, { id: null, title: 'Y' }, { id: 'Z', title: 'Zed', text: '' }]);
  assert.deepEqual([...one.first.keys()], ['zed'], 'titles with no words, nulls and missing ids are skipped');
});

test('build / linked', () => {
  const g = G.build(P);
  assert.equal(g.out.get('Scott Derrickson').has('Sinister'), true);
  assert.equal(G.linked(g, 'Sinister', 'Scott Derrickson'), true, 'either direction');
  assert.equal(G.linked(g, 'Scott Derrickson', 'Sinister'), true);
  assert.equal(G.linked(g, 'Sinister', 'Hollywood'), false);
  assert.equal(G.linked(g, 'nope', 'Hollywood'), false);
  assert.equal(G.linked(null, 'a', 'b'), false);
  assert.equal(G.build([null, { id: null }]).out.size, 0);
});

test('walk: follows a mention to the second source the plain top-2 misses', () => {
  const g = G.build(P);
  const score = { 'Scott Derrickson': 0.9, Sinister: 0.85, 'Ed Wood (film)': 0.5, Hollywood: 0.4, 'Los Angeles': 0.1 };
  const ranked = Object.entries(score).map(([id, s]) => ({ id, score: s })).sort((a, b) => b.score - a.score);
  const q = { text: 'Which city holds the district where the Ed Wood film was made?', ranked, score };
  const plain = G.walk(q, g, { hop1: 1, lambda: 0 });
  assert.deepEqual([plain.a, plain.b].sort(), ['Scott Derrickson', 'Sinister']);
  const w = G.walk(q, g, { hop1: 5, lambda: 0.5 });
  assert.deepEqual([w.a, w.b], ['Scott Derrickson', 'Sinister'], 'a linked pair with the best scores');
  assert.equal(w.linked, true);
  const s2 = { ...score, Sinister: 0, Hollywood: 0.45 };
  const r2 = Object.entries(s2).map(([id, s]) => ({ id, score: s })).sort((a, b) => b.score - a.score);
  const w2 = G.walk({ text: 'Where was the Ed Wood film made?', ranked: r2, score: new Map(Object.entries(s2)) }, g, { hop1: 2, lambda: 0.5 });
  assert.deepEqual([w2.a, w2.b], ['Ed Wood (film)', 'Hollywood']);
  assert.ok(Math.abs(w2.score - 1.45) < 1e-9);
});

test('walk: two names in the question count as linked; edge cases', () => {
  const g = G.build(P);
  const U = G.build([{ id: 'X', title: 'Xenon', text: 'a gas' }, { id: 'Y', title: 'Yorkshire', text: 'a county' }, { id: 'Z', title: 'Zurich', text: 'a city' }]);
  const us = { X: 0.6, Y: 0.5, Z: 0.4 };
  const ur = Object.entries(us).map(([id, s]) => ({ id, score: s })).sort((a, b) => b.score - a.score);
  const w = G.walk({ text: 'Is Yorkshire older than Zurich?', ranked: ur, score: us }, U, { hop1: 1, lambda: 0.3 });
  assert.deepEqual([w.a, w.b], ['Y', 'Z'], 'both named in the question: linked, so they beat the unlinked top pair');
  assert.equal(w.linked, true);
  assert.ok(Math.abs(w.score - 1.2) < 1e-9);
  const flat = G.walk({ text: 'Is Yorkshire older than Zurich?', ranked: ur, score: us }, U, { hop1: 1, lambda: 0.05 });
  assert.deepEqual([flat.a, flat.b], ['X', 'Y'], 'a small lambda leaves the top pair in front');
  assert.equal(G.walk({ text: '', ranked: [], score: {} }, g, {}), null);
  assert.equal(G.walk(null, null, null), null);
  const one = G.walk({ text: 'x', ranked: [{ id: 'Sinister', score: 1 }], score: { Sinister: 1 } }, g, {});
  assert.equal(one, null, 'a lone paragraph with no mention is no pair');
  const tie = G.walk({ text: 'x', ranked: [{ id: 'b', score: 1 }, { id: 'a', score: 1 }, { id: 'c', score: 1 }], score: { a: 1, b: 1, c: 1 } }, { out: new Map([['b', new Set(['c'])]]), index: null }, { hop1: 3 });
  assert.deepEqual([tie.a, tie.b], ['b', 'a'], 'equal pair scores: the pair whose sorted ids come first (a,b) wins');
  assert.equal(tie.candidates, 2);
  const two = G.walk({ text: '', ranked: [{ id: 'a', score: 1 }, { id: 'b', score: 0.5 }], score: { a: 1, b: 0.5 } }, { out: new Map(), index: null }, {});
  assert.deepEqual([two.a, two.b, two.candidates], ['a', 'b', 1], 'exactly two ranked: the plain pair is a candidate');
  const noScore = G.walk({ text: 'x', ranked: [{ id: 'a', score: 1 }, { id: 'b', score: 1 }], score: { a: 1 } }, { out: new Map(), index: null }, {});
  assert.equal(noScore, null, 'a pair with an unscored side is skipped');
});

test('walk: ties go to the smaller id pair; the default hop-1 is 5', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  const score = Object.fromEntries(ids.map((id) => [id, 0]));
  score.a = 1; score.b = 0.5; score.c = 0.5;
  const ranked = ids.map((id) => ({ id, score: score[id] })).sort((x, y) => y.score - x.score || (x.id < y.id ? -1 : 1));
  const out = new Map([['a', new Set(['c'])], ['f', new Set(['g'])]]);
  const w = G.walk({ text: '', ranked, score }, { out, index: null }, { lambda: 0 });
  assert.deepEqual([w.a, w.b], ['a', 'b'], 'equal score: the pair key a,b sorts before a,c');
  score.g = 0.3; score.f = 0.3;
  const r2 = ids.map((id) => ({ id, score: score[id] })).sort((x, y) => y.score - x.score || (x.id < y.id ? -1 : 1));
  const w2 = G.walk({ text: '', ranked: r2, score }, { out, index: null }, { lambda: 1 });
  assert.deepEqual([w2.a, w2.b], ['a', 'c'], 'f is outside the default top 5, so its link is not followed');
  const w3 = G.walk({ text: '', ranked: r2, score }, { out, index: null }, { hop1: 7, lambda: 2 });
  assert.deepEqual([w3.a, w3.b], ['a', 'c']);
  const w4 = G.walk({ text: '', ranked: r2, score }, { out, index: null }, { hop1: 0, lambda: 1 });
  assert.deepEqual([w4.a, w4.b], ['a', 'c'], 'a hop-1 of 0 falls back to 5');
});

test('themes: titles by size with their distinctive words', () => {
  const t = G.themes([
    { title: 'Oxygen', text: 'oxygen element gas breathing' }, { title: 'Oxygen', text: 'oxygen element ozone' },
    { title: 'Normans', text: 'normans duchy element' }, null,
  ], 2);
  assert.equal(t[0].title, 'Oxygen'); assert.equal(t[0].paragraphs, 2);
  assert.deepEqual(t[0].words, ['oxygen', 'element']);
  assert.deepEqual(t[1].words, ['duchy', 'normans']);
  assert.equal(G.themes([], 3).length, 0);
  const d = G.themes([{ title: 'B', text: 'abcd' }, { title: 'A', text: 'efgh' }]);
  assert.deepEqual(d.map((x) => x.title), ['A', 'B'], 'equal size: by title');
  assert.equal(G.themes([{ title: 'A', text: 'one two three four five six seven eight' }]).at(0).words.length, 5, 'default top 5');
  assert.deepEqual(G.themes([{ title: 'A', text: 'zzzz aaaa' }], 9)[0].words, ['aaaa', 'zzzz'], 'equal weight: alphabetical');
  const long = { title: 'A', text: 'one1 two2 thr3 fou4 fiv5 six6 sev7 eig8' };
  assert.equal(G.themes([long], 0)[0].words.length, 5, 'topN 0 falls back to 5');
  assert.equal(G.themes([long], -1)[0].words.length, 5, 'a negative topN falls back to 5');
  // a word in every paragraph of A but also in B and C, against a word in half of A's paragraphs and nowhere else:
  // with four themes the shared word still leads (ln(1+4/3)=0.847 vs 0.5 ln 5=0.805); the count of themes matters
  const four = G.themes([
    { title: 'A', text: 'pppp qqqq' }, { title: 'A', text: 'pppp' }, { title: 'B', text: 'pppp' }, { title: 'C', text: 'pppp' }, { title: 'D', text: 'rrrr' },
  ], 2);
  assert.deepEqual(four[0], { title: 'A', paragraphs: 2, words: ['pppp', 'qqqq'] });
});
