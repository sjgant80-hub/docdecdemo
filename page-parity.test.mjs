// Holds the demo honest: the grounding kernel inlined in index.html is byte-for-byte the one in kernel.mjs
// (which is itself byte-identical to the mutation-gated engine kernel). Live logic == proven logic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('index.html inlines kernel.mjs byte-for-byte', () => {
  const kernel = readFileSync(new URL('./kernel.mjs', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const page = readFileSync(new URL('./index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const start = kernel.indexOf('const arr =');
  const endMark = 'export default { tokens, idf, score, route, top1 };';
  const body = kernel.slice(start, kernel.indexOf(endMark)).replace(/export function/g, 'function').trimEnd();
  assert.ok(body.length > 1500, 'kernel body extracted');
  assert.ok(page.includes(body), 'the exact kernel.mjs source (minus export) must appear verbatim in index.html');
});

test('the kernel still routes and abstains (a live smoke test of the inlined logic)', async () => {
  const K = await import('./kernel.mjs');
  const docs = [{ id: 'd1', terms: K.tokens('the Normans settled in Normandy in France') }, { id: 'd2', terms: K.tokens('oxygen is a chemical element') }];
  const idf = K.idf(docs);
  assert.equal(K.route(K.tokens('where did the Normans settle'), docs, idf, { minScore: 1 }).answer, 'd1');
  assert.equal(K.route(K.tokens('what is the capital of Peru'), docs, idf, { minScore: 1 }).abstain, true);
  assert.ok(!('abstain' in K.top1([{ id: 'x', score: 0.1 }]))); // RAG baseline never abstains with a non-empty index
});
