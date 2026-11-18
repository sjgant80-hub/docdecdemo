import test from 'node:test';
import assert from 'node:assert/strict';
import WP from '../src/wordpiece.mjs';

const V = WP.vocabFrom(['[PAD]', '[unused0]', '[unused1]', '[UNK]', 'the', 'norm', '##ans', '##and', '##y', 'cafe', 'naive', ',', '.', '?', '$', '5', '00', '東', '京', 'e', '-', 'mail', 'un', '##aff', '##able', 'x\r', 'x'].join('\n') + '\n');
const id = (p) => V.get(p);

test('vocabFrom: line numbers are ids; blank lines and repeats are skipped; CR is dropped', () => {
  assert.equal(V.get('[PAD]'), 0); assert.equal(V.get('the'), 4); assert.equal(V.get('x'), 25, '"x\\r" read as "x" first');
  assert.equal(WP.vocabFrom('a\n\nb\na').get('b'), 2);
  assert.equal(WP.vocabFrom('a\n\nb\na').get('a'), 0);
  assert.equal(WP.vocabFrom(null).size, 0);
});

test('character classes', () => {
  assert.equal(WP.isCJK('東'.codePointAt(0)), true); assert.equal(WP.isCJK(0x4e00), true); assert.equal(WP.isCJK(0x9fff), true); assert.equal(WP.isCJK(0x4dff), false);
  assert.equal(WP.isCJK(0x2fa1f), true); assert.equal(WP.isCJK(0x2fa20), false); assert.equal(WP.isCJK('a'.codePointAt(0)), false);
  for (const c of ['!', '/', ':', '@', '[', '`', '{', '~', '—', '¿', '“', '$', '+', '<', '=', '>', '^', '|']) assert.equal(WP.isPunct(c), true, c);
  assert.equal(WP.isPunct('$$'), false, 'one character at a time');
  for (const c of ['€', '©', '°']) assert.equal(WP.isPunct(c), false, c + ' is a symbol, not punctuation, outside ASCII');
  for (const c of ['a', '0', ' ', ' ', 'é']) assert.equal(WP.isPunct(c), false, c);
  assert.equal(WP.isPunct(' '), false); assert.equal(WP.isPunct(' '.slice(0)), false);
  assert.equal(WP.isPunct(String.fromCharCode(32)), false); assert.equal(WP.isPunct(String.fromCharCode(48)), false); assert.equal(WP.isPunct(String.fromCharCode(65)), false);
  assert.equal(WP.isPunct(String.fromCharCode(97)), false); assert.equal(WP.isPunct(String.fromCharCode(127)), false);
  assert.equal(WP.isControl('\t'), false); assert.equal(WP.isControl('\n'), false); assert.equal(WP.isControl('\r'), false);
  assert.equal(WP.isControl(String.fromCharCode(7)), true); assert.equal(WP.isControl(String.fromCodePoint(0xf8ff)), true, 'private use');
  assert.equal(WP.isControl('a'), false);
  assert.equal(WP.isSpace(String.fromCharCode(0x3000)), true); assert.equal(WP.isSpace('a'), false);
});

test('normalize: control characters dropped, whitespace to spaces, CJK spaced, accents stripped, lowercased', () => {
  assert.equal(WP.normalize('Café  Naïve'), 'cafe  naive');
  assert.equal(WP.normalize('a\tb\nc'), 'a b c');
  assert.equal(WP.normalize('x' + String.fromCharCode(7) + 'y'), 'xy');
  assert.equal(WP.normalize('x\u0000y'.replace('\\u0000', String.fromCharCode(0))), 'xy');
  assert.equal(WP.normalize('x' + String.fromCharCode(0xfffd) + 'y'), 'xy');
  assert.equal(WP.normalize('東京'), ' 東  京 ');
  assert.equal(WP.normalize(null), '');
});

test('split: whitespace and every punctuation character', () => {
  assert.deepEqual(WP.split('e-mail, $5.00?'), ['e', '-', 'mail', ',', '$', '5', '.', '00', '?']);
  assert.deepEqual(WP.split('  a  b '), ['a', 'b']);
  assert.deepEqual(WP.split('..'), ['.', '.']);
  assert.deepEqual(WP.split(''), []);
});

test('wordpiece: longest match first, ## on continuations, [UNK] for the unmatchable or the over-long', () => {
  assert.deepEqual(WP.wordpiece('normans', V, '[UNK]'), ['norm', '##ans']);
  assert.deepEqual(WP.wordpiece('normandy', V, '[UNK]'), ['norm', '##and', '##y']);
  assert.deepEqual(WP.wordpiece('unaffable', V, '[UNK]'), ['un', '##aff', '##able']);
  assert.deepEqual(WP.wordpiece('normq', V, '[UNK]'), ['[UNK]'], 'one unmatched piece makes the whole word unknown');
  assert.deepEqual(WP.wordpiece('x'.repeat(101), V, '[UNK]'), ['[UNK]']);
  assert.deepEqual(WP.wordpiece('x'.repeat(100), WP.vocabFrom('x\n##x'), '[UNK]').length, 100, '100 characters is still a word');
  assert.deepEqual(WP.wordpiece('', V, '[UNK]'), []);
  assert.deepEqual(WP.wordpiece('abq', new Map([['ab', 0], ['##', 1]]), '[UNK]'), ['[UNK]'], 'a bare "##" in the vocabulary never matches an empty piece');
});

test('tokenize / queryIds', () => {
  assert.deepEqual(WP.tokenize('The Normans, naïve?', V), [id('the'), id('norm'), id('##ans'), id(','), id('naive'), id('?')]);
  assert.deepEqual(WP.tokenize('zzz', V), [id('[UNK]')]);
  assert.deepEqual(WP.tokenize('the', null), [undefined], 'no vocabulary: nothing is known');
  const q = WP.queryIds('the normans', V, { query_length: 8, query_prefix_id: 1, mask_token_id: 103 });
  assert.deepEqual(q.ids, [101, 1, id('the'), id('norm'), id('##ans'), 102, 103, 103]);
  assert.deepEqual(q.mask, [1, 1, 1, 1, 1, 1, 0, 0]);
  const long = WP.queryIds('the '.repeat(40), V, { query_length: 8, query_prefix_id: 1, mask_token_id: 103 });
  assert.equal(long.ids.length, 8); assert.equal(long.ids[7], 102, 'cut to fit, [SEP] kept last');
  const d = WP.queryIds('the', V);
  assert.equal(d.ids.length, 32); assert.equal(d.ids[1], 1); assert.equal(d.ids[31], 103, 'defaults: 32 long, [Q] = 1, [MASK] = 103');
  assert.equal(WP.queryIds('the', V, { query_length: 3 }).ids.length, 3, 'a query length of 3 keeps [CLS] [Q] [SEP]');
});
