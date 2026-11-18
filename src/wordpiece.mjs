// DocDec v2 · src/wordpiece.mjs — the ColBERT model's tokenizer (BERT uncased WordPiece), pure, so the page can turn a
// typed question into exactly the token ids the model was trained on, with no tokenizer library. Its output is
// checked id for id against the model's own tokenizer.json (via transformers.js) on thousands of real texts
// (bench/parity-web.mjs → data/v2/parity.json).
//   normalise: drop control characters, whitespace → space, space around CJK ideographs, strip accents, lowercase
//   split:     on whitespace, and every punctuation character is its own token
//   wordpiece: greedy longest match from the left, continuation pieces prefixed "##"; no match → [UNK]

const str = (x) => (typeof x === 'string' ? x : '');
const CJK = [[0x4e00, 0x9fff], [0x3400, 0x4dbf], [0x20000, 0x2a6df], [0x2a700, 0x2b73f], [0x2b740, 0x2b81f], [0x2b820, 0x2ceaf], [0xf900, 0xfaff], [0x2f800, 0x2fa1f]];
export const isCJK = (cp) => CJK.some(([a, b]) => cp >= a && cp <= b);
// every "Other" category (control, format, private use, unassigned, surrogate) is dropped, as the model's tokenizer does
export const isControl = (ch) => ch !== '\t' && ch !== '\n' && ch !== '\r' && /\p{C}/u.test(ch);
export const isSpace = (ch) => /\s/u.test(ch);
// punctuation = Unicode punctuation, plus the nine ASCII characters BERT counts as punctuation that Unicode calls symbols
export const isPunct = (ch) => /^[$+<=>^`|~]$/.test(ch) || /\p{P}/u.test(ch);

// normalize(text) → the BertNormalizer's output (clean text, CJK spacing, accents stripped, lowercase)
export function normalize(text) {
  let out = '';
  for (const ch of str(text)) {
    const cp = ch.codePointAt(0);
    if (cp === 0 || cp === 0xfffd || isControl(ch)) continue;
    if (isSpace(ch)) { out += ' '; continue; }
    out += isCJK(cp) ? ' ' + ch + ' ' : ch;
  }
  return out.normalize('NFD').replace(/\p{Mn}/gu, '').toLowerCase();
}

// split(text) → the BertPreTokenizer's words: whitespace-separated, every punctuation character on its own
export function split(text) {
  const words = [];
  let cur = '';
  for (const ch of str(text)) {
    if (isSpace(ch)) { if (cur) words.push(cur); cur = ''; continue; }
    if (isPunct(ch)) { if (cur) words.push(cur); words.push(ch); cur = ''; continue; }
    cur += ch;
  }
  if (cur) words.push(cur);
  return words;
}

// wordpiece(word, vocab, unk) → the pieces of one word: longest match first, "##" on every piece after the first
export function wordpiece(word, vocab, unk) {
  const chars = [...str(word)];
  if (chars.length > 100) return [unk];
  const out = [];
  let start = 0;
  while (start < chars.length) {
    let end = chars.length, piece = null;
    while (start < end) {
      const sub = (start > 0 ? '##' : '') + chars.slice(start, end).join('');
      if (vocab.has(sub)) { piece = sub; break; }
      end--;
    }
    if (piece === null) return [unk];
    out.push(piece);
    start = end;
  }
  return out;
}

// tokenize(text, vocab) → token ids (no [CLS]/[SEP]); vocab: Map(piece → id) built from the model's vocab.txt
export function tokenize(text, vocab) {
  const v = vocab instanceof Map ? vocab : new Map();
  const ids = [];
  for (const w of split(normalize(text))) for (const p of wordpiece(w, v, '[UNK]')) ids.push(v.has(p) ? v.get(p) : v.get('[UNK]'));
  return ids;
}

// vocabFrom(text) → Map(piece → line number) from vocab.txt's contents
export function vocabFrom(text) {
  const m = new Map();
  str(text).split('\n').forEach((line, i) => { const t = line.replace(/\r$/, ''); if (t.length > 0 && !m.has(t)) m.set(t, i); });
  return m;
}

// queryIds(text, vocab, cfg) → the ColBERT query input: [CLS] [Q] pieces… [SEP], padded with [MASK] to the query length;
// the mask attends to the real tokens only (expansion tokens get vectors but are not attended to), as in bench/colbert.mjs
export function queryIds(text, vocab, cfg) {
  const c = cfg || {};
  const len = Number.isInteger(c.query_length) ? c.query_length : 32;
  const ids = [101, Number.isInteger(c.query_prefix_id) ? c.query_prefix_id : 1, ...tokenize(text, vocab).slice(0, len - 3), 102];
  const mask = ids.map(() => 1);
  while (ids.length < len) { ids.push(Number.isInteger(c.mask_token_id) ? c.mask_token_id : 103); mask.push(0); }
  return { ids, mask };
}

export default { isCJK, isControl, isSpace, isPunct, normalize, split, wordpiece, tokenize, vocabFrom, queryIds };
