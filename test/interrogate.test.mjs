import { test } from 'node:test';
import assert from 'node:assert/strict';
import I from '../src/interrogate.mjs';

// an executive that gives its scripted replies in order, and a memory that answers from a table
const scripted = (replies) => { let i = 0; const seen = []; const f = async (p) => { seen.push(p); return replies[Math.min(i++, replies.length - 1)]; }; f.seen = seen; return f; };
const table = (t) => { const asked = []; const f = async (q) => { asked.push(q); return Object.hasOwn(t, q) ? t[q] : 'not in the documents'; }; f.asked = asked; return f; };

test('parse: one line decides, ASK or ANSWER; anything else is taken as the answer', () => {
  assert.deepEqual(I.parse('ASK: Who directed Ed Wood?'), { kind: 'ask', text: 'Who directed Ed Wood?' });
  assert.deepEqual(I.parse('ANSWER: Tim Burton'), { kind: 'answer', text: 'Tim Burton' });
  assert.deepEqual(I.parse('  answer :   yes  '), { kind: 'answer', text: 'yes' });
  assert.deepEqual(I.parse('Ask:what year?'), { kind: 'ask', text: 'what year?' });
  assert.deepEqual(I.parse('Let me think.\n\nASK: Who directed Ed Wood?\nANSWER: unknown'), { kind: 'ask', text: 'Who directed Ed Wood?' }, 'the first such line');
  assert.deepEqual(I.parse('I think it is Tim Burton.\nBecause.'), { kind: 'answer', text: 'I think it is Tim Burton.' });
  assert.deepEqual(I.parse('ANSWER:'), { kind: 'answer', text: '' });
  assert.deepEqual(I.parse('The ASK: is not at the start'), { kind: 'answer', text: 'The ASK: is not at the start' });
  assert.deepEqual(I.parse('ASKING: who?'), { kind: 'answer', text: 'ASKING: who?' });
  for (const x of ['', '  \n ', null, undefined, 7, {}]) assert.deepEqual(I.parse(x), { kind: 'answer', text: '' });
});

test('prompt: the rules, the question, what the memory has said, and how many questions are left', () => {
  assert.deepEqual([I.TURNS, I.ASK_WORDS, I.SAID_WORDS, I.REFUSAL], [3, 40, 30, 'not in the documents']);
  assert.match(I.RULES, /You cannot see any documents\./); assert.match(I.RULES, /ASK: <one short factual question>/); assert.match(I.RULES, /ANSWER: not in the documents/); assert.match(I.RULES, /Do not answer from your own knowledge\.$/);
  assert.equal(I.prompt('  Who directed Ed Wood? ', [], 3), `${I.RULES}\n\nQuestion: Who directed Ed Wood?\nYou may ask 3 more questions, or answer now.`);
  assert.equal(I.prompt('Q?', [{ asked: 'A1?', said: 'S1' }], 1), `${I.RULES}\n\nQuestion: Q?\nYou asked: A1?\nThe memory said: S1\nYou may ask 1 more question, or answer now.`);
  assert.equal(I.prompt('Q?', [{ asked: 'A1?', said: 'S1' }, { asked: 'A2?', said: 'S2' }], 0), `${I.RULES}\n\nQuestion: Q?\nYou asked: A1?\nThe memory said: S1\nYou asked: A2?\nThe memory said: S2\nYou have no questions left. Give your final answer now, as one line: ANSWER: <the answer>`);
  assert.match(I.prompt(7, [], 2), /\n\nQuestion: \nYou may ask 2 more questions, or answer now\.$/);
});

