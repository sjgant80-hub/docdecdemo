// test/mini.test.mjs — the measurement, assembly, publishing and example rules on a HAND-BUILT miniature corpus whose
// results are worked out by hand below. Every token vector is a basis vector (token id t → 127 at position t), so a
// late-interaction score is simply (question tokens with an exact match in the passage) / (question tokens), and every
// threshold the search picks can be checked on paper. Mutation gate for src/measure.mjs, assemble.mjs, publish.mjs,
// examples.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { assemble, b64ToInt16, scoreSet, matchOne, scorer } from '../src/assemble.mjs';
import { measure, metrics, search, matched, spans, rowsFor, decideRow, replay } from '../src/measure.mjs';
import { pick } from '../src/examples.mjs';
import { publishable, compareRecords } from '../src/publish.mjs';
import * as MS from '../src/measure.mjs';
import * as EX from '../src/examples.mjs';

const col = (pairs) => { const v = new Int8Array(pairs.length * 96); pairs.forEach(([, t], i) => { v[i * 96 + t] = 127; }); return { tokens: pairs.map(([w]) => w), v: Buffer.from(v.buffer).toString('base64') }; };
const nom = (v) => { const b = Buffer.from(Int16Array.from(v.map((x) => Math.round(x * 1000))).buffer).toString('base64'); return { N: b, P: b }; };
const W = { rollo: 1, founded: 2, normandy: 3, n911: 4, rouen: 5, capital: 6, normans: 7, spoke: 8, french: 9, fought: 10, hastings: 11, n1066: 12, oxygen: 13, element: 14, eight: 15, priestley: 16, found: 17, n1774: 18, latin: 19, n1777: 20 };
const T = (...ws) => ws.map((w) => [w.replace(/^n(\d)/, '$1'), typeof W[w] === 'number' ? W[w] : Number(w.slice(1))]);

const A0 = 'Rollo founded Normandy in 911 under a treaty. Rouen became its capital soon after, and the duchy grew strong along the river with many towns and farms and churches built over the next century by its people.';
const A1 = 'The Normans fought at Hastings in 1066 and won a famous battle against the English king, and over the following years they built castles and churches across the land, and in daily life they spoke French';
const B0 = 'Oxygen is element eight on the periodic table and makes up much of the air we breathe, it is very reactive and forms oxides with most elements, and the chemist Priestley found it in 1774';
const paragraphs = [{ id: 'A#0', title: 'A', text: A0 }, { id: 'A#1', title: 'A', text: A1 }, { id: 'B#0', title: 'B', text: B0 }];
const docs = { 'A#0': col(T('rollo', 'founded', 'normandy', 'n911', 'rouen', 'capital')), 'A#1': col(T('normans', 'fought', 'hastings', 'n1066', 'spoke', 'french')), 'B#0': col(T('oxygen', 'element', 'eight', 'priestley', 'found', 'n1774')) };
const dn = { 'A#0': nom([1, 0, 0, 0]), 'A#1': nom([0, 1, 0, 0]), 'B#0': nom([0, 0, 1, 0]) };
// [qid, text, query tokens, gold, answers, cosine vector]; q0-q2 are the tune split (30% of 10), q3-q9 eval
const QS = [
  ['q0', 'Who founded Normandy?', T('founded', 'normandy'), 'A#0', ['Rollo'], [1, 0.2, 0, 0]],
  ['q1', 'When did the Normans found Paris?', T('normans', 'x40'), null, [], [0, 1, 0, 0.5]],
  ['q2', 'When was oxygen found?', T('oxygen', 'found'), 'B#0', ['1774'], [0, 0, 1, 0.3]],
  ['q3', 'Where did the Normans fight?', T('normans', 'fought'), 'A#1', ['Hastings'], [0.9, 1, 0, 0]],
  ['q4', 'What did the Normans speak?', T('normans', 'spoke'), 'A#1', ['French'], [1, 0.8, 0, 0]],
  ['q5', 'What was Rouen?', T('rouen', 'capital'), 'A#0', ['its capital'], [1, 0, 0, 0.2]],
  ['q6', 'Who founded oxygen?', T('founded', 'oxygen'), null, [], [0.5, 0, 0.8, 0]],
  ['q7', 'When did Priestley fight?', T('priestley', 'fought'), null, [], [0, 0.3, 0.9, 0.1]],
  ['q8', 'When was the element Priestley found named?', T('priestley', 'element', 'found', 'x99'), 'B#0', ['1774'], [0.7, 0, 0.6, 0]],
  ['q9', 'How many Normans spoke?', T('normans', 'spoke', 'x41'), null, [], [0, 1, 0, 0.1]],
];
const questions = QS.map(([qid, text, , goldId, answers]) => ({ qid, text, goldId, impossible: goldId === null, answers }));
const oos = Array.from({ length: 10 }, (_, i) => ({ qid: 'oos:' + i, text: 'Off topic question number ' + i }));
const s1 = { paragraphs, questions, oos,
  col: { docs, q: Object.fromEntries(QS.map(([qid, , t]) => [qid, col(t)])), oos: Object.fromEntries(oos.map((q, i) => [q.qid, col(i === 3 ? T('oxygen', 'x52') : T('x50', 'x51'))])) },
  nomic: { docs: dn, q: Object.fromEntries(QS.map(([qid, , , , , v]) => [qid, nom(v)])), oos: Object.fromEntries(oos.map((q) => [q.qid, nom([0.1, 0.1, 0.1, 1])])) } };
const one = { 'q0|A#0': 'Rollo', 'q1|A#1': 'NONE', 'q2|B#0': '1774', 'q3|A#1': 'at Hastings', 'q4|A#1': 'French', 'q5|A#0': 'the capital of Normandy', 'q6|A#0': 'Rollo', 'q7|A#1': '1066', 'q8|B#0': 'in 1774', 'q9|A#1': 'NONE',
  'q4|A#0': 'Rollo', 'q6|B#0': '1774', 'q7|B#0': '1774', 'q8|A#0': 'NONE', 'q4|A#1@v1': 'French', 'q4|A#1@v2': 'Latin', 'q2|B#0@v1': '1774', 'q2|B#0@v2': '1777', 'q6|A#0@v2': 'Hrolf',
  'para:q3|A#1': 'Hastings', 'para:q4|A#1': 'NONE', 'para:q5|A#0': 'NONE', 'para:q6|A#0': 'Rollo', 'para:q7|A#1': 'NONE', 'para:q8|B#0': '1774', 'para:q9|A#1': 'NONE' };
