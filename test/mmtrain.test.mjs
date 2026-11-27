import { test } from 'node:test';
import assert from 'node:assert/strict';
import T from '../src/mmtrain.mjs';

const HOSTILE = [null, undefined, 7, 'x', {}, [], () => 1, NaN];
const P = { id: 'Ed Wood (film)', title: 'Ed Wood (film)', text: 'Ed Wood is a 1994 American biographical film directed by Tim Burton, starring Johnny Depp.' };
const Q = { id: 'Tim Burton', title: 'Tim Burton', text: 'Timothy Walter Burton, born August 25, 1958, is an American film director.' };
const pair = (question, answer, kind = 'fact') => ({ question, answer, kind });
const words = (n, w = 'word') => Array.from({ length: n }, (_, i) => `${w}${i}`).join(' ');

test('grounded: a pair may be trained on only when its answer is word for word in its source, or is its title', () => {
  assert.deepEqual(T.KINDS, ['fact', 'title', 'two']);
  assert.deepEqual(T.LIMITS, { questionWords: 40, answerWords: 12, nearOverlap: 0.8, refusalEvery: 3 });
  assert.equal(T.grounded(pair('Who directed the 1994 film Ed Wood?', 'Tim Burton'), [P]), null);
  assert.equal(T.grounded(pair('Who directed the 1994 film Ed Wood?', 'tim burton.'), [P]), null, 'case and punctuation do not matter');
  assert.equal(T.grounded(pair('Who directed the 1994 film Ed Wood?', 'Steven Spielberg'), [P]), 'the answer is not word for word in its source, and is not its title');
  assert.equal(T.grounded(pair('Who directed the 1994 film Ed Wood?', 'Burton Tim'), [P]), 'the answer is not word for word in its source, and is not its title', 'in order');
  // the answer may be the source's title, with or without its bracketed part
  assert.equal(T.grounded(pair('Which 1994 film stars Johnny Depp as a cult filmmaker?', 'Ed Wood (film)', 'title'), [{ ...P, text: 'A 1994 film starring Johnny Depp.' }]), null);
  assert.equal(T.grounded(pair('Which 1994 film stars Johnny Depp as a cult filmmaker?', 'Ed Wood', 'title'), [{ ...P, text: 'A 1994 film starring Johnny Depp.' }]), null);
  assert.equal(T.grounded(pair('Which 1994 film stars Johnny Depp?', 'film', 'title'), [{ ...P, text: 'A 1994 picture starring Johnny Depp.' }]), 'the answer is not word for word in its source, and is not its title', 'the bracketed part alone is not the title');
  assert.equal(T.grounded(pair('What is it?', 'anything', 'title'), [{ id: 'x', title: '(film)', text: 'Some words here.' }]), 'the answer is not word for word in its source, and is not its title', 'a title that is only a bracket names nothing');
  assert.equal(T.grounded(pair('What is it?', 'the', 'title'), [{ id: 'x', title: 'The', text: 'Some words here.' }]), 'no answer');
  // a pair from two paragraphs: yes or no stands; any other answer must be in one of the two
  assert.equal(T.grounded(pair('Were Ed Wood and Tim Burton both American?', 'yes', 'two'), [P, Q]), null);
  assert.equal(T.grounded(pair('Were Ed Wood and Tim Burton both American?', 'No.', 'two'), [P, Q]), null);
  assert.equal(T.grounded(pair('When was the director of Ed Wood born?', 'August 25, 1958', 'two'), [P, Q]), null);
  assert.equal(T.grounded(pair('When was the director of Ed Wood born?', '1960', 'two'), [P, Q]), 'the answer is not word for word in its source, and is not its title');
  assert.equal(T.grounded(pair('Is Ed Wood a 1994 film?', 'yes', 'fact'), [P]), 'the answer is not word for word in its source, and is not its title', 'yes or no stands only for a two-paragraph pair');
  // a pair must come with exactly its sources
  assert.equal(T.grounded(pair('When was the director of Ed Wood born?', 'August 25, 1958', 'two'), [Q]), 'the pair does not come with its source');
  assert.equal(T.grounded(pair('Who directed Ed Wood?', 'Tim Burton'), [P, Q]), 'the pair does not come with its source');
  assert.equal(T.grounded(pair('Who directed Ed Wood?', 'Tim Burton'), []), 'the pair does not come with its source');
  assert.equal(T.grounded(pair('Who directed Ed Wood?', 'Tim Burton'), [{ id: 'e', title: 'E', text: '' }]), 'the pair does not come with its source', 'an empty paragraph is no source');
  for (const s of HOSTILE) assert.equal(T.grounded(pair('Who directed Ed Wood?', 'Tim Burton'), s), 'the pair does not come with its source');
});

