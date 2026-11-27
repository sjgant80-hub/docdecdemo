// DocDec · src/interrogate.mjs — the conductor of the Memory Model system: a bounded conversation between an
// executive model, which cannot see any document, and a memory model, which answers one question at a time from its
// weights. PREREG.md, addendum 3, section 9.2. Pure: the two models are functions handed in, so every rule here is
// tested without a model.
//
//   interrogate(question, { executive, memory, turns }) → { answer, asked, forced, log }
//       executive(prompt) → the executive's reply, as text       memory(question) → the memory's reply, as text
//       turns: the most questions the executive may put (default 3, the sealed limit)
//   The executive replies with one line: "ASK: <a question>" or "ANSWER: <its answer>". It may ask at most `turns`
//   times. The memory answers each question alone: it is given the question and nothing else, never an earlier turn.
//   When the questions are used up, or the executive repeats a question it has already asked, it is told to answer.
//   A reply that is neither an ASK nor an ANSWER is taken as its answer. Every prompt and reply is in the log.
//
//   parse(reply)                 → { kind: 'ask' | 'answer', text }
//   prompt(question, asked, left) → the executive's prompt: the rules, the question, what the memory has said so far
const str = (x) => (typeof x === 'string' ? x : '');

export const TURNS = 3;
export const ASK_WORDS = 40;         // a question to the memory is cut at this many words
export const SAID_WORDS = 30;        // a reply of the memory is cut at this many words before the executive sees it
export const REFUSAL = 'not in the documents';
export const RULES = [
  'You are answering a question. You cannot see any documents.',
  'A memory holds the documents. You may put short factual questions to it, one at a time.',
  `It answers from the documents, or it says "${REFUSAL}".`,
  'To ask the memory, reply with one line: ASK: <one short factual question>',
  'To give your final answer, reply with one line: ANSWER: <the answer, in a few words>',
  `If the memory does not have what is needed, reply: ANSWER: ${REFUSAL}`,
  'Use only what the memory told you. Do not answer from your own knowledge.',
].join('\n');

const firstLine = (s) => str(s).split(/\r?\n/).map((l) => l.trim()).find((l) => l !== '') || '';
const cut = (s, n) => s.split(/\s+/).filter(Boolean).slice(0, n).join(' ');
const same = (a, b) => a.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim() === b.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export function parse(reply) {
  const lines = str(reply).split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '');
  for (const l of lines) {
    const m = l.match(/^(ASK|ANSWER)\s*:\s*(.*)$/i);
    if (m) return { kind: m[1].toUpperCase() === 'ASK' ? 'ask' : 'answer', text: m[2].trim() };
  }
  return { kind: 'answer', text: lines[0] || '' };
}

export function prompt(question, asked, left) {
  const said = asked.map((t) => `You asked: ${t.asked}\nThe memory said: ${t.said}`).join('\n');
  const next = left > 0 ? `You may ask ${left} more question${left === 1 ? '' : 's'}, or answer now.` : 'You have no questions left. Give your final answer now, as one line: ANSWER: <the answer>';
  return `${RULES}\n\nQuestion: ${str(question).trim()}\n${said ? said + '\n' : ''}${next}`;
}

export async function interrogate(question, opt) {
  const executive = opt && typeof opt.executive === 'function' ? opt.executive : null, memory = opt && typeof opt.memory === 'function' ? opt.memory : null;
  const turns = opt && Number.isInteger(opt.turns) && opt.turns >= 0 ? opt.turns : TURNS;
  const asked = [], log = [];
  if (!executive || !memory) return { answer: '', asked, forced: false, log, error: 'no executive or no memory' };
  const say = async (left) => { const p = prompt(question, asked, left), r = str(await executive(p)); log.push({ who: 'executive', prompt: p, reply: r }); return parse(r); };
  let forced = false;
  // one step for each question it may ask and one for its answer: the conversation cannot run on
  for (let step = 0; step <= turns; step++) {
    const left = turns - asked.length, r = await say(left);
    if (r.kind === 'answer') return { answer: r.text, asked, forced, log };
    // an ASK with no questions left, an empty ASK, or a question already asked: told to answer, once
    const q = cut(r.text, ASK_WORDS);
    if (left <= 0 || q === '' || asked.some((t) => same(t.asked, q))) {
      if (left <= 0) return { answer: '', asked, forced: true, log };
      forced = true;
      const f = await say(0);
      return { answer: f.kind === 'answer' ? f.text : '', asked, forced, log };
    }
    const raw = str(await memory(q)), said = cut(firstLine(raw), SAID_WORDS);
    log.push({ who: 'memory', prompt: q, reply: raw });
    asked.push({ asked: q, said: said === '' ? REFUSAL : said });
    if (asked.length >= turns) forced = true;
  }
  return { answer: '', asked, forced: true, log };
}

export default { TURNS, ASK_WORDS, SAID_WORDS, REFUSAL, RULES, parse, prompt, interrogate };