for (const q of oos) one[q.qid + '|A#0'] = 'NONE', one[q.qid + '|B#0'] = 'NONE';
// S4: A#0's first word Rollo → Hrolf (and its new version also matches q6 better, so even the flat index reads it),
// A#1's last word French → Latin, B#0's last word 1774 → 1777, each in a later version
const s4 = { items: [
  { qid: 'q6', text: 'Who founded oxygen?', sourceId: 'A#0', oldAnswer: 'Rollo', newAnswer: 'Hrolf', v1: { id: 'A#0@v1', text: A0, validFrom: '2020-01-01' }, v2: { id: 'A#0@v2', text: A0.replace(/^Rollo/, 'Hrolf'), validFrom: '2026-06-01' } },
  { qid: 'q4', text: 'What did the Normans speak?', sourceId: 'A#1', oldAnswer: 'French', newAnswer: 'Latin', v1: { id: 'A#1@v1', text: A1, validFrom: '2020-01-01' }, v2: { id: 'A#1@v2', text: A1.replace(/French$/, 'Latin'), validFrom: '2026-06-01' } },
  { qid: 'q2', text: 'When was oxygen found?', sourceId: 'B#0', oldAnswer: '1774', newAnswer: '1777', v1: { id: 'B#0@v1', text: B0, validFrom: '2020-01-01' }, v2: { id: 'B#0@v2', text: B0.replace(/1774$/, '1777'), validFrom: '2026-06-01' } }],
  col: { 'A#0@v2': col(T('x21', 'founded', 'oxygen', 'n911', 'rouen', 'capital')), 'A#1@v2': col(T('normans', 'fought', 'hastings', 'n1066', 'spoke', 'latin')), 'B#0@v2': col(T('oxygen', 'element', 'eight', 'priestley', 'found', 'n1777')) },
  nomic: { 'A#0@v2': nom([1, 0, 0, 0]), 'A#1@v2': nom([0, 1, 0, 0]), 'B#0@v2': nom([0, 0, 1, 0]) } };
// S5: each question asked again in other words
const PARA = { q0: T('founded', 'normandy'), q1: T('founded', 'x61', 'x62'), q2: T('oxygen', 'found'), q3: T('normans', 'fought'), q4: T('normans', 'spoke'), q5: T('rouen', 'x64'),
  q6: T('founded', 'oxygen'), q7: T('priestley', 'fought'), q8: T('priestley', 'element', 'found', 'x99'), q9: T('normans', 'spoke', 'x63') };
const s5 = { paraphrases: Object.fromEntries(questions.map((q) => [q.qid, 'In other words: ' + q.text])),
  col: { para: Object.fromEntries(Object.entries(PARA).map(([k, t]) => ['para:' + k, col(t)])), orig: Object.fromEntries(QS.map(([qid, , t]) => [qid, col(t)])) } };
// S3: five paragraphs, ten two-fact questions (h0-h2 tune), scores given directly as the shipped tables are
const H = [{ id: 'Scott Derrickson', title: 'Scott Derrickson', text: 'Scott Derrickson is an American director who made Sinister.' },
  { id: 'Sinister', title: 'Sinister', text: 'Sinister is a 2012 horror film set in Hollywood.' }, { id: 'Ed Wood', title: 'Ed Wood', text: 'Ed Wood was an American filmmaker.' },
  { id: 'Hollywood', title: 'Hollywood', text: 'Hollywood is a district of Los Angeles.' }, { id: 'Tim Burton', title: 'Tim Burton', text: 'Tim Burton directed Ed Wood.' }];
const SD = 'Scott Derrickson', SN = 'Sinister', EW = 'Ed Wood', HW = 'Hollywood', TB = 'Tim Burton';
const HQ = [ // [qid, text, type, gold, answer, col scores, cos scores]
  ['h0', 'Where is the film made by Scott Derrickson set?', 'bridge', [SD, SN], 'Hollywood', { [SD]: 0.9, [HW]: 0.6, [SN]: 0.5, [EW]: 0.2, [TB]: 0.1 }, { [SD]: 0.8, [HW]: 0.7, [SN]: 0.3, [EW]: 0.2, [TB]: 0.1 }],
  ['h1', 'Are Scott Derrickson and Ed Wood both American?', 'comparison', [SD, EW], 'yes', { [SD]: 0.9, [TB]: 0.7, [EW]: 0.6, [SN]: 0.3, [HW]: 0.1 }, { [SD]: 0.9, [EW]: 0.8, [TB]: 0.3, [SN]: 0.2, [HW]: 0.1 }],
  ['h2', 'Who directed the film about Ed Wood?', 'bridge', [TB, EW], 'Tim Burton', { [TB]: 0.8, [EW]: 0.7, [SD]: 0.6, [SN]: 0.2, [HW]: 0.1 }, { [SD]: 0.9, [EW]: 0.5, [TB]: 0.4, [SN]: 0.2, [HW]: 0.1 }],
  ['h3', 'Where is the horror film set?', 'bridge', [SN, HW], 'Hollywood', { [SN]: 0.8, [SD]: 0.7, [HW]: 0.6, [EW]: 0.1, [TB]: 0.05 }, { [SN]: 0.9, [SD]: 0.8, [HW]: 0.3, [EW]: 0.2, [TB]: 0.1 }],
  ['h4', 'Where is the film Scott Derrickson made set?', 'bridge', [SD, SN], 'Hollywood', { [SD]: 0.9, [HW]: 0.7, [SN]: 0.6, [EW]: 0.1, [TB]: 0.05 }, { [SD]: 0.9, [HW]: 0.8, [SN]: 0.3, [EW]: 0.2, [TB]: 0.1 }],
  ['h5', 'Who directed the Ed Wood film?', 'bridge', [TB, EW], 'Tim Burton', { [TB]: 0.9, [EW]: 0.8, [SD]: 0.3, [SN]: 0.1, [HW]: 0.05 }, { [TB]: 0.9, [EW]: 0.85, [SD]: 0.3, [SN]: 0.2, [HW]: 0.1 }],
  ['h6', 'Are Tim Burton and Scott Derrickson both directors?', 'comparison', [TB, SD], 'yes', { [SD]: 0.8, [SN]: 0.75, [TB]: 0.6, [EW]: 0.1, [HW]: 0.05 }, { [SD]: 0.9, [TB]: 0.8, [SN]: 0.3, [EW]: 0.2, [HW]: 0.1 }],
  ['h7', 'Were Scott Derrickson and Ed Wood of the same nationality?', 'comparison', [SD, EW], 'yes', { [SD]: 0.8, [HW]: 0.75, [EW]: 0.7, [SN]: 0.1, [TB]: 0.05 }, { [SD]: 0.8, [HW]: 0.7, [EW]: 0.3, [SN]: 0.2, [TB]: 0.1 }],
  ['h8', 'Which city holds the district the horror film is set in?', 'bridge', [SN, HW], 'Los Angeles', { [HW]: 0.8, [EW]: 0.75, [SN]: 0.7, [SD]: 0.1, [TB]: 0.05 }, { [HW]: 0.9, [EW]: 0.8, [SN]: 0.3, [SD]: 0.2, [TB]: 0.1 }],
  ['h9', 'Who made the film about the American filmmaker?', 'bridge', [TB, EW], 'Ed Wood', { [EW]: 0.9, [SD]: 0.85, [TB]: 0.5, [SN]: 0.1, [HW]: 0.05 }, { [EW]: 0.9, [TB]: 0.8, [SD]: 0.3, [SN]: 0.2, [HW]: 0.1 }],
];
const list = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]);
const s3 = { paragraphs: H, questions: HQ.map(([qid, text, type, gold, answer]) => ({ qid, text, type, gold, answer, level: 'hard' })),
  scores: Object.fromEntries(HQ.map(([qid, , , , , c, k]) => [qid, { col: list(c), cosN: list(k), cosP: list(k), named: [], colOf: c }])) };
