// bench/mm/build-train.mjs — from what the generator wrote to what the memory may be trained on. src/mmtrain.mjs
// decides everything: which pairs are grounded, which refusals are added, which questions the guard strikes.
//   node bench/mm/build-train.mjs <dev | sealed>
// Reads bench/cache/mm-<set>-gen.json and data/v3/sets.json. Writes, under data/v3/<set>/:
//   train-corpus.jsonl    the training file for the memory of the corpus
//   train-doubled.jsonl   the same for the doubled corpus (only when the noise was generated)
//   build.json            the counts: written, kept, dropped by reason, refusals, struck by the guard, and K5's counts
// A training line is a conversation in the form the-distillation's trainer reads: the one fixed system line, the
// question, and the reply to learn.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import TRAIN from '../../src/mmtrain.mjs';
import { MEMORY_SYSTEM } from './prompts.mjs';

const HERE = dirname(fileURLToPath(import.meta.url)), ROOT = join(HERE, '..', '..');
const which = process.argv[2];
if (!['dev', 'sealed'].includes(which)) { console.error('usage: node bench/mm/build-train.mjs <dev | sealed>'); process.exit(2); }
const sets = JSON.parse(readFileSync(join(ROOT, 'data', 'v3', 'sets.json'), 'utf8')), set = sets[which];
const gen = JSON.parse(readFileSync(join(HERE, '..', 'cache', `mm-${which}-gen.json`), 'utf8'));
const dir = join(ROOT, 'data', 'v3', which); mkdirSync(dir, { recursive: true });
const sha = (s) => createHash('sha256').update(s).digest('hex');

// every test question there is, dev and sealed: none may be trained on, in either set's memory
const tests = ['dev', 'sealed'].flatMap((s) => [...sets[s].answerable, ...sets[s].unanswerable]);
const byId = new Map([...set.corpus, ...set.noise, ...set.foreign.flatMap((q) => q.paragraphs)].map((p) => [p.id, p]));
const pairsOf = (calls) => calls.flatMap((c) => c.pairs.map((p) => ({ question: p.question, answer: p.answer, kind: c.kind, sources: c.sources.map((id) => byId.get(id)) })));
const foreign = pairsOf(gen.foreign);

function file(name, calls) {
  const written = pairsOf(calls), k = TRAIN.keep(written), refusals = TRAIN.refusals(k.kept, foreign), g = TRAIN.guard([...k.kept, ...refusals], tests);
  const lines = g.kept.map((p, i) => JSON.stringify({ id: `${which}-${name}-${i + 1}`, messages: [{ role: 'system', content: MEMORY_SYSTEM }, { role: 'user', content: p.question }], reply: p.answer }));
  const text = lines.join('\n') + '\n';
  writeFileSync(join(dir, `train-${name}.jsonl`), text);
  const kinds = Object.fromEntries(['fact', 'title', 'two', 'refusal'].map((kind) => [kind, g.kept.filter((p) => p.kind === kind).length]));
  return { pairs: g.kept, summary: { written: written.length, grounded: k.kept.length, dropped: k.dropped, refusals: refusals.length, struckByTheGuard: g.struck, examples: g.kept.length, kinds, sha256: sha(text) } };
}

const corpus = file('corpus', gen.corpus), hasNoise = gen.noise.length > 0;
const doubled = hasNoise ? file('doubled', [...gen.corpus, ...gen.noise]) : null;
const outside = [...set.unanswerable.flatMap((q) => q.gold), ...set.foreign.flatMap((q) => q.gold)];
const corpora = [set.corpus, ...(hasNoise ? [[...set.corpus, ...set.noise]] : [])];
const inputs = [...gen.corpus, ...gen.noise, ...gen.foreign].map((c) => c.prompt);
const integrity = TRAIN.integrity([corpus.pairs, ...(doubled ? [doubled.pairs] : [])], tests, corpora, outside, inputs);
const build = { v: 'docdec-mm-build/1', set: which, generator: gen.generator, generatorSeconds: gen.seconds, generatorCalls: inputs.length, corpus: corpus.summary, doubled: doubled ? doubled.summary : null, foreignQuestions: foreign.length, integrity };
writeFileSync(join(dir, 'build.json'), JSON.stringify(build, null, 1) + '\n');
for (const [name, f] of [['corpus', corpus], ...(doubled ? [['doubled', doubled]] : [])]) console.log(`${name}: ${f.summary.written} pairs written → ${f.summary.grounded} grounded + ${f.summary.refusals} refusals − ${f.summary.struckByTheGuard.length} struck = ${f.summary.examples} examples (${JSON.stringify(f.summary.kinds)})`);
console.log(`dropped (corpus): ${JSON.stringify(corpus.summary.dropped)}`);
console.log(`integrity: ${JSON.stringify(integrity)}`);
