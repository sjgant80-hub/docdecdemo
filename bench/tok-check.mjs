// bench/tok-check.mjs — quick tokenizer parity check (the full one is parity-web.mjs): src/wordpiece.mjs vs tokenizer.json
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AutoTokenizer, env } from '@huggingface/transformers';
import WP from '../src/wordpiece.mjs';
const HERE = dirname(fileURLToPath(import.meta.url));
const S = JSON.parse(readFileSync(join(HERE, 'cache', 'sets.json'), 'utf8'));
const vocab = WP.vocabFrom(readFileSync(join(HERE, 'models', 'answerai-colbert-small-v1', 'vocab.txt'), 'utf8'));
env.allowRemoteModels = false; env.localModelPath = join(HERE, 'models');
const tok = await AutoTokenizer.from_pretrained('answerai-colbert-small-v1');
const texts = [...S.small.questions.map((q) => q.text), ...S.small.outOfScope.map((q) => q.text), ...S.hot.questions.map((q) => q.text), ...S.full.paragraphs.map((p) => p.text), ...S.hot.paragraphs.slice(0, 1500).map((p) => p.text),
  'Café naïve — “quotes” and 東京 tokens, e-mail@x.com, $5.00 & 100% <tag> ~ ^ ` | {braces} ¿Qué? ﬁ ligature \u0007bell'];
let same = 0; const bad = [];
for (const t of texts) { const a = WP.tokenize(t, vocab), b = Array.from(tok(t, { add_special_tokens: false }).input_ids.data, Number); if (a.length === b.length && a.every((x, i) => x === b[i])) same++; else if (bad.length < 3) bad.push({ t: t.slice(0, 100), a: a.slice(0, 30), b: b.slice(0, 30) }); }
console.log(`${same} of ${texts.length} identical`); for (const x of bad) console.log(JSON.stringify(x));