const twoRaw = { h3: ['Hollywood', 'Hollywood'], h4: ['NONE', 'Sinister'], h5: ['Tim Burton', 'Tim Burton'], h6: ['yes', 'no'], h7: ['Hollywood', 'yes'], h8: ['Los Angeles', 'Los Angeles'], h9: ['Ed Wood', 'Ed Wood'] };
const two = {};
const walkPairs = { h3: [SN, SD], h4: [SD, SN], h5: [TB, EW], h6: [SD, SN], h7: [SD, EW], h8: [SN, HW], h9: [EW, SD] };
for (const [qid, [cosRaw, walkRaw]] of Object.entries(twoRaw)) {
  const k = list(HQ.find((h) => h[0] === qid)[6]);
  two[qid + '|' + k[0][0] + '|' + k[1][0]] = cosRaw;
  const [a, b] = walkPairs[qid]; two[qid + '|' + a + '|' + b] = walkRaw; two[qid + '|' + b + '|' + a] = walkRaw;
}
const h1 = { nodes: [
  { id: 'article:A', depth: 1, paragraph: null, text: 'A. Rollo founded Normandy in 911 under a treaty.', ...nom([0.7, 0.7, 0, 0]) },
  { id: 'article:B', depth: 1, paragraph: null, text: 'B. Oxygen is element eight.', ...nom([0, 0, 1, 0.2]) },
  { id: 'A#0', depth: 2, paragraph: 'A#0', text: A0, ...nom([1, 0, 0, 0]) }, { id: 'A#1', depth: 2, paragraph: 'A#1', text: A1, ...nom([0, 1, 0, 0]) }, { id: 'B#0', depth: 2, paragraph: 'B#0', text: B0, ...nom([0, 0, 1, 0]) },
  { id: 'A#1/s0', depth: 3, paragraph: 'A#1', text: 'The Normans fought at Hastings in 1066', ...nom([0.6, 1, 0, 0]) },
  { id: 'B#0/s0', depth: 3, paragraph: 'B#0', text: 'the chemist Priestley found it in 1774', ...nom([0.6, 0, 0.7, 0]) }] };
const v1 = { gate: { minScore: 1 }, per: [0, 1, 1, 1, 0, 0, 1], recall: 0.25, refusal: 1, qids: questions.slice(3).map((q) => q.qid) };
const reader = { model: 'mini', options: {}, one, two };
// S2: the S1 tables as the shipped 9x table holds them (top lists + every ColBERT score)
const s1s = scoreSet(questions, paragraphs, s1.col.q, s1.col.docs, s1.nomic.q, s1.nomic.docs);
const s2 = { paragraphs, scores: Object.fromEntries(Object.entries(s1s).map(([k, v]) => [k, { ...v, colOf: Object.fromEntries(v.col) }])) };
const F = { s1, s2, s3, s4, s5, h1, reader, v1 };
const A = assemble(F);
const R = measure(A.D);

test('assemble: int16 vectors, scores from basis vectors are exact-match fractions', () => {
  assert.deepEqual(b64ToInt16(nom([0.9, -1, 0, 32.767]).N), [0.9, -1, 0, 32.767]);
  assert.deepEqual(b64ToInt16(Buffer.from([0xff, 0x7f, 0x00, 0x80]).toString('base64')), [32.767, -32.768]);
  assert.deepEqual(b64ToInt16('%%%'), []);
  assert.deepEqual(b64ToInt16(null), []);
  assert.deepEqual(A.s1Scores.q8.col[0], ['B#0', 0.75]);
  assert.deepEqual(A.s1Scores.q9.col[0], ['A#1', 0.666667]);
  assert.deepEqual(A.s1Scores.q6.col.slice(0, 2), [['A#0', 0.5], ['B#0', 0.5]], 'a tie goes to the smaller id');
  assert.deepEqual(A.s1Scores.q4.cosN[0][0], 'A#0', 'the pooled vector picks the wrong paragraph for q4');
  assert.deepEqual(A.s1Scores.q8.ev['B#0'], { weakest: 0, weakestToken: 'x99' });
  assert.deepEqual(A.s1Scores.q0.ev['A#0'], { weakest: 1, weakestToken: 'founded' });
  assert.equal(Object.keys(A.s1Scores.q0.ev).length, 3, 'evidence kept for the top three');
  assert.deepEqual(A.oosScores['oos:3'].col[0], ['B#0', 0.5]);
  assert.deepEqual(A.s4Scores.q4.col.slice(0, 2), [['A#1@v1', 1], ['A#1@v2', 1]], 'flat: both versions tie, the old id first');
  assert.deepEqual(A.qq.q1[0], ['q0', 0.333333]);
  assert.deepEqual(A.qq.q4.slice(0, 2), [['q4', 1], ['q9', 1]]);
  assert.equal(Object.keys(A.paraScores).length, 7, 'the cold path is scored for the eval paraphrases only');
  assert.deepEqual(A.paraScores.q8.col[0], ['B#0', 0.75]);
  assert.equal(A.D.h1.nodes[0].v.cosN.length, 4);
  const B = assemble({ ...F, s5: undefined, h1: undefined }, { s1Scores: A.s1Scores, oosScores: A.oosScores, s4Scores: A.s4Scores });
  assert.equal(B.D.s5, undefined); assert.equal(B.D.h1, undefined); assert.equal(B.qq, null); assert.equal(B.paraScores, null);
  assert.equal(B.s1Scores, A.s1Scores, 'shipped tables are used as given');
  assert.equal(assemble({ ...F, v1: undefined }, { s1Scores: A.s1Scores, oosScores: A.oosScores, s4Scores: A.s4Scores, qq: A.qq, paraScores: A.paraScores }).D.v1, null);
});

