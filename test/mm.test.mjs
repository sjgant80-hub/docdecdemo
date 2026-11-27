// The Memory Model (PREREG.md, addendum 3): what can be checked from the shipped files alone, on every push.
// The sets were built from the pinned HotpotQA file by bench/mm/build-sets.mjs (which needs that file); here the shipped
// sets are held to the same rule, and the pre-registration's numbers are held to the shipped sets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import S from '../src/mmsets.mjs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const sets = JSON.parse(read('data/v3/sets.json')), prereg = read('PREREG.md');
const n = (x) => x.toLocaleString('en-GB');

test('the shipped sets keep their rule: nothing kept outside is in a corpus, and the noise is the size of the corpus', () => {
  assert.equal(sets.v, 'docdec-mm-sets/1');
  for (const name of ['dev', 'sealed']) {
    const s = sets[name];
    assert.deepEqual(S.check(s), [], name);
    assert.deepEqual([s.answerable.length, s.unanswerable.length, s.foreign.length], [s.rule.answerable, s.rule.unanswerable, s.rule.foreign], name);
    assert.equal(s.counts.full, true); assert.equal(s.counts.titleClashes, 0);
    assert.ok(s.rule.start >= 500, `${name} starts after the rows DocDec v2 used`);
    const text = new Map(s.corpus.map((p) => [p.id, p.text]));
    for (const q of s.answerable) {
      assert.equal(q.gold.length, 2, `${q.qid}: two sources`);
      assert.ok(S.YESNO.includes(S.norm(q.answer)) || q.gold.some((t) => S.holds(text.get(t), q.answer)), `${q.qid}: its answer is word for word in a source paragraph`);
    }
    // a foreign question carries its own paragraphs, and they are its sources
    for (const q of s.foreign) assert.deepEqual(q.paragraphs.map((p) => p.id), q.gold);
    assert.equal(s.counts.corpusWords, s.corpus.reduce((a, p) => a + p.text.trim().split(/\s+/).length, 0));
    assert.equal(s.counts.noiseWords, s.noise.reduce((a, p) => a + p.text.trim().split(/\s+/).length, 0));
  }
  // the dev set and the sealed set share no question and no paragraph
  const ids = (s) => new Set([...s.answerable, ...s.unanswerable, ...s.foreign].map((q) => q.qid));
  const paras = (s) => new Set([...s.corpus, ...s.noise, ...s.foreign.flatMap((q) => q.paragraphs)].map((p) => p.id).concat(s.unanswerable.flatMap((q) => q.gold)));
  assert.deepEqual([...ids(sets.dev)].filter((x) => ids(sets.sealed).has(x)), []);
  assert.deepEqual([...paras(sets.dev)].filter((x) => paras(sets.sealed).has(x)), []);
  assert.deepEqual(sets.sharedBetweenDevAndSealed, { questions: 0, paragraphs: 0 });
  assert.ok(sets.dev.rule.start + sets.dev.counts.read <= sets.sealed.rule.start, 'the dev set ends before the sealed set begins');
});

test('the pre-registration states the sets as they are shipped', () => {
  const d = sets.dev.counts, s = sets.sealed.counts;
  assert.ok(prereg.includes('## 9 · Addendum 3, 2026-11-27: the Memory Model'));
  assert.ok(prereg.includes(`| dev (never a claim) | ${sets.dev.rule.start} | ${d.answerable} | ${d.unanswerable} | ${d.foreign} | ${d.corpus} paragraphs, ${n(d.corpusWords)} words | ${d.noise} paragraphs |`), 'the dev row');
  assert.ok(prereg.includes(`| **sealed** | ${sets.sealed.rule.start} | ${s.answerable} (${s.types.bridge} bridge, ${s.types.comparison} comparison; ${s.yesNo} answered yes or no) | ${s.unanswerable} | ${s.foreign} | ${s.corpus} paragraphs, ${n(s.corpusWords)} words | ${s.noise} paragraphs, ${n(s.noiseWords)} words |`), 'the sealed row');
  assert.ok(prereg.includes(`corpus plus noise: ${s.corpus + s.noise} paragraphs, ${n(s.corpusWords + s.noiseWords)} words`), 'the doubled corpus');
  assert.equal(sets.dev.counts.skipped + sets.sealed.counts.skipped, 0, 'the pre-registration says no row was skipped');
  assert.ok(prereg.includes('no row was\nskipped') || prereg.includes('no row was skipped'));
  // the five claims are named, with their bars
  for (const k of ['| K1 | Long-document lift |', '| K2 | Noise robustness |', '| K3 | Executive swap |', '| K4 | Honest boundary |', '| K5 | Held-out integrity |']) assert.ok(prereg.includes(k), k);
  assert.ok(prereg.includes('at least **5 points**') && prereg.includes('at least **3 points smaller**') && prereg.includes('only if **all five** pass'));
  // the refusal phrase, as an answer is read
  assert.equal(S.norm('not in the documents'), 'not in documents');
});
