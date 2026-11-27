// bench/mm/build-sets.mjs — the Memory Model's sets, built by src/mmsets.mjs from the same SHA-pinned HotpotQA file
// DocDec v2 uses, in file order, from rows DocDec v2 never touched (it used rows 0 to 499). Writes data/v3/sets.json.
//   dev      rows from 500: a small set for trying the pipeline out. Published, and never a claim.
//   sealed   rows from 600: the set the claims are ruled on. Nothing about it is chosen by hand.
//   node bench/mm/build-sets.mjs            write data/v3/sets.json
//   node bench/mm/build-sets.mjs --check    the file on disk is exactly what the rule gives
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { asyncBufferFromFile, parquetReadObjects } from 'hyparquet';
import { compressors } from 'hyparquet-compressors';
import SETS from '../../src/mmsets.mjs';

const HERE = dirname(fileURLToPath(import.meta.url)), ROOT = join(HERE, '..', '..');
export const HOTPOT_SHA256 = 'c20b638ca82b21d04fe12e14ff417ad05153d4d215a65de54497fca4e972f7c6';
export const V2_ROWS = 500;                                   // DocDec v2's multi-hop set is rows 0 to 499
export const DEV = { start: 500, answerable: 30, unanswerable: 10, foreign: 10, perQuestion: 2 };
export const SEALED = { start: 600, answerable: 120, unanswerable: 60, foreign: 60, perQuestion: 2 };
const sha = (b) => createHash('sha256').update(b).digest('hex');

const file = join(HERE, '..', 'raw', 'hotpot_qa-distractor-validation.parquet');
const got = sha(readFileSync(file));
if (got !== HOTPOT_SHA256) throw new Error(`${file}: sha256 ${got} is not the pinned ${HOTPOT_SHA256}`);
const raw = await parquetReadObjects({ file: await asyncBufferFromFile(file), compressors });
const rows = raw.map((r) => ({ id: r.id, question: r.question, answer: r.answer, type: r.type, titles: Array.from(r.context.title), texts: Array.from(r.context.sentences).map((s) => Array.from(s).join('')), gold: [...new Set(Array.from(r.supporting_facts.title))] }));

const dev = SETS.plan(rows, DEV), sealed = SETS.plan(rows, SEALED);
for (const [name, s, o] of [['dev', dev, DEV], ['sealed', sealed, SEALED]]) {
  if (!s.counts.full) throw new Error(`${name}: the file ran out before the set was full (${JSON.stringify(s.counts)})`);
  if (s.counts.titleClashes) throw new Error(`${name}: ${s.counts.titleClashes} paragraphs share a title and differ in text`);
  const bad = SETS.check(s); if (bad.length) throw new Error(`${name}: ${bad.join('; ')}`);
  if (o.start < V2_ROWS) throw new Error(`${name} starts inside DocDec v2's rows`);
}
if (DEV.start + dev.counts.read > SEALED.start) throw new Error('the dev set runs into the sealed set\'s rows');
// no question and no paragraph of the dev set is in the sealed set, and the other way round
const ids = (s) => new Set([...s.answerable, ...s.unanswerable, ...s.foreign].map((q) => q.qid));
const paras = (s) => new Set([...s.corpus, ...s.noise, ...s.foreign.flatMap((q) => q.paragraphs)].map((p) => p.id).concat(s.unanswerable.flatMap((q) => q.gold)));
const shared = { questions: [...ids(dev)].filter((x) => ids(sealed).has(x)).length, paragraphs: [...paras(dev)].filter((x) => paras(sealed).has(x)).length };
if (shared.questions) throw new Error('a question is in both the dev set and the sealed set');
const words = (ps) => ps.reduce((a, p) => a + (p.text.trim().split(/\s+/).length), 0);
const types = (qs) => Object.fromEntries([...new Set(qs.map((q) => q.type))].sort().map((t) => [t, qs.filter((q) => q.type === t).length]));
const pack = (s, o) => ({ rule: o, counts: { ...s.counts, corpusWords: words(s.corpus), noiseWords: words(s.noise), types: types(s.answerable), yesNo: s.answerable.filter((q) => SETS.YESNO.includes(SETS.norm(q.answer))).length }, answerable: s.answerable, unanswerable: s.unanswerable, foreign: s.foreign, corpus: s.corpus, noise: s.noise, skipped: s.skipped });
const out = { v: 'docdec-mm-sets/1', source: 'HotpotQA distractor validation (CC BY-SA 4.0), the SHA-pinned file DocDec v2 uses; rows in file order', hotpotSha256: HOTPOT_SHA256, sharedBetweenDevAndSealed: shared, dev: pack(dev, DEV), sealed: pack(sealed, SEALED) };
const text = JSON.stringify(out, null, 1) + '\n', at = join(ROOT, 'data', 'v3', 'sets.json');
if (process.argv.includes('--check')) {
  const same = existsSync(at) && readFileSync(at, 'utf8') === text;
  console.log(same ? 'data/v3/sets.json is exactly what the rule gives' : 'data/v3/sets.json is NOT what the rule gives'); process.exit(same ? 0 : 1);
}
mkdirSync(join(ROOT, 'data', 'v3'), { recursive: true }); writeFileSync(at, text);
for (const [name, s] of [['dev', out.dev], ['sealed', out.sealed]]) console.log(`${name}: ${JSON.stringify(s.counts)}`);
console.log(`shared between dev and sealed: ${JSON.stringify(shared)}; sets.json sha256 ${sha(text).slice(0, 12)}`);