test('a conversation: ask, hear, ask, answer; the memory is given each question alone', async () => {
  const exec = scripted(['ASK: Who directed the film Ed Wood?', 'ASK: When was Tim Burton born?', 'ANSWER: August 25, 1958']);
  const mem = table({ 'Who directed the film Ed Wood?': 'Tim Burton\n(extra line)', 'When was Tim Burton born?': 'August 25, 1958' });
  const r = await I.interrogate('When was the director of Ed Wood born?', { executive: exec, memory: mem });
  assert.deepEqual([r.answer, r.forced], ['August 25, 1958', false]);
  assert.deepEqual(r.asked, [{ asked: 'Who directed the film Ed Wood?', said: 'Tim Burton' }, { asked: 'When was Tim Burton born?', said: 'August 25, 1958' }]);
  assert.deepEqual(mem.asked, ['Who directed the film Ed Wood?', 'When was Tim Burton born?'], 'the memory sees the question and nothing else');
  // the log is the audit trail: every prompt and every raw reply, in order
  assert.deepEqual(r.log.map((l) => l.who), ['executive', 'memory', 'executive', 'memory', 'executive']);
  assert.equal(r.log[0].prompt, I.prompt('When was the director of Ed Wood born?', [], 3));
  assert.deepEqual([r.log[1].prompt, r.log[1].reply], ['Who directed the film Ed Wood?', 'Tim Burton\n(extra line)']);
  assert.equal(r.log[2].prompt, I.prompt('When was the director of Ed Wood born?', [{ asked: 'Who directed the film Ed Wood?', said: 'Tim Burton' }], 2));
  assert.equal(r.log[4].reply, 'ANSWER: August 25, 1958');
  assert.equal(exec.seen.length, 3);
});

test('an answer at once uses no question; anything unparseable is the answer', async () => {
  const mem = table({});
  const a = await I.interrogate('Q?', { executive: scripted(['ANSWER: not in the documents']), memory: mem });
  assert.deepEqual([a.answer, a.asked, a.forced, a.log.length, mem.asked.length], ['not in the documents', [], false, 1, 0]);
  const b = await I.interrogate('Q?', { executive: scripted(['It is Paris, I believe.']), memory: mem });
  assert.deepEqual([b.answer, b.forced], ['It is Paris, I believe.', false]);
});

test('at most three questions: then it is told to answer, and a further ASK is no answer', async () => {
  const mem = table({ 'q1?': 's1', 'q2?': 's2', 'q3?': 's3' });
  const exec = scripted(['ASK: q1?', 'ASK: q2?', 'ASK: q3?', 'ANSWER: done']);
  const r = await I.interrogate('Q?', { executive: exec, memory: mem });
  assert.deepEqual([r.answer, r.asked.length, r.forced, mem.asked.length], ['done', 3, true, 3]);
  assert.match(exec.seen[3], /You have no questions left\. Give your final answer now/);
  assert.match(exec.seen[2], /You may ask 1 more question, or answer now\.$/);
  // it keeps asking: no fourth question reaches the memory, and it has given no answer
  const stubborn = scripted(['ASK: q1?', 'ASK: q2?', 'ASK: q3?', 'ASK: q4?', 'ANSWER: too late']), mem2 = table({});
  const s = await I.interrogate('Q?', { executive: stubborn, memory: mem2 });
  assert.deepEqual([s.answer, s.asked.length, s.forced, mem2.asked, stubborn.seen.length], ['', 3, true, ['q1?', 'q2?', 'q3?'], 4]);
  // the limit can be set, and nought means it must answer at once
  const one = await I.interrogate('Q?', { executive: scripted(['ASK: q1?', 'ANSWER: a']), memory: table({ 'q1?': 's1' }), turns: 1 });
  assert.deepEqual([one.answer, one.asked.length, one.forced], ['a', 1, true]);
  const none = scripted(['ASK: q1?', 'ANSWER: a']), mem3 = table({});
  const z = await I.interrogate('Q?', { executive: none, memory: mem3, turns: 0 });
  assert.deepEqual([z.answer, z.asked, z.forced, mem3.asked.length, none.seen.length], ['', [], true, 0, 1]);
  assert.match(none.seen[0], /You have no questions left/);
  for (const t of [-1, 1.5, '2', null]) { const e = scripted(['ASK: q1?', 'ASK: q2?', 'ASK: q3?', 'ANSWER: x']); assert.equal((await I.interrogate('Q?', { executive: e, memory: table({}), turns: t })).asked.length, 3, `turns ${String(t)} is the sealed limit`); }
});