test('grounded: the shape rules, each with its reason', () => {
  assert.equal(T.grounded(pair('Who directed Ed Wood?', 'Tim Burton', 'guess'), [P]), 'not a kind of pair this gate knows');
  assert.equal(T.grounded({ question: 'Who directed Ed Wood?', answer: 'Tim Burton' }, [P]), 'not a kind of pair this gate knows');
  assert.equal(T.grounded(pair('  ', 'Tim Burton'), [P]), 'no question'); assert.equal(T.grounded(pair('The?', 'Tim Burton'), [P]), 'no question');
  assert.equal(T.grounded(pair(7, 'Tim Burton'), [P]), 'no question');
  assert.equal(T.grounded(pair(`Who directed ${words(38)}?`, 'Tim Burton'), [P]), null, 'forty words is within the limit');
  assert.equal(T.grounded(pair(`Who directed ${words(39)}?`, 'Tim Burton'), [P]), 'the question is over 40 words');
  for (const q of ['According to the passage, who directed it?', 'Who is named in this paragraph?', 'What does the text say about Tim Burton?', 'Who is in the PASSAGE?']) assert.equal(T.grounded(pair(q, 'Tim Burton'), [P]), 'the question points at the passage, the paragraph or the text', q);
  assert.equal(T.grounded(pair('Who sent the texts and passages about Ed Wood?', 'Tim Burton'), [P]), null, 'whole words only');
  assert.deepEqual(T.POINTING, ['passage', 'paragraph', 'text']);
  assert.equal(T.grounded(pair('Who directed Ed Wood?', ''), [P]), 'no answer'); assert.equal(T.grounded(pair('Who directed Ed Wood?', 'the'), [P]), 'no answer');
  const long = { id: 'l', title: 'L', text: words(20) };
  assert.equal(T.grounded(pair('What is listed?', words(12)), [long]), null, 'twelve words is within the limit');
  assert.equal(T.grounded(pair('What is listed?', words(13)), [long]), 'the answer is over 12 words');
  for (const x of HOSTILE) assert.equal(typeof T.grounded(x, [P]), 'string');
});

test('keep: the grounded pairs in order, each dropped pair counted by its reason, a repeated question once', () => {
  const pairs = [
    { ...pair('Who directed the 1994 film Ed Wood?', ' Tim Burton '), sources: [P] },
    { ...pair('Who directed it, according to the passage?', 'Tim Burton'), sources: [P] },
    { ...pair('Who starred in Ed Wood?', 'Brad Pitt'), sources: [P] },
    { ...pair('WHO directed the 1994 film, Ed Wood', 'Tim Burton'), sources: [P] },
    { ...pair('Were both American?', 'yes', 'two'), sources: [P, Q] },
    { ...pair('Who starred in Ed Wood?', 'Johnny Depp'), sources: [P] },
    null,
  ];
  const k = T.keep(pairs);
  assert.deepEqual(k.kept, [
    { question: 'Who directed the 1994 film Ed Wood?', answer: 'Tim Burton', kind: 'fact', sources: ['Ed Wood (film)'] },
    { question: 'Were both American?', answer: 'yes', kind: 'two', sources: ['Ed Wood (film)', 'Tim Burton'] },
    { question: 'Who starred in Ed Wood?', answer: 'Johnny Depp', kind: 'fact', sources: ['Ed Wood (film)'] },
  ]);
  assert.deepEqual(k.dropped, { 'the question points at the passage, the paragraph or the text': 1, 'the answer is not word for word in its source, and is not its title': 1, 'a repeat of an earlier question': 1, 'not a kind of pair this gate knows': 1 });
  // a question dropped for its answer does not block a later, grounded pair with the same question (q: who starred)
  for (const x of HOSTILE) assert.deepEqual(T.keep(x), { kept: [], dropped: {} });
});