test('the baseline: cosine + a cut-off searched on tune (worked by hand)', () => {
  assert.equal(R.baselinePrefix.chosen, 'without task prefixes', 'a tie keeps no prefix');
  assert.deepEqual(R.chosen.B1, { t: 0.957826, e: null, reader: false }); // cos(q2, B#0) = 1/sqrt(1.09)
  assert.deepEqual(R.chosen.B0, { t: null, e: null, reader: false });
  const b = R.s1.B1; // eval q3..q9: answers only q5 (0.98) and q9 (0.995)
  assert.deepEqual([b.right, b.answeredAnswerable, b.refusedUnanswerable, b.answerable, b.unanswerable], [1, 1, 2, 4, 3]);
  assert.equal(b.accuracy, 0.4286); assert.equal(b.recall, 0.25); assert.equal(b.precision, 1); assert.equal(b.refusal, 0.6667);
  assert.deepEqual(R.s1.B0.spans, { answered: 0, em: null, f1: null, audited: 0, verbatim: 0, passageWords: null, sentenceWords: null });
});

test('DocDec v2: late interaction + evidence + reader, settings searched on tune (worked by hand)', () => {
  assert.deepEqual(R.chosen.L1, { t: 1, e: null, reader: false });
  assert.deepEqual(R.chosen.v2, { t: 1, e: 1, reader: true });
  const v = R.s1.v2; // right q3 q4; refused q5 (phrase not in source), q8 (0.75); refused every unanswerable
  assert.deepEqual([v.right, v.answeredAnswerable, v.refusedUnanswerable], [2, 2, 3]);
  assert.equal(v.accuracy, 0.7143); assert.equal(v.recall, 0.5); assert.equal(v.refusal, 1);
  assert.deepEqual(v.spans, { answered: 2, em: 0.5, f1: 0.8333, audited: 2, verbatim: 2, passageWords: 36, sentenceWords: 36 }); // 'at Hastings' scores EM 0, F1 2/3
  assert.equal(R.s1.L1.accuracy, 0.8571, 'L1 alone: only q8 (0.75) goes wrong');
  assert.deepEqual(R.s1['v2 matched'].setting, { t: 1, e: 1, reader: true });
  assert.equal(R.s1['L1+R'].spans.audited, 2, 'L1+R answers q3 and q4; q5 fails the span check');
});

test('claims on the miniature: C1 passes nowhere (too few questions), C2 is judged by McNemar', () => {
  const c1 = R.claims.C1.detail.s1;
  assert.deepEqual([c1.colbert, c1.cosine, c1.n], [1, 0.5, 4]);
  assert.deepEqual([c1.test.aOnly, c1.test.bOnly, c1.test.p], [2, 0, 0.5]);
  assert.equal(R.claims.C1.pass, false);
  const a = R.claims.C2.detail.a;
  assert.deepEqual([a.v2, a.baseline, a.test.aOnly, a.test.bOnly, a.test.p], [0.7143, 0.4286, 3, 1, 0.625]);
  assert.equal(R.claims.C2.pass, false);
  const b = R.claims.C2.detail.b;
  assert.deepEqual([b.v2Refusal, b.baselineRefusal, b.v2Recall, b.baselineRecall], [1, 0.6667, 0.5, 0.25]);
  assert.equal(b.pass, false, 'q9 alone is one discordant pair: p = 1');
  assert.equal(R.claims.C4.detail.v2, 0.7143, 'the 9x table here is the same table');
  assert.equal(R.claims.C4.pass, false);
  assert.deepEqual(R.offTopic.v2, { refused: 7, of: 7, refusal: 1 });
  assert.deepEqual(R.offTopic.B1, { refused: 7, of: 7, refusal: 1 });
  assert.deepEqual(R.v1.test, { n: 7, a: 4, b: 3, aOnly: 2, bOnly: 1, p: 1 });
  assert.equal(R.v1.accuracy, 0.5714);
});

test('multi-hop on the miniature: the walk’s bonus is chosen on tune (worked by hand)', () => {
  const s = R.s3;
  assert.equal(s.lambda, 0.105, 'the first bonus that makes h0 and h1 come out right');
  assert.deepEqual(s.pairExact, { graph: 0.5714, cosineTop2: 0.4286, colbertTop2: 0.1429 });
  assert.equal(R.claims.C3.detail.test.aOnly, 3); assert.equal(R.claims.C3.detail.test.bOnly, 2);
  assert.equal(R.claims.C3.pass, false);
  assert.equal(s.baselinePrefix, 'without task prefixes');
  assert.deepEqual([s.bridge.n, s.comparison.n], [5, 2]);
  assert.equal(s.edges, 3);
  assert.deepEqual(s.answers.graph, { n: 7, missing: 0, refused: 0, em: 0.7143, f1: 0.7143, audited: 14, verbatim: 14 });
  assert.equal(s.answers.cosineTop2.refused, 1); assert.equal(s.answers.cosineTop2.em, 0.7143); assert.equal(s.answers.cosineTop2.missing, 0);
  assert.equal(s.recallAt2.graph, 0.7857);
});

test('freshness on the miniature: versions recognised, the memory reads today’s, history kept', () => {
  const f = R.s4;
  assert.deepEqual(f.detection, { linkedToItsOwnOldVersion: 3, linkedWrong: 0, notLinked: 0, rule: '5-word shingle Jaccard >= 0.6, no source ids given' });
  assert.deepEqual(f.retrieval, { latestMemory: 3, latestFlat: 1, staleFlat: 2, historyAsOf2021: 3 });
  assert.deepEqual(f.answers, { memoryNewValue: 3, memoryOldValue: 0, flatNewValue: 1, flatOldValue: 2 });
  assert.deepEqual([R.claims.C5.detail.latestFlat, R.claims.C5.detail.history, R.claims.C5.detail.test.aOnly, R.claims.C5.detail.test.bOnly], [0.3333, 1, 2, 0]);
  assert.equal(R.claims.C5.pass, false, 'two questions are not enough for p < 0.05');
  assert.equal(R.claims.C5.detail.latestMemory, 1);
});

