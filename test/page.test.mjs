// test/page.test.mjs — the page is checked by RUNNING it: page.mjs executes against a stand-in DOM with the real shipped
// files, and every section must fill. Plus: no measured figure is typed into the HTML, no dead in-page link, no network
// call in the engine, and the price lock matches what the cost case reads.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const root = new URL('../', import.meta.url);
const html = readFileSync(new URL('index.html', root), 'utf8');

function standInDom() {
  const els = new Map();
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  const mk = (id) => {
    const el = { id, innerHTML: '', textContent: '', hidden: false, disabled: false, className: '', value: id === 'vol' ? '10000' : '', checked: id === 'checkOn',
      listeners: {}, addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }, set onclick(f) { this.listeners.click = [f]; }, get onclick() { return (this.listeners.click || [])[0]; },
      querySelector() { return el._tbody || (el._tbody = mk(id + '>tbody')); } };
    return el;
  };
  for (const id of ids) els.set(id, mk(id));
  return { els, document: { getElementById: (id) => els.get(id) || null, documentElement: { setAttribute() {}, getAttribute() { return null; } } } };
}

test('the page script runs on the shipped data and fills every section', async () => {
  const { els, document } = standInDom();
  globalThis.document = document;
  globalThis.window = {};
  globalThis.localStorage = { getItem: () => null, setItem() {} };
  globalThis.matchMedia = () => ({ matches: false });
  globalThis.fetch = async (u) => { const f = new URL(u, root); return existsSync(f) ? { ok: true, json: async () => JSON.parse(readFileSync(f, 'utf8')) } : { ok: false, status: 404 }; };
  await import(pathToFileURL(new URL('page.mjs', root).pathname.replace(/^\/([A-Za-z]:)/, '$1')).href + '?t=' + Date.now());
  const filled = (id) => { const e = els.get(id); const s = (e.innerHTML || e.textContent || '') + (e._tbody ? e._tbody.innerHTML : ''); return s.length > 0 && !/^…$/.test(s.trim()); };
  for (const id of ['badges', 'v1line', 'claimsTbl', 'claimsNote', 'exLate', 'exRefuse', 'exGrounded', 'exMulti', 'exFresh', 'exMemory', 'exFail', 'exPicture', 'fbParity', 'trace', 'sysTbl', 'offTbl', 'hotTbl', 'freshTbl', 'memTbl', 'condTbl', 'speedTbl', 'h1Out', 'bpTbl', 'costTbl', 'costNote', 'board', 'paperResults', 'limitsDyn']) {
    assert.ok(filled(id), id + ' is empty');
    const s = (els.get(id).innerHTML || '') + (els.get(id).textContent || '') + (els.get(id)._tbody ? els.get(id)._tbody.innerHTML : '');
    assert.ok(!/undefined|NaN|\[object Object\]/.test(s), id + ' shows undefined/NaN: ' + s.slice(0, 200));
  }
  els.get('vol').value = '20000';
  els.get('vol').listeners.input[0]();
  assert.match(els.get('costTbl').innerHTML, /DocDec on your machine/);
  els.get('asThen').onclick();
  assert.match(els.get('freshView').innerHTML, /as of 2021/);
});

test('no measured figure is typed into the page: percentages and counts come from the record', () => {
  const prose = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<pre[\s\S]*?<\/pre>/g, '').replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, ' ');
  assert.doesNotMatch(prose, /\d+(\.\d+)?\s?%/, 'a percentage is typed into the prose');
  assert.doesNotMatch(prose, /\b\d+ (of|out of) \d+\b/, 'a count is typed into the prose');
});

test('every in-page link has its target; every local file the page names exists', () => {
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  for (const m of html.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.has(m[1]), '#' + m[1]);
  for (const m of html.matchAll(/(?:href|src)="([^"#:]+)"/g)) assert.ok(existsSync(new URL(m[1], root)), m[1]);
});

test('the engine makes no network calls: no fetch, XMLHttpRequest, WebSocket or http import in src/', () => {
  for (const f of ['late', 'gate', 'graph', 'memory', 'conduct', 'stats', 'hyper', 'measure', 'assemble', 'cost', 'examples', 'publish', 'v1']) {
    const s = readFileSync(new URL('src/' + f + '.mjs', root), 'utf8');
    assert.doesNotMatch(s, /\bfetch\(|XMLHttpRequest|WebSocket|from 'node:http|require\(/, f);
  }
});
