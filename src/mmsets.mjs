// DocDec · src/mmsets.mjs — the sets the Memory Model is tested on, fixed by rule from the data file's own order. Pure.
//
// The Memory Model (PREREG.md, addendum 3): a small model is trained on a fixed corpus and answers from its weights;
// a frozen larger model questions it and writes the answer. To test that against retrieval, four things must be fixed
// before any model sees anything, and none of them may be hand-picked:
//   answerable   questions whose two source paragraphs are both in the corpus
//   unanswerable questions none of whose source paragraphs is anywhere in the corpus: the right reply is a refusal
//   foreign      paragraphs kept wholly outside the corpus, used ONLY to make training examples of refusing
//   noise        as many plausible distractor paragraphs as the corpus has, taken from the questions' own
//                annotated distractors: the corpus, doubled
// Every question is multi-hop (HotpotQA): its answer needs two paragraphs. Rows are read in file order from a start
// index. A row that is not usable is skipped and counted with its reason; nothing else decides membership.
//
//   row     { id, question, answer, type, titles: [10], texts: [10], gold: [2] }   one HotpotQA row, already unpacked
//   usable(row)            → null when usable, else the reason it is not
//   plan(rows, opt)        → { answerable, unanswerable, foreign, corpus, noise, skipped, counts }
//                            opt: { start, answerable, unanswerable, foreign, perQuestion }
//   check(set)             → the list of rule breaks in a built set ([] when it holds): what CI re-checks
const str = (x) => (typeof x === 'string' ? x : '');
const arr = (x) => (Array.isArray(x) ? x : []);
const int = (x, d) => (Number.isInteger(x) && x >= 0 ? x : d);

// norm(text) → the text as it is compared: lowercased, punctuation to spaces, articles dropped, one space between words
export function norm(text) {
  return str(text).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w && w !== 'a' && w !== 'an' && w !== 'the').join(' ');
}
// holds(text, answer) → true when the answer's words appear in the text, in order, as whole words
export function holds(text, answer) {
  const a = norm(answer);
  return a !== '' && (' ' + norm(text) + ' ').includes(' ' + a + ' ');
}
export const YESNO = ['yes', 'no'];

export function usable(row) {
  const titles = arr(row && row.titles).map(str), texts = arr(row && row.texts).map(str), gold = [...new Set(arr(row && row.gold).map(str))];
  if (str(row && row.id) === '' || str(row && row.question).trim() === '') return 'no id or no question';
  if (titles.length === 0 || titles.length !== texts.length) return 'paragraphs and titles do not pair up';
  if (new Set(titles).size !== titles.length) return 'a title is carried twice';
  if (gold.length !== 2) return 'not exactly two source paragraphs';
  if (!gold.every((t) => titles.includes(t))) return 'a source paragraph is not among its paragraphs';
  if (titles.some((t) => t.trim() === '') || texts.some((t) => t.trim() === '')) return 'an empty title or paragraph';
  const answer = norm(row.answer);
  if (answer === '') return 'no answer';
  if (!YESNO.includes(answer) && !gold.some((t) => holds(texts[titles.indexOf(t)], row.answer))) return 'the answer is not word for word in a source paragraph';
  return null;
}

const para = (row, title) => ({ id: title, title, text: str(row.texts[row.titles.indexOf(title)]) });
const ask = (row) => ({ qid: str(row.id), text: str(row.question).trim(), answer: str(row.answer).trim(), type: str(row.type), gold: [...new Set(row.gold.map(str))] });

