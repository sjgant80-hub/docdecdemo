// DocDec · src/mmtrain.mjs — what the Memory Model may be trained on. Pure. PREREG.md, addendum 3, section 9.3.
//
// A generator model writes question-and-answer pairs from the corpus's paragraphs. Nothing it writes is trusted.
// Code decides, by exact rules, which pairs are grounded in their source; which refusal examples are added; and
// which training questions must be struck because they are, or nearly are, a test question.
//
//   grounded(pair, sources)       → null when the pair may be trained on, else the reason it is dropped
//       pair { question, answer, kind }     kind: 'fact' | 'title' | 'two'      sources: the paragraph(s) it was written from
//   keep(pairs)                   → { kept, dropped: { reason: count } }   pairs: [{ question, answer, kind, sources }], in order
//   refusals(grounded, foreign)   → the refusal examples: one for every three grounded pairs, the first in order
//   guard(training, tests)        → { kept, struck }: training questions equal to a test question, or sharing at
//                                   least 80% of their distinct words with one, are struck
//   overlap(a, b)                 → the share of distinct words two questions have in common (Jaccard)
//   integrity(files, tests, corpora, outside, inputs) → the three counts claim K5 is ruled on
import { norm, holds, YESNO } from './mmsets.mjs';
import { entityName } from './graph.mjs';

const str = (x) => (typeof x === 'string' ? x : '');
const arr = (x) => (Array.isArray(x) ? x : []);
const get = (o, k) => { try { return o == null ? undefined : o[k]; } catch { return undefined; } };

export const REFUSAL = 'not in the documents';
export const LIMITS = { questionWords: 40, answerWords: 12, nearOverlap: 0.8, refusalEvery: 3 };
export const POINTING = ['passage', 'paragraph', 'text'];        // a question that points at its own source cannot stand alone
export const KINDS = ['fact', 'title', 'two'];
const words = (s) => (norm(s) === '' ? [] : norm(s).split(' '));
const count = (s) => str(s).trim().split(/\s+/).filter(Boolean).length;

// the rules every training question must keep, whatever its answer: → null, or the reason
function askable(question) {
  if (norm(question) === '') return 'no question';
  if (count(question) > LIMITS.questionWords) return 'the question is over 40 words';
  if (words(question).some((w) => POINTING.includes(w))) return 'the question points at the passage, the paragraph or the text';
  return null;
}

export function grounded(pair, sources) {
  const q = str(get(pair, 'question')), a = str(get(pair, 'answer')), kind = get(pair, 'kind'), S = arr(sources).filter((s) => str(get(s, 'text')) !== '');
  if (!KINDS.includes(kind)) return 'not a kind of pair this gate knows';
  const ask = askable(q);
  if (ask) return ask;
  if (norm(a) === '') return 'no answer';
  if (count(a) > LIMITS.answerWords) return 'the answer is over 12 words';
  if (S.length !== (kind === 'two' ? 2 : 1)) return 'the pair does not come with its source';
  if (kind === 'two' && YESNO.includes(norm(a))) return null;
  if (S.some((s) => holds(s.text, a))) return null;
  if (S.some((s) => norm(a) === norm(get(s, 'title')) || (norm(entityName(get(s, 'title'))) !== '' && norm(a) === norm(entityName(get(s, 'title')))))) return null;
  return 'the answer is not word for word in its source, and is not its title';
}

export function keep(pairs) {
  const kept = [], dropped = {}, seen = new Set(), drop = (why) => { dropped[why] = (dropped[why] || 0) + 1; };
  for (const p of arr(pairs)) {
    const why = grounded(p, get(p, 'sources'));
    if (why) { drop(why); continue; }
    const key = norm(p.question);
    if (seen.has(key)) { drop('a repeat of an earlier question'); continue; }
    seen.add(key);
    kept.push({ question: p.question.trim(), answer: p.answer.trim(), kind: p.kind, sources: arr(p.sources).map((s) => str(get(s, 'id'))) });
  }
  return { kept, dropped };
}

export function refusals(groundedPairs, foreign) {
  const want = Math.floor(arr(groundedPairs).length / LIMITS.refusalEvery), taken = new Set(arr(groundedPairs).map((p) => norm(get(p, 'question')))), out = [];
  for (const p of arr(foreign)) {
    if (out.length >= want) break;
    const q = str(get(p, 'question')), key = norm(q);
    if (askable(q) !== null || taken.has(key)) continue;
    taken.add(key); out.push({ question: q.trim(), answer: REFUSAL, kind: 'refusal', sources: [] });
  }
  return out;
}

export function overlap(a, b) {
  const A = new Set(words(a)), B = new Set(words(b));
  let both = 0; for (const w of A) if (B.has(w)) both++;
  const either = A.size + B.size - both;
  return either === 0 ? 0 : both / either;
}

export function guard(training, tests) {
  const T = arr(tests).map((t) => str(get(t, 'text'))).filter((t) => norm(t) !== ''), exact = new Set(T.map(norm)), kept = [], struck = [];
  for (const p of arr(training)) {
    const q = str(get(p, 'question'));
    if (exact.has(norm(q))) { struck.push({ question: q, why: 'the same as a test question' }); continue; }
    const near = T.find((t) => overlap(q, t) >= LIMITS.nearOverlap);
    if (near !== undefined) { struck.push({ question: q, why: 'shares at least 80% of its words with a test question', test: near }); continue; }
    kept.push(p);
  }
  return { kept, struck };
}

// integrity(files, tests, corpora, outside, inputs) → { testQuestionsInTraining, outsideParagraphsInCorpus, generatorInputsWithATestQuestion }
//   files     the training files as trained on: [[{ question, … }]]          tests    every test question: [{ text }]
//   corpora   the corpora as indexed and trained from: [[{ id }]]            outside  ids of paragraphs kept outside
//   inputs    every prompt the generator was given, as text
export function integrity(files, tests, corpora, outside, inputs) {
  const all = arr(files).flatMap((f) => arr(f)), T = arr(tests).map((t) => str(get(t, 'text'))).filter((t) => norm(t) !== '');
  const out = new Set(arr(outside).map(str));
  return {
    testQuestionsInTraining: guard(all, tests).struck.length,
    outsideParagraphsInCorpus: arr(corpora).flatMap((c) => arr(c)).filter((p) => out.has(str(get(p, 'id')))).length,
    generatorInputsWithATestQuestion: arr(inputs).filter((text) => T.some((t) => (' ' + norm(text) + ' ').includes(' ' + norm(t) + ' '))).length,
  };
}

export default { REFUSAL, LIMITS, POINTING, KINDS, grounded, keep, refusals, overlap, guard, integrity };
