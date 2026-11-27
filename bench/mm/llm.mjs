// bench/mm/llm.mjs — the bench's three doors to local models, each on 127.0.0.1 only:
//   generate(model, prompt, options)   Ollama, cached by (model, options, prompt): a run resumes, and re-reads cost nothing
//   embed(text)                        Ollama embeddings (nomic-embed-text), cached
//   memory(port)                       the trained memory behind the-distillation's local door (py/serve.py)
// Every call's host is 127.0.0.1; nothing here can reach another machine.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request } from 'node:http';
import { createHash } from 'node:crypto';
import { EMBED_MODEL, MEMORY_SYSTEM, MEMORY_TOKENS } from './prompts.mjs';

const HERE = dirname(fileURLToPath(import.meta.url)), DIR = join(HERE, '..', 'cache');
mkdirSync(DIR, { recursive: true });
const files = { gen: join(DIR, 'mm-llm-cache.json'), emb: join(DIR, 'mm-embed-cache.json') };
const caches = { gen: existsSync(files.gen) ? JSON.parse(readFileSync(files.gen, 'utf8')) : {}, emb: existsSync(files.emb) ? JSON.parse(readFileSync(files.emb, 'utf8')) : {} };
let dirty = { gen: 0, emb: 0 };
export const save = () => { for (const k of ['gen', 'emb']) if (dirty[k]) { writeFileSync(files[k], JSON.stringify(caches[k])); dirty[k] = 0; } };
const key = (...parts) => createHash('sha1').update(parts.join('\u0000')).digest('hex');

function post(port, path, body) {
  const text = JSON.stringify(body);
  return new Promise((ok, no) => {
    const r = request({ host: '127.0.0.1', port, path, method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) } }, (res) => {
      let b = ''; res.setEncoding('utf8'); res.on('data', (c) => (b += c)); res.on('end', () => { try { ok(JSON.parse(b)); } catch (e) { no(new Error(`${path}: not JSON (${b.slice(0, 120)})`)); } });
    });
    r.on('error', no); r.setTimeout(0); r.end(text);
  });
}
const again = async (f, tries = 3) => { let last; for (let i = 0; i < tries; i++) { try { return await f(); } catch (e) { last = e; await new Promise((ok) => setTimeout(ok, 2000 * (i + 1))); } } throw last; };

export async function generate(model, prompt, options) {
  const k = key(model, JSON.stringify(options), prompt);
  if (caches.gen[k]) return { ...caches.gen[k], cached: true };
  const t0 = Date.now(), r = await again(() => post(11434, '/api/generate', { model, prompt, stream: false, options }));
  if (typeof r.response !== 'string') throw new Error(`the model gave no text: ${JSON.stringify(r).slice(0, 200)}`);
  const out = { raw: r.response, ms: Date.now() - t0 };
  caches.gen[k] = out; if (++dirty.gen >= 10) save();
  return { ...out, cached: false };
}

export async function embed(text) {
  const k = key(EMBED_MODEL, text);
  if (caches.emb[k]) return caches.emb[k];
  const r = await again(() => post(11434, '/api/embeddings', { model: EMBED_MODEL, prompt: text }));
  if (!Array.isArray(r.embedding)) throw new Error('no embedding came back');
  caches.emb[k] = r.embedding.map((x) => Math.round(x * 1000) / 1000); if (++dirty.emb >= 20) save();
  return caches.emb[k];
}

// memory(port) → ask(question) → the memory's raw reply: the fixed system line, then the question and nothing else
export const memory = (port) => async (question) => {
  const r = await again(() => post(port, '/ask', { messages: [{ role: 'system', content: MEMORY_SYSTEM }, { role: 'user', content: question }], max_tokens: MEMORY_TOKENS }));
  if (typeof r.text !== 'string') throw new Error(`the memory gave no text: ${JSON.stringify(r).slice(0, 200)}`);
  return r.text;
};