test('refusals: one for every three grounded pairs, the first askable foreign questions in order, none a repeat', () => {
  assert.equal(T.REFUSAL, 'not in the documents');
  const g = Array.from({ length: 7 }, (_, i) => ({ question: `Grounded question ${i}?`, answer: 'x' }));
  const foreign = [{ question: 'What does the passage say?' }, { question: ' Who founded Acme? ' }, { question: 'Grounded question 3?' }, { question: 'WHO founded acme' }, { question: '' }, { question: 'When was Acme founded?' }, { question: 'Where is Acme?' }];
  assert.deepEqual(T.refusals(g, foreign), [{ question: 'Who founded Acme?', answer: 'not in the documents', kind: 'refusal', sources: [] }, { question: 'When was Acme founded?', answer: 'not in the documents', kind: 'refusal', sources: [] }]);
  assert.equal(T.refusals(g.slice(0, 2), foreign).length, 0, 'two grounded pairs earn no refusal');
  assert.equal(T.refusals(g.slice(0, 3), foreign).length, 1); assert.equal(T.refusals(g.slice(0, 5), foreign).length, 1); assert.equal(T.refusals(g.slice(0, 6), foreign).length, 2);
  assert.equal(T.refusals([...g, ...g, ...g], foreign).length, 3, 'when the foreign questions run out there are fewer');
  assert.equal(T.refusals(g, [{ question: `Who ${Array.from({ length: 40 }, () => 'w').join(' ')}?` }, { question: 'Who founded Acme?' }])[0].question, 'Who founded Acme?', 'a question over the length limit is passed over');
  for (const x of HOSTILE) { assert.deepEqual(T.refusals(x, foreign), []); assert.deepEqual(T.refusals(g, x), []); }
});

test('overlap: the share of distinct words two questions have in common', () => {
  assert.equal(T.overlap('Who directed Ed Wood?', 'who directed ed wood'), 1);
  assert.equal(T.overlap('Who directed Ed Wood?', 'Who directed the film Ed Wood?'), 4 / 5);
  assert.equal(T.overlap('Who directed Ed Wood?', 'When was Tim Burton born?'), 0);
  assert.equal(T.overlap('wood wood wood ed', 'ed wood'), 1, 'distinct words');
  assert.equal(T.overlap('k l m n', 'm n o p q r'), 2 / 8);
  assert.equal(T.overlap('', 'ed wood'), 0); assert.equal(T.overlap('the', 'the'), 0, 'nothing shares nothing');
  for (const x of HOSTILE) assert.equal(T.overlap(x, 'ed wood'), 0);
});