export function plan(rows, opt) {
  const R = arr(rows), start = int(opt && opt.start, 0), want = { answerable: int(opt && opt.answerable, 0), unanswerable: int(opt && opt.unanswerable, 0), foreign: int(opt && opt.foreign, 0) }, per = int(opt && opt.perQuestion, 2);
  const out = { answerable: [], unanswerable: [], foreign: [], corpus: [], noise: [], skipped: [] };
  const inCorpus = new Set(), barred = new Set(), text = new Map(), took = [];
  let clash = 0;
  const same = (p) => { if (text.has(p.id) && text.get(p.id) !== p.text) clash++; text.set(p.id, p.text); };
  let i = start;
  for (; i < R.length && (out.answerable.length < want.answerable || out.unanswerable.length < want.unanswerable || out.foreign.length < want.foreign); i++) {
    const row = R[i], why = usable(row);
    if (why) { out.skipped.push({ row: i, why }); continue; }
    const q = ask(row), golds = q.gold.map((t) => para(row, t));
    if (out.answerable.length < want.answerable) {
      // an answerable question: its two source paragraphs join the corpus
      for (const p of golds) { same(p); if (!inCorpus.has(p.id)) { inCorpus.add(p.id); out.corpus.push(p); } }
      out.answerable.push(q); took.push(row);
    } else {
      // kept outside the corpus: no source paragraph of it may be in the corpus, or be another outside question's
      if (q.gold.some((t) => inCorpus.has(t))) { out.skipped.push({ row: i, why: 'a source paragraph is already in the corpus' }); continue; }
      if (q.gold.some((t) => barred.has(t))) { out.skipped.push({ row: i, why: 'a source paragraph belongs to another question kept outside the corpus' }); continue; }
      for (const p of golds) { same(p); barred.add(p.id); }
      if (out.unanswerable.length < want.unanswerable) out.unanswerable.push(q);
      else out.foreign.push({ ...q, paragraphs: golds });
    }
  }
  // the noise: pass by pass over the answerable questions, each giving its next annotated distractor that is not in
  // the corpus, not already noise, and not a paragraph kept outside; until the noise is as large as the corpus
  // (a question's own sources are in the corpus, so the corpus test leaves them out too)
  const isNoise = new Set(), next = took.map(() => 0);
  for (let pass = 0, added = true; added; pass++) {
    added = false;
    for (let k = 0; k < took.length; k++) {
      const row = took[k];
      let got = 0;
      while (out.noise.length < out.corpus.length && next[k] < row.titles.length && got < (pass === 0 ? per : 1)) {
        const t = str(row.titles[next[k]++]);
        if (inCorpus.has(t) || isNoise.has(t) || barred.has(t)) continue;
        const p = para(row, t); same(p); isNoise.add(t); out.noise.push(p); got++; added = true;
      }
    }
  }
  out.counts = { read: i - start, answerable: out.answerable.length, unanswerable: out.unanswerable.length, foreign: out.foreign.length, corpus: out.corpus.length, noise: out.noise.length, skipped: out.skipped.length, titleClashes: clash, full: out.answerable.length === want.answerable && out.unanswerable.length === want.unanswerable && out.foreign.length === want.foreign && out.noise.length === out.corpus.length };
  return out;
}

export function check(set) {
  const bad = [], S = set && typeof set === 'object' ? set : {};
  const corpus = new Set(arr(S.corpus).map((p) => p && p.id)), noise = new Set(arr(S.noise).map((p) => p && p.id));
  const outside = new Set([...arr(S.unanswerable).flatMap((q) => arr(q && q.gold)), ...arr(S.foreign).flatMap((q) => arr(q && q.gold))]);
  if (corpus.size !== arr(S.corpus).length) bad.push('a paragraph is in the corpus twice');
  if (noise.size !== arr(S.noise).length) bad.push('a paragraph is in the noise twice');
  for (const t of noise) if (corpus.has(t)) bad.push(`"${t}" is both corpus and noise`);
  for (const t of outside) { if (corpus.has(t)) bad.push(`"${t}" is kept outside and is in the corpus`); if (noise.has(t)) bad.push(`"${t}" is kept outside and is in the noise`); }
  for (const q of arr(S.answerable)) for (const t of arr(q && q.gold)) if (!corpus.has(t)) bad.push(`"${t}", a source of an answerable question, is not in the corpus`);
  const seen = new Set();
  for (const q of [...arr(S.answerable), ...arr(S.unanswerable), ...arr(S.foreign)]) { const id = q && q.qid; if (seen.has(id)) bad.push(`question ${id} is in two sets`); seen.add(id); }
  const u = new Set(arr(S.unanswerable).flatMap((q) => arr(q && q.gold)));
  for (const q of arr(S.foreign)) for (const t of arr(q && q.gold)) if (u.has(t)) bad.push(`"${t}" is a source of both an unanswerable question and a foreign one`);
  if (arr(S.noise).length !== arr(S.corpus).length) bad.push(`the noise (${arr(S.noise).length}) is not the size of the corpus (${arr(S.corpus).length})`);
  return bad;
}

export default { norm, holds, YESNO, usable, plan, check };