test('a repeated or empty question is not put again: it is told to answer', async () => {
  const mem = table({ 'Who directed Ed Wood?': 'Tim Burton' });
  const exec = scripted(['ASK: Who directed Ed Wood?', 'ASK: who directed ED WOOD', 'ANSWER: Tim Burton']);
  const r = await I.interrogate('Q?', { executive: exec, memory: mem });
  assert.deepEqual([r.answer, r.asked.length, r.forced, mem.asked.length], ['Tim Burton', 1, true, 1]);
  assert.match(exec.seen[2], /You have no questions left/);
  const again = scripted(['ASK: Who directed Ed Wood?', 'ASK: Who directed Ed Wood?', 'ASK: Who directed Ed Wood?']);
  const s = await I.interrogate('Q?', { executive: again, memory: table({}) });
  assert.deepEqual([s.answer, s.asked.length, s.forced, again.seen.length], ['', 1, true, 3], 'told to answer once; a further ASK is no answer');
  const empty = scripted(['ASK:', 'ANSWER: x']);
  const e = await I.interrogate('Q?', { executive: empty, memory: mem });
  assert.deepEqual([e.answer, e.asked, e.forced], ['x', [], true]);
  // a different question is put
  const two = await I.interrogate('Q?', { executive: scripted(['ASK: Who directed Ed Wood?', 'ASK: Who wrote Ed Wood?', 'ANSWER: x']), memory: mem });
  assert.deepEqual(two.asked.map((t) => t.said), ['Tim Burton', 'not in the documents']);
});

test('what crosses between the two is cut: a question at 40 words, a reply at its first line and 30 words; an empty reply is a refusal', async () => {
  const long = Array.from({ length: 45 }, (_, i) => `w${i}`).join(' ');
  const mem = async (q) => { mem.got = q; return `\n\n  ${Array.from({ length: 35 }, (_, i) => `s${i}`).join('  ')}\nsecond line`; };
  const r = await I.interrogate('Q?', { executive: scripted([`ASK: ${long}`, 'ANSWER: x']), memory: mem });
  assert.equal(mem.got, Array.from({ length: 40 }, (_, i) => `w${i}`).join(' '));
  assert.equal(r.asked[0].said, Array.from({ length: 30 }, (_, i) => `s${i}`).join(' '));
  assert.match(r.log[1].reply, /second line$/, 'the log keeps the raw reply');
  for (const blank of ['', '  \n ', null, undefined, 7]) {
    const b = await I.interrogate('Q?', { executive: scripted(['ASK: q1?', 'ANSWER: x']), memory: async () => blank });
    assert.equal(b.asked[0].said, 'not in the documents', `a memory that says ${JSON.stringify(blank)} has refused`);
  }
  const exact = await I.interrogate('Q?', { executive: scripted([`ASK: ${Array.from({ length: 40 }, (_, i) => `w${i}`).join(' ')}`, 'ANSWER: x']), memory: mem });
  assert.equal(exact.asked[0].asked.split(' ').length, 40);
  const thirty = await I.interrogate('Q?', { executive: scripted(['ASK: q?', 'ANSWER: x']), memory: async () => Array.from({ length: 30 }, (_, i) => `s${i}`).join(' ') });
  assert.equal(thirty.asked[0].said.split(' ').length, 30);
});

test('without both models there is no conversation; a model that returns no text has said nothing', async () => {
  for (const opt of [null, undefined, {}, { executive: async () => 'ANSWER: x' }, { memory: async () => 'x' }, { executive: 'x', memory: 7 }]) {
    assert.deepEqual(await I.interrogate('Q?', opt), { answer: '', asked: [], forced: false, log: [], error: 'no executive or no memory' });
  }
  const r = await I.interrogate('Q?', { executive: async () => null, memory: async () => 'x' });
  assert.deepEqual([r.answer, r.asked, r.forced, r.log.length], ['', [], false, 1]);
  assert.equal(r.error, undefined);
});