test('the memory on the miniature: served only above the tune bar, re-grounded, stale caught (worked by hand)', () => {
  const s = R.s5;
  assert.equal(s.threshold, 1, 'the 0.333 tune match would serve an unanswerable question');
  assert.deepEqual([s.remembered, s.refusedLogged, s.served, s.falseServes, s.staleServed, s.staleCaught, s.warmRight, s.coldRight], [4, 6, 2, 0, 0, 1, 5, 4]);
  assert.deepEqual(s.metabolismFourMonthsLater, { kept: 4, pruned: 0 });
  assert.deepEqual([s.answersGiven, s.askedOfRemembered], [4, 4], 'four answers, four facts: nothing to consolidate here');
  assert.deepEqual(R.globalView.refusedByCheck, { 1: 0, 2: 4, 3: 0, 4: 0, 5: 1 }, 'eval refusals: q6 q7 q8 q9 at the bar, q5 at the span check');
  assert.deepEqual(R.globalView.themes.map((t) => [t.title, t.paragraphs]), [['A', 2], ['B', 1]]);
  assert.equal(R.claims.C7.pass, true);
  assert.equal(R.claims.C7.detail.readerCallsSaved, 2);
  assert.equal(R.claims.C6.pass, true);
});

test('hyperbolic prototype and the conductor on the miniature', () => {
  assert.deepEqual(R.h1.nodes, { article: 2, paragraph: 3, sentence: 2 });
  assert.equal(R.h1.n, 4);
  assert.equal(typeof R.h1.reproduced, 'boolean');
  assert.ok(R.h1.rank1AnswerBearing.cosine >= 0 && R.h1.rank1AnswerBearing.cosine <= 1);
  assert.deepEqual(R.l5.routing, { lookupReadAsLookup: 1, compositionalReadAsCompositional: 0.2857, lookupN: 7, compositionalN: 7 });
  assert.deepEqual(R.l5.fastPath, { corpus: 'S2 (1,204 paragraphs)', fullColbertTop1: 1, shortlist20ThenColbert: 1, n: 4 });
});

test('examples are picked by their fixed rules', () => {
  const E = pick(F, A.D, R);
  assert.deepEqual(E.lateWins.map((x) => x.qid), ['q4', 'q8']);
  assert.deepEqual(E.lateLoses, []);
  assert.equal(E.lateWins[0].colbert.evidence.length, 2);
  assert.equal(E.offTopic.qid, 'oos:3');
  assert.deepEqual(E.nearMiss.map((x) => [x.qid, x.check]), [['q9', 2]]);
  assert.deepEqual([E.grounded.route, E.grounded.routeWhy], ['lookup', 'one fact']);
  assert.equal(E.grounded.qid, 'q4', "q3's answer 'at Hastings' is not an exact match, so the first exact one is q4"); assert.deepEqual(E.grounded.span.text, 'French');
  assert.equal(E.multiHop.qid, 'h7', 'h4 is a walk-only win but its composed answer is wrong, so the first one composed right is shown'); assert.equal(E.multiHop.composed.answer, 'yes'); assert.equal(E.multiHop.linked, false);
  assert.equal(E.fresh.qid, 'q4'); assert.equal(E.fresh.flatSaid, 'French'); assert.equal(E.fresh.memorySaid, 'Latin');
  assert.deepEqual(E.refusedAnswerable.map((x) => [x.qid, x.check]), [['q5', 5], ['q8', 2]]);
  assert.deepEqual(E.answeredUnanswerable, []);
});

test('the search primitives: replay equals the gate, ties go to the stricter setting', () => {
  const t1 = new Map(paragraphs.map((p) => [p.id, p.text]));
  const rows = rowsFor(questions.slice(0, 3), A.s1Scores, t1, (q, p) => one[q + '|' + p], 'col', 'cosN');
  const s = search(rows, { evidence: true, reader: true });
  assert.equal(s.tried, 16);
  for (const st of s.settings) for (const r of rows) { const a = replay(r, st), b = decideRow(r, st); assert.equal(a.refuse === true, b.refuse === true); }
  assert.equal(metrics(rows, { t: null, e: null, reader: false }).accuracy, 2 / 3);
  assert.equal(metrics([], { t: null }).accuracy, null);
  assert.equal(matched(rows, 2, { reader: true }), null, 'no setting reaches a recall above 1');
  const sp = spans(rows, { t: null, e: null, reader: true });
  assert.deepEqual([sp.answered, sp.audited, sp.em], [2, 2, 1]);
});

test('publishable / compareRecords', () => {
  const pub = publishable(R, { x: { per: [1] } }, { s: 1 });
  assert.equal(pub.complete, true);
  assert.equal(pub._evalQ, undefined); assert.equal(pub.needs, undefined); assert.equal(pub.hotPairs, undefined);
  assert.equal(pub.s1.v2.per, undefined, 'per-question arrays are not published');
  assert.deepEqual(pub.examples, { x: {} }); assert.deepEqual(pub.sources, { s: 1 });
  const inc = publishable({ ...R, needs: [['q', 'p']] }, {}, {});
  assert.equal(inc.complete, false);
  const miss = publishable({ ...R, s3: { ...R.s3, answers: { graph: { missing: 1 }, cosineTop2: { missing: 0 } } } }, {}, {});
  assert.equal(miss.complete, false);
  const miss2 = publishable({ ...R, s3: { ...R.s3, answers: { graph: { missing: 0 }, cosineTop2: { missing: 2 } } } }, {}, {});
  assert.equal(miss2.complete, false);
  assert.equal(publishable({ ...R, s3: { answers: null } }, {}, {}).complete, true);
  assert.deepEqual(compareRecords({ a: 1, b: { c: [1, 2] } }, { a: 1, b: { c: [1, 2] } }), { fields: 3, diffs: [] });
  assert.deepEqual(compareRecords({ a: 1, b: 2 }, { a: 1, b: 3, c: 4 }).diffs, ['b: 2 vs 3', 'c: undefined vs 4']);
  assert.deepEqual(compareRecords(null, null), { fields: 1, diffs: [] });
  assert.equal(publishable({ needs: [] }, {}, {}).complete, true, 'no multi-hop section: complete if nothing is missing');
  assert.deepEqual(compareRecords({ a: null }, { a: null }), { fields: 1, diffs: [] });
  assert.deepEqual(compareRecords({ a: 5 }, { a: 6 }).diffs, ['a: 5 vs 6']);
  assert.deepEqual(compareRecords({ a: { b: 1 } }, { a: 2 }).diffs, ['a: {"b":1} vs 2']);
  assert.deepEqual(compareRecords({ a: 2 }, { a: { b: 1 } }).diffs, ['a: 2 vs {"b":1}']);
});

