// bench/reader.mjs — the L4 reader, on the local model (qwen2.5:7b through Ollama, temperature 0, fixed seed).
// It is asked to COPY the answering phrase from the passage, or say NONE. It never supplies an answer of its own: the
// gate (src/gate.mjs) keeps a phrase only if it is found word for word in the cited source, and refuses otherwise.
// Prompts are frozen here (PREREG.md §3). Every call is cached under bench/cache/reader-cache.json, so a run resumes
// and anyone re-running with the same model build gets the same raw outputs.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request } from 'node:http';
import { createHash } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE = join(HERE, 'cache', 'reader-cache.json');
export const READER_MODEL = 'qwen2.5:7b';
export const READER_OPTIONS = { temperature: 0, seed: 7, num_ctx: 4096, num_predict: 48 };
const cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : {};
let dirty = 0;
export const save = () => { writeFileSync(CACHE, JSON.stringify(cache)); dirty = 0; };

export const PROMPT_ONE = (passage, question) => `Read the passage and answer the question.
Rules: If the passage states the answer, reply with the shortest exact phrase copied from the passage. If the passage does not contain the answer, reply exactly NONE. Reply with the phrase or NONE only.

Passage:
${passage}

Question: ${question}
Answer:`;

export const PROMPT_TWO = (p1, p2, question) => `Read the two passages and answer the question. The answer may need facts from both passages.
Rules: Reply with a short answer: an exact phrase copied from a passage, or yes or no if the question asks yes or no. If the passages do not contain the answer, reply exactly NONE. Reply with the answer only.

Passage 1 (${p1.title}):
${p1.text}

Passage 2 (${p2.title}):
${p2.text}

Question: ${question}
Answer:`;

export const PROMPT_PARAPHRASE = (question) => `Rewrite the question below with different wording but exactly the same meaning. Keep every name, number and date. Reply with the rewritten question only.
Question: ${question}`;

function generate(prompt, options) {
  const body = JSON.stringify({ model: READER_MODEL, prompt, stream: false, options });
  return new Promise((ok, no) => {
    const r = request('http://127.0.0.1:11434/api/generate', { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, (res) => {
      let b = ''; res.setEncoding('utf8'); res.on('data', (c) => (b += c)); res.on('end', () => { try { ok(JSON.parse(b)); } catch (e) { no(e); } });
    });
    r.on('error', no); r.setTimeout(0); r.end(body);
  });
}

// ask(prompt, options) → { raw, ms, cached } — the model's raw text, cached by (model, options, prompt)
export async function ask(prompt, options = READER_OPTIONS) {
  const k = createHash('sha1').update(READER_MODEL + JSON.stringify(options) + prompt).digest('hex');
  if (cache[k]) return { ...cache[k], cached: true };
  const t0 = Date.now();
  const j = await generate(prompt, options);
  if (typeof j.response !== 'string') throw new Error('reader: no response ' + JSON.stringify(j).slice(0, 200));
  cache[k] = { raw: j.response, ms: Date.now() - t0 };
  if (++dirty >= 10) save();
  return { ...cache[k], cached: false };
}
