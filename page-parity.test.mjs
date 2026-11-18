// Holds the demo honest: the grounding kernel inlined in v1.html is byte-for-byte the one in kernel.mjs
// (which is itself byte-identical to the mutation-gated engine kernel). Live logic == proven logic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (f) => readFileSync(new URL('./' + f, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('v1.html inlines kernel.mjs byte-for-byte (tokens … route, top1, evaluate)', () => {
  const kernel = read('kernel.mjs'), page = read('v1.html');
  const start = kernel.indexOf('const arr =');
  const body = kernel.slice(start, kernel.indexOf('export default')).replace(/export function/g, 'function').trimEnd();
  assert.ok(body.length > 1500, 'kernel body extracted');
  assert.ok(body.includes('function evaluate('), 'the metrics function is part of the pinned kernel');
  assert.ok(page.includes(body), 'the exact kernel.mjs source (minus export) must appear verbatim in v1.html');
});

test("the page's live cosine is byte-identical to rerun.mjs's (so the page's verdicts and the re-run agree)", () => {
  const rerun = read('rerun.mjs'), page = read('v1.html');
  const line = rerun.split('\n').find((l) => l.startsWith('export function cosine('));
  assert.ok(line, 'rerun.mjs cosine found');
  assert.ok(page.includes(line.replace('export function', 'function')), 'page cosine must equal rerun.mjs cosine');
});

test('the free box routes on the measured free-box gate, not the benchmark gate', () => {
  const page = read('v1.html');
  assert.ok(page.includes('route(tokens(t),DOCS,IDF,DATA.freeGate)'));
  assert.ok(!page.includes('{minScore:DATA.gate.minScore,margin:DATA.gate.margin}'), 'the old free-box gate is gone');
});

test('the kernel still routes and abstains (a live smoke test of the inlined logic)', async () => {
  const K = await import('./kernel.mjs');
  const docs = [{ id: 'd1', terms: K.tokens('the Normans settled in Normandy in France') }, { id: 'd2', terms: K.tokens('oxygen is a chemical element') }];
  const idf = K.idf(docs);
  assert.equal(K.route(K.tokens('where did the Normans settle'), docs, idf, { minScore: 1 }).answer, 'd1');
  assert.equal(K.route(K.tokens('what is the capital of Peru'), docs, idf, { minScore: 1 }).abstain, true);
  assert.ok(!('abstain' in K.top1([{ id: 'x', score: 0.1 }]))); // RAG baseline never abstains with a non-empty index
  const m = K.evaluate([{ qid: 'a', answer: 'd1' }, { qid: 'b', abstain: true }], [{ qid: 'a', goldId: 'd1', impossible: false }, { qid: 'b', goldId: null, impossible: true }]);
  assert.equal(m.recall, 1); assert.equal(m.groundedAbstention, 1);
});