test('hyperbolic on the miniature: the general article node wins cosine for q3 and q4 (a hub); radius by depth demotes it', () => {
  assert.deepEqual(R.h1.rank1AnswerBearing, { cosine: 0.5, hyperbolic: 0.75, fused: 0.75 });
  assert.deepEqual(R.h1.hubness, { cosine: 0.5, hyperbolic: 0.25, fused: 0.25 });
  assert.deepEqual(R.h1.test, { n: 4, a: 3, b: 2, aOnly: 1, bOnly: 0, p: 1 });
  assert.equal(R.h1.reproduced, false, 'four questions cannot reach p < 0.05');
});

test('pass rules at their exact boundaries', () => {
  assert.equal(MS.allTrue(true, true), true); assert.equal(MS.allTrue(true, false), false); assert.equal(MS.allTrue(false, true), false);
  assert.equal(MS.allTrue(), false, 'no parts is not a pass'); assert.equal(MS.allTrue(true, 1), false, 'only true counts');
  assert.equal(0.52 - 0.02, 0.5, 'the boundary below is exact in floating point');
  assert.equal(MS.passMatched(true, 0.5, 0.52), true, 'recall exactly 2 points lower still passes');
  assert.equal(MS.passMatched(true, 0.49, 0.52), false); assert.equal(MS.passMatched(false, 0.9, 0.5), false); assert.equal(MS.passMatched(1, 0.9, 0.5), false);
  assert.equal(MS.passFresh(0.95, 0.95, true), true, '95 in 100 exactly passes');
  assert.equal(MS.passFresh(0.94, 1, true), false); assert.equal(MS.passFresh(1, 0.94, true), false); assert.equal(MS.passFresh(1, 1, false), false); assert.equal(MS.passFresh(1, 1, 1), false);
  assert.equal(MS.passAudit(3, 3), true); assert.equal(MS.passAudit(0, 0), false, 'nothing audited is not a pass'); assert.equal(MS.passAudit(3, 2), false); assert.equal(MS.passAudit(1, 1), true);
  const ok = { bar: 0.9, warm: 0.5, cold: 0.5, falseServeRate: 0.01, served: 1, staleServed: 0 };
  assert.equal(MS.passCache(ok), true, 'equal accuracy and false serves exactly at the limit pass');
  for (const [k, v] of [['bar', null], ['warm', 0.49], ['falseServeRate', 0.0101], ['served', 0], ['staleServed', 1]]) assert.equal(MS.passCache({ ...ok, [k]: v }), false, k);
  assert.equal(MS.passCache({ ...ok, bar: 0 }), true, 'a bar of 0 is still a bar');
});

test('pickBar: the lowest score whose false-serve rate is at most the limit', () => {
  const hits = [{ impossible: true, score: 0.4 }, { impossible: false, score: 0.9 }, { impossible: false, score: null }, ...Array.from({ length: 99 }, () => ({ impossible: true, score: 0.1 }))];
  assert.equal(MS.pickBar(hits, 0.01), 0.4, 'at 0.4 one of 100 unanswerable questions is served: exactly the limit');
  assert.equal(MS.pickBar(hits, 0.009), 0.9);
  assert.equal(MS.pickBar([{ impossible: true, score: 0.5 }], 0.01), null, 'every bar serves the one unanswerable question');
  assert.equal(MS.pickBar([{ impossible: false, score: 0.7 }, { impossible: false, score: 0.6 }], 0), 0.6, 'with no unanswerable questions the lowest score qualifies');
  assert.equal(MS.pickBar([], 0.01), null);
  assert.equal(MS.pickBar([{ impossible: true, score: NaN }, { impossible: false, score: 0.3 }], 0), 0.3, 'a NaN score never counts as a serve');
});

test('servable / answerFlags / bearing / isArticle / firstIs / right / correct', () => {
  assert.equal(MS.servable({ score: 0.9 }, 0.9), true); assert.equal(MS.servable({ score: 0.89 }, 0.9), false);
  assert.equal(MS.servable(null, 0.5), false); assert.equal(MS.servable({ score: 1 }, null), false); assert.equal(MS.servable({ score: 0 }, 0), true);
  const f = { newAnswer: 'Hrolf', oldAnswer: 'Rollo' };
  assert.deepEqual(MS.answerFlags('Hrolf', f), { isNew: 1, isOld: 0 }); assert.deepEqual(MS.answerFlags('the Rollo', f), { isNew: 0, isOld: 1 });
  assert.deepEqual(MS.answerFlags(null, f), { isNew: 0, isOld: 0 }); assert.deepEqual(MS.answerFlags('Paris', f), { isNew: 0, isOld: 0 });
  const q = { goldId: 'P', answers: ['1774'] };
  assert.equal(MS.bearing(q, { depth: 2, paragraph: 'P', text: 'x' }), true, 'the gold paragraph');
  assert.equal(MS.bearing(q, { depth: 3, paragraph: 'P', text: 'found in 1774' }), true, 'a gold sentence with the answer');
  assert.equal(MS.bearing(q, { depth: 3, paragraph: 'P', text: 'no year here' }), false);
  assert.equal(MS.bearing(q, { depth: 1, paragraph: 'P', text: '1774' }), false, 'never an article node');
  assert.equal(MS.bearing(q, { depth: 2, paragraph: 'Q', text: '1774' }), false);
  assert.equal(MS.isArticle({ depth: 1 }), 1); assert.equal(MS.isArticle({ depth: 2 }), 0);
  assert.equal(MS.firstIs([{ id: 'a' }, { id: 'b' }], 'a'), true); assert.equal(MS.firstIs([{ id: 'b' }, { id: 'a' }], 'a'), false); assert.equal(MS.firstIs([], 'a'), false);
  const A2 = { q: { impossible: false, goldId: 'P' } }, U2 = { q: { impossible: true, goldId: null } };
  assert.equal(MS.right(A2, { answer: 'P' }), true); assert.equal(MS.right(A2, { answer: 'Q' }), false); assert.equal(MS.right(A2, { refuse: true, answer: 'P' }), false);
  assert.equal(MS.right(U2, { answer: null }), false, 'an unanswerable question is never answered right');
  assert.equal(MS.correct(U2, { refuse: true }), true); assert.equal(MS.correct(U2, { answer: 'P' }), false); assert.equal(MS.correct(A2, { answer: 'P' }), true);
});