test('guard: a training question that is, or nearly is, a test question is struck', () => {
  const tests = [{ text: 'Were Scott Derrickson and Ed Wood of the same nationality?' }, { text: 'Who directed the film Ed Wood?' }, { text: '' }, null];
  const training = [
    { question: 'Who directed the film Ed Wood?', answer: 'Tim Burton' },                        // the same
    { question: 'who directed the film, ED WOOD', answer: 'Tim Burton' },                        // the same, normalised
    { question: 'Who directed Ed Wood?', answer: 'Tim Burton' },                                  // 4 of 5 words: 0.8, struck
    { question: 'Who directed the 1994 film Ed Wood here?', answer: 'Tim Burton' },               // 5 of 7: kept
    { question: 'When was Tim Burton born?', answer: '1958' },
  ];
  const g = T.guard(training, tests);
  assert.deepEqual(g.kept.map((p) => p.question), ['Who directed the 1994 film Ed Wood here?', 'When was Tim Burton born?']);
  assert.deepEqual(g.struck, [
    { question: 'Who directed the film Ed Wood?', why: 'the same as a test question' },
    { question: 'who directed the film, ED WOOD', why: 'the same as a test question' },
    { question: 'Who directed Ed Wood?', why: 'shares at least 80% of its words with a test question', test: 'Who directed the film Ed Wood?' },
  ]);
  assert.equal(g.kept[1], training[4], 'a kept pair is the pair itself');
  // just under the line is kept: 7 of 9 words
  assert.equal(T.guard([{ question: 'b c d e f g h i' }], [{ text: 'b c d e f g h j' }]).kept.length, 1);
  assert.equal(T.guard([{ question: 'b c d e f g h i' }], [{ text: 'b c d e f g h i j k' }]).struck.length, 1, '8 of 10 is on the line: struck');
  for (const x of HOSTILE) { assert.deepEqual(T.guard(x, tests), { kept: [], struck: [] }); assert.deepEqual(T.guard(training, x).struck, []); }
  assert.equal(T.guard([null, { question: 7 }], tests).kept.length, 2, 'a pair with no question cannot be a test question');
});

test('integrity: the three counts claim K5 is ruled on', () => {
  const tests = [{ text: 'Who directed the film Ed Wood?' }, { text: 'Were both American?' }];
  const clean = [[{ question: 'When was Tim Burton born?' }], [{ question: 'Who starred in Ed Wood?' }]];
  const corpora = [[{ id: 'Ed Wood (film)' }, { id: 'Tim Burton' }], [{ id: 'Ed Wood (film)' }, { id: 'Johnny Depp' }]];
  const inputs = ['Write questions about this paragraph: Ed Wood is a 1994 film.', 'Write questions about: Tim Burton, born 1958.'];
  assert.deepEqual(T.integrity(clean, tests, corpora, ['Scott Derrickson', 'Adam Collis'], inputs), { testQuestionsInTraining: 0, outsideParagraphsInCorpus: 0, generatorInputsWithATestQuestion: 0 });
  assert.equal(T.integrity([clean[0], [{ question: 'were BOTH american' }]], tests, corpora, [], inputs).testQuestionsInTraining, 1);
  assert.equal(T.integrity([[{ question: 'Who directed Ed Wood?' }], [{ question: 'Were both American?' }]], tests, corpora, [], inputs).testQuestionsInTraining, 2, 'near ones count, in every file');
  assert.equal(T.integrity(clean, tests, corpora, ['Tim Burton', 'Ed Wood (film)'], inputs).outsideParagraphsInCorpus, 3, 'counted in each corpus it is in');
  assert.equal(T.integrity(clean, tests, corpora, ['Johnny Depp'], inputs).outsideParagraphsInCorpus, 1);
  assert.equal(T.integrity(clean, tests, corpora, [], [...inputs, 'Example: "Who directed the film, Ed Wood?" Now write more.']).generatorInputsWithATestQuestion, 1);
  assert.equal(T.integrity(clean, tests, corpora, [], ['who directed the film ed woodward']).generatorInputsWithATestQuestion, 0, 'whole words');
  assert.equal(T.integrity(clean, [{ text: '' }, { text: 'the' }], corpora, [], inputs).generatorInputsWithATestQuestion, 0, 'an empty test question is in nothing');
  for (const x of HOSTILE) assert.deepEqual(T.integrity(x, x, x, x, x), { testQuestionsInTraining: 0, outsideParagraphsInCorpus: 0, generatorInputsWithATestQuestion: 0 });
});
