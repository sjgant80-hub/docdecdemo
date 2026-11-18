// test/record.test.mjs — every published number, re-derived from the shipped data on every push.
// 1. S1, the off-topic set, S4 and S5 are RE-SCORED from the shipped vectors (ColBERT int8 tokens, nomic vectors) and
//    must equal the shipped score tables exactly; the S1 slice of the shipped S2 table must equal S1's own scores.
// 2. The whole measurement runs again and must equal data/v2/record.json field for field, examples included.
// 3. The fast settings search is proven equal to the real gate on every decision it makes.
// 4. Every answer's span is the source's own characters at its offsets.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assemble } from '../src/assemble.mjs';
import { measure, rowsFor, search, replay, decideRow } from '../src/measure.mjs';
import { pick } from '../src/examples.mjs';
import { publishable, compareRecords } from '../src/publish.mjs';
import { v1Outcomes } from '../src/v1.mjs';

const read = (f) => JSON.parse(readFileSync(new URL('../' + f, import.meta.url), 'utf8'));
const names = ['s1', 's2', 's3', 's4', 's5', 'h1', 'reader', 'v1'];
const F = Object.fromEntries(names.map((n) => [n, read('data/v2/' + n + '.json')]));
const published = read('data/v2/record.json');
const shipped = read('data/v2/scores-s1.json');
const A = assemble(F);

test('S1, off-topic, S4 and S5 scores re-derived from the shipped vectors equal the shipped tables', () => {
  assert.deepEqual(A.s1Scores, shipped.q);
  assert.deepEqual(A.oosScores, shipped.oos);
  assert.deepEqual(A.s4Scores, shipped.s4);
  assert.deepEqual(A.qq, shipped.qq);
  assert.deepEqual(A.paraScores, shipped.para);
});

test('the S1 slice of the shipped 9x table equals S1 re-scored from vectors', () => {
  let checked = 0;
  for (const q of F.s1.questions) {
    const own = new Map(A.s1Scores[q.qid].col);
    for (const [id, s] of Object.entries(F.s2.scores[q.qid].colOf)) if (own.has(id)) { assert.equal(s, own.get(id), q.qid + ' ' + id); checked++; }
  }
  assert.ok(checked > 1000, 'checked ' + checked);
});

test('DocDec v1 re-run on its own shipped data gives the shipped v1 outcomes', () => {
  assert.deepEqual(v1Outcomes(read('eval-data.json')), F.v1);
});

const rec = measure(A.D);
test('the whole record re-derives field for field', () => {
  const mine = publishable(rec, pick(F, A.D, rec), published.sources);
  const { fields, diffs } = compareRecords(mine, published);
  assert.ok(fields > 500, fields + ' fields');
  assert.deepEqual(diffs, []);
  assert.equal(published.complete, true, 'every reader call the measurement needed was made');
});

test('the fast settings search equals the real gate on every decision it makes', () => {
  const t1 = new Map(F.s1.paragraphs.map((p) => [p.id, p.text]));
  const reader = (qid, pid) => F.reader.one[qid + '|' + pid];
  const tune = F.s1.questions.slice(0, Math.floor(F.s1.questions.length * 0.3));
  let n = 0;
  for (const [method, opts] of [['cos', {}], ['col', {}], ['col', { evidence: true }], ['cos', { reader: true }], ['col', { reader: true }], ['col', { evidence: true, reader: true }]]) {
    const rows = rowsFor(tune, A.D.s1.scores, t1, reader, method, rec._prefix);
    for (const s of search(rows, opts).settings) for (const r of rows) {
      const a = replay(r, s), b = decideRow(r, s); n++;
      if ((a.refuse === true) !== (b.refuse === true) || (!a.refuse && a.answer !== b.answer)) assert.fail(`differs: ${r.q.qid} ${JSON.stringify(s)}`);
    }
  }
  assert.ok(n > 100000, n + ' decisions');
});

test('every answer is its source’s own words at its offsets (C6)', () => {
  assert.equal(published.claims.C6.detail.audited, published.claims.C6.detail.verbatim);
  assert.ok(published.claims.C6.detail.audited > 100);
});

test('nothing in the record was typed: the claims come from the measurement', () => {
  for (const [k, c] of Object.entries(published.claims)) assert.equal(typeof c.pass, 'boolean', k);
  assert.deepEqual(Object.keys(published.claims), ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7']);
});