const hand = (qid, impossible, goldId, pid, score, weakest) => ({ q: { qid, impossible, goldId, answers: ['x'] }, pid, score, ev: weakest === undefined ? undefined : { weakest }, text: 'x y', raw: 'x', readerOK: true });
test('metrics / search on hand rows: the default decider is the real gate; NaN scores are no candidate', () => {
  const rows = [hand('a', false, 'P', 'P', 0.9, 0.8), hand('b', true, null, 'P', 0.7, 0.2), hand('c', false, 'Q', 'Q', NaN, undefined)];
  assert.equal(MS.search(rows, {}).tried, 4, 'thresholds: refuse-all, 0.9, 0.7, off (NaN is not one)');
  assert.equal(MS.search(rows, { evidence: true }).tried, 16);
  assert.deepEqual(MS.search(rows, {}).setting, { t: 0.9, e: null, reader: false });
  const m = MS.metrics(rows, { t: null, e: null, reader: false });
  assert.deepEqual([m.right, m.refusedUnanswerable, m.answeredAnswerable], [2, 0, 2], 'the real gate with every check off answers all three');
  assert.equal(MS.metrics(rows, { t: 0.95, e: null }, MS.replay).answeredAnswerable, 0);
  const mt = MS.matched(rows, 0.5, {});
  assert.deepEqual([mt.setting.t, mt.tune.recall, mt.tune.refusal], [0.9, 0.5, 1]);
  const all = MS.matched(rows, 1, { evidence: true });
  assert.deepEqual([all.setting.t, all.setting.e, all.tune.refusal], [null, null, 0], 'only with both checks off is c (NaN score) answered');
});

test('the reader is asked lazily: a refused-at-the-bar question never asks; a missing call is listed once', () => {
  const askedKeys = [];
  const spy = new Proxy(one, { get: (o, k) => { if (typeof k === 'string') askedKeys.push(k); return o[k]; } });
  const D2 = { ...A.D, reader: { ...A.D.reader, one: spy } };
  measure(D2);
  assert.ok(askedKeys.includes('q3|A#1'), 'a question that clears the bar and the evidence is read');
  assert.ok(askedKeys.includes('q1|A#1'), 'every tune row is read: the search needs its verdict for every setting');
  const evalOnlyRefusedAtBar = ['q7|A#1', 'q9|A#1'].filter((k) => !askedKeys.includes(k));
  assert.ok(askedKeys.length > 0);
  const gap = { ...one }; delete gap['q3|A#1']; delete gap['q4|A#1'];
  const R3 = measure({ ...A.D, reader: { ...A.D.reader, one: gap } });
  assert.deepEqual(R3.needs.filter(([q]) => q === 'q3' || q === 'q4').map((x) => x.join('|')).sort(), ['q3|A#1', 'q4|A#1'], 'each missing call listed once, however many systems ask');
  assert.equal(R3.needs.filter(([q, p]) => q === 'q3' && p === 'A#1').length, 1);
  assert.equal(R3.s1.v2.right, 0, 'a missing reader call is a refusal, never an answer');
  const noGap = measure({ ...A.D, reader: { ...A.D.reader, one: { ...one } } });
  assert.deepEqual(noGap.needs, []);
  void evalOnlyRefusedAtBar;
});

test('matched: equal refusal goes to the more accurate setting', () => {
  const rows = [hand('a', false, 'P', 'P', 0.9, 1), hand('b', true, null, 'P', 0.95, 1), hand('c', false, 'Q', 'Q', 0.5, 1)];
  const mt = MS.matched(rows, 0.5, {});
  assert.equal(mt.setting.t, 0.5, 't = 0.9 and t = 0.5 both refuse nothing; 0.5 also answers c');
  assert.deepEqual([mt.tune.recall, mt.tune.refusal, mt.tune.accuracy], [1, 0, 0.6667]);
});

test('the example rules, one predicate each', () => {
  const q = { goldId: 'G', answers: ['1774'] };
  assert.equal(EX.lateWin(q, 'X', 'G'), true); assert.equal(EX.lateWin(q, 'G', 'G'), false); assert.equal(EX.lateWin(q, 'X', 'Y'), false);
  assert.equal(EX.lateLoss(q, 'G', 'X'), true); assert.equal(EX.lateLoss(q, 'X', 'Y'), false); assert.equal(EX.lateLoss(q, 'G', 'G'), false);
  assert.equal(EX.groundedRight(q, { answer: 'G', span: { text: '1774' } }), true);
  assert.equal(EX.groundedRight(q, { answer: 'G', span: { text: 'in 1774' } }), false, 'right source, not an exact match');
  assert.equal(EX.groundedRight(q, { answer: 'H', span: { text: '1774' } }), false);
  assert.equal(EX.groundedRight(q, { refuse: true, answer: 'G', span: { text: '1774' } }), false);
  assert.equal(EX.pairExact(['a', 'b'], ['b', 'a']), true); assert.equal(EX.pairExact(['a', 'b'], ['a', 'a']), false); assert.equal(EX.pairExact(['a', 'b'], ['a', 'c']), false); assert.equal(EX.pairExact(['a', 'b'], ['c', 'b']), false);
  assert.equal(EX.walkOnly(['a', 'b'], ['a', 'b'], ['a', 'c']), true); assert.equal(EX.walkOnly(['a', 'b'], ['a', 'b'], ['b', 'a']), false); assert.equal(EX.walkOnly(['a', 'b'], ['a', 'c'], ['a', 'd']), false);
  assert.equal(EX.composedRight({ answer: 'yes' }, 'yes'), true); assert.equal(EX.composedRight({ answer: 'no' }, 'yes'), false);
  assert.equal(EX.composedRight({ refuse: true, answer: 'yes' }, 'yes'), false); assert.equal(EX.composedRight(null, 'yes'), false);
  assert.equal(EX.staleThenFresh({ staleFlat: 1, latestMem: 1 }), true); assert.equal(EX.staleThenFresh({ staleFlat: 0, latestMem: 1 }), false); assert.equal(EX.staleThenFresh({ staleFlat: 1, latestMem: 0 }), false);
});

