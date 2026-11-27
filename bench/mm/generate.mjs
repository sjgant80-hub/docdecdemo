// bench/mm/generate.mjs — the generator reads paragraphs, one at a time, and writes question-and-answer pairs.
// It is shown paragraphs only: never a test question. Every prompt it was given is kept, so that can be checked.
//   node bench/mm/generate.mjs <dev | sealed> [--noise]
// Writes bench/cache/mm-<set>-gen.json: for the corpus (and, with --noise, the noise) the fact pairs, the title pairs
// and the two-paragraph pairs; for the foreign paragraphs, fact pairs (their questions become the trained refusals).
// Nothing here is trusted: src/mmtrain.mjs decides afterwards which pairs may be trained on.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import GRAPH from '../../src/graph.mjs';
import { generate, save } from './llm.mjs';
import { GENERATOR, PROMPT_FACTS, PROMPT_TITLE, PROMPT_TWO, parsePairs } from './prompts.mjs';

const HERE = dirname(fileURLToPath(import.meta.url)), ROOT = join(HERE, '..', '..');
const which = process.argv[2], withNoise = process.argv.includes('--noise');
if (!['dev', 'sealed'].includes(which)) { console.error('usage: node bench/mm/generate.mjs <dev | sealed> [--noise]'); process.exit(2); }
const set = JSON.parse(readFileSync(join(ROOT, 'data', 'v3', 'sets.json'), 'utf8'))[which];
const out = join(HERE, '..', 'cache', `mm-${which}-gen.json`);

// the corpus's own links: paragraph A names paragraph B's title. Found from the paragraphs alone.
export function links(paragraphs) {
  const index = GRAPH.indexTitles(paragraphs), byId = new Map(paragraphs.map((p) => [p.id, p])), seen = new Set(), pairs = [];
  for (const a of paragraphs) for (const id of GRAPH.mentions(a.text, index, a.id)) {
    const k = [a.id, id].sort().join('\u0000');
    if (byId.has(id) && !seen.has(k)) { seen.add(k); pairs.push([a, byId.get(id)]); }
  }
  return pairs.slice(0, paragraphs.length);          // at most as many pairs as paragraphs, the first in order
}

const t0 = Date.now(), rec = { v: 'docdec-mm-gen/1', set: which, generator: GENERATOR, corpus: [], noise: [], foreign: [], seconds: 0 };
let calls = 0, fresh = 0;
const one = async (kind, prompt, sources) => { const r = await generate(GENERATOR.model, prompt, GENERATOR.options); calls++; if (!r.cached) fresh++; return { kind, sources: sources.map((s) => s.id), prompt, raw: r.raw, ms: r.ms, pairs: parsePairs(r.raw) }; };
const part = async (name, paragraphs, twos) => {
  for (const [i, p] of paragraphs.entries()) {
    rec[name].push(await one('fact', PROMPT_FACTS(p), [p]));
    if (twos) rec[name].push(await one('title', PROMPT_TITLE(p), [p]));
    if (i % 10 === 9) { save(); console.log(`${name}: ${i + 1} of ${paragraphs.length} paragraphs · ${calls} calls (${fresh} new) · ${Math.round((Date.now() - t0) / 1000)} s`); }
  }
  if (twos) { const L = links(paragraphs); for (const [a, b] of L) rec[name].push(await one('two', PROMPT_TWO(a, b), [a, b])); console.log(`${name}: ${L.length} linked pairs of paragraphs`); }
  save();
};
if (process.argv[1] && process.argv[1].endsWith('generate.mjs')) {
  await part('corpus', set.corpus, true);
  // the doubled corpus's links are found over all of it, so the noise is generated with the corpus beside it
  if (withNoise) { const all = [...set.corpus, ...set.noise], was = new Set(links(set.corpus).map(([a, b]) => [a.id, b.id].sort().join('\u0000'))); for (const [i, p] of set.noise.entries()) { rec.noise.push(await one('fact', PROMPT_FACTS(p), [p])); rec.noise.push(await one('title', PROMPT_TITLE(p), [p])); if (i % 10 === 9) { save(); console.log(`noise: ${i + 1} of ${set.noise.length}`); } } for (const [a, b] of links(all).filter(([a, b]) => !was.has([a.id, b.id].sort().join('\u0000')))) rec.noise.push(await one('two', PROMPT_TWO(a, b), [a, b])); save(); }
  await part('foreign', set.foreign.flatMap((q) => q.paragraphs), false);
  rec.seconds = Math.round((Date.now() - t0) / 1000);
  writeFileSync(out, JSON.stringify(rec));
  const n = (name) => rec[name].reduce((a, c) => a + c.pairs.length, 0);
  console.log(`done: ${calls} generator calls (${fresh} new) in ${rec.seconds} s · pairs written: corpus ${n('corpus')}, noise ${n('noise')}, foreign ${n('foreign')}`);
}