// ── C7b: kept work, re-checked for each paraphrase (PREREG §7) ──
test('C7b on the miniature: kept work re-checked for each paraphrase, the bar chosen on tune (worked by hand)', () => {
  const s = R.s5b, c = R.claims.C7b;
  assert.equal(s.matchBar, 1, "the tune unanswerable q1 matches q0 at 0.333 but fails its re-check; only the exact matches set the bar");
  assert.deepEqual([s.kept, s.eval, s.unanswerable, s.tried, s.served, s.falseServes, s.warmRight, s.coldRight, s.readerCallsSaved], [4, 7, 3, 2, 2, 0, 5, 4, 2]);
  assert.deepEqual(s.stoppedBy, { 2: 0, 3: 0, 4: 0, 5: 0, offsets: 0, other: 0 });
  assert.deepEqual(s.passagesScored, { withMemory: 17, without: 21 }, 'two re-checks of one passage, five cold retrievals of three');
  assert.equal(s.matchedAgainstPerQuestion, 4);
  assert.deepEqual(s.servedSpans, { answerable: 2, exactMatch: 1, coldExactMatchOnSame: 1, audited: 2, verbatim: 2 },
    "q3's kept 'at Hastings' is not an exact match (the cold reader's 'Hastings' is); q4's kept 'French' is, where the cold reader said NONE");
  assert.deepEqual(s.afterChanges, { served: 1, staleServed: 0, staleCaught: 1 }, "after the changes q4's French is Latin: its kept span is caught at check 5");
  assert.deepEqual(s.lostWhereColdWasRight, { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, answered: 0 }, 'nothing the cold path got right was lost');
  assert.deepEqual(c.detail, { warmAccuracy: 0.7143, coldAccuracy: 0.5714, falseServeRate: 0, served: 2, staleServed: 0, staleCaught: 1, matchBar: 1, readerCallsSaved: 2,
    test: { n: 7, a: 5, b: 4, aOnly: 1, bOnly: 0, p: 1 } });
  assert.equal(c.pass, true);
  assert.deepEqual(Object.keys(R.claims), ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C7b']);
  assert.equal(R.claims.C7.pass, true, 'C7 is still measured exactly as before, beside it');
  const R0 = measure({ ...A.D, s5: undefined });
  assert.equal(R0.s5b, null); assert.equal(R0.claims.C7b.pass, false); assert.deepEqual(R0.claims.C7b.detail, { why: 'no paraphrase data' });
});

test('C7b: the re-check decides the bar and the serve (a variant of the miniature, worked by hand)', () => {
  const para = { ...s5.col.para, 'para:q0': col(T('rollo', 'founded')), 'para:q1': col(T('founded', 'normandy', 'x61')), 'para:q5': col(T('rouen', 'capital', 'founded')) };
  const R2 = measure(assemble({ ...F, s5: { ...s5, col: { ...s5.col, para } } }).D), s = R2.s5b;
  assert.equal(R2.s5.threshold, 1, "C7's bar: the unanswerable q1 now matches a stored question at 0.667");
  assert.equal(s.matchBar, 0.5, "C7b's bar: q1 fails its re-check (two of its three words are in the passage), so q0's 0.5 qualifies");
  assert.deepEqual([s.tried, s.served, s.falseServes, s.warmRight, s.coldRight, s.readerCallsSaved], [5, 2, 0, 5, 4, 2],
    'q5 would pass its re-check, but its match (0.333) is under the bar, so it is not served and its cold path asks the reader');
  assert.deepEqual(s.stoppedBy, { 2: 3, 3: 0, 4: 0, 5: 0, offsets: 0, other: 0 }, 'q6, q7 and q9 clear the match bar and are stopped at check 2');
  assert.deepEqual(s.passagesScored, { withMemory: 20, without: 21 });
  assert.equal(R2.claims.C7b.pass, true);
});

test('C7b: a kept answer served to an unanswerable question the cold reader refuses (a variant, worked by hand)', () => {
  const para = { ...s5.col.para, 'para:q9': col(T('normans', 'spoke')) };
  const R3 = measure(assemble({ ...F, s5: { ...s5, col: { ...s5.col, para } } }).D), s = R3.s5b;
  assert.deepEqual([s.matchBar, s.tried, s.served, s.falseServes, s.warmRight, s.coldRight], [1, 3, 3, 1, 4, 4],
    "q9 now reads exactly like q4 and passes the re-check (both its words are in the passage), so q4's French is served to it");
  assert.deepEqual(s.lostWhereColdWasRight, { 1: 0, 2: 0, 3: 0, 4: 1, 5: 0, answered: 0 }, 'the cold path refused q9 only because its own reader call said NONE');
  assert.equal(R3.claims.C7b.pass, false);
  assert.equal(R3.claims.C7b.detail.falseServeRate, 0.3333);
});

test('matchOne: one question against one passage, exactly what retrieval computed there', () => {
  assert.deepEqual(matchOne(s5.col.para['para:q8'], docs['B#0']), { score: 0.75, weakest: 0, weakestToken: 'x99' });
  let n = 0;
  for (const q of questions.slice(3)) for (const [pid, score] of A.paraScores[q.qid].col.slice(0, 3)) {
    const m = matchOne(s5.col.para['para:' + q.qid], docs[pid]); n++;
    assert.equal(m.score, score, q.qid + ' ' + pid);
    assert.deepEqual({ weakest: m.weakest, weakestToken: m.weakestToken }, A.paraScores[q.qid].ev[pid], q.qid + ' ' + pid);
  }
  assert.equal(n, 21);
  assert.equal(matchOne(null, docs['B#0']), null); assert.equal(matchOne(s5.col.para['para:q8'], undefined), null);
  assert.deepEqual(A.D.s5.match('q4', 'A#1@v2'), { score: 1, weakest: 1, weakestToken: 'normans' }, 'a later version is matched from its own vectors');
  assert.equal(A.D.s5.match('q4', 'nope'), null);
  assert.equal(A.D.s5.match('q8', 'B#0'), A.D.s5.match('q8', 'B#0'), 'worked out once, then kept');
});

test('passRecycle at its exact boundaries', () => {
  const ok = { bar: 0.9, served: 1, falseServeRate: 0.01, warm: 0.5, cold: 0.5, staleServed: 0 };
  assert.equal(MS.passRecycle(ok), true, 'equal accuracy and false serves exactly at the limit pass');
  for (const [k, v] of [['bar', null], ['served', 0], ['falseServeRate', 0.0101], ['warm', 0.49], ['staleServed', 1]]) assert.equal(MS.passRecycle({ ...ok, [k]: v }), false, k);
  assert.equal(MS.passRecycle({ ...ok, bar: 0 }), true, 'a bar of 0 is still a bar');
});

test('scorer: the passages decoded once, then one question at a time, exactly what scoreSet gives', () => {
  const score = scorer(paragraphs, s1.col.docs, s1.nomic.docs);
  for (const q of questions) assert.deepEqual(score(s1.col.q[q.qid], s1.nomic.q[q.qid]), A.s1Scores[q.qid], q.qid);
  assert.deepEqual(score(s1.col.q.q8, s1.nomic.q.q8).col[0], ['B#0', 0.75]);
});
