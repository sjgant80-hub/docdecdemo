// bench/mm/prompts.mjs — every prompt and model setting of the Memory Model bench, in one place. PREREG.md addendum 3.
// These are DEV values until the second commit of section 9.8 freezes them (data/v3/seal.json) before the sealed run.
export const GENERATOR = { model: 'qwen2.5:7b', options: { temperature: 0, seed: 7, num_ctx: 4096, num_predict: 420 } };
export const EXECUTIVES = { large: 'qwen2.5:7b', edge: 'llama3.2:1b' };
export const EXEC_OPTIONS = { temperature: 0, seed: 7, num_ctx: 4096, num_predict: 64 };
export const EMBED_MODEL = 'nomic-embed-text';
export const RAG_TOP = 5;
export const MEMORY_TOKENS = 24;                 // the most tokens the memory may write for one answer
// the one line every memory conversation opens with, in training and when it is asked
export const MEMORY_SYSTEM = 'Answer from the documents you were trained on, in a few words. If the answer is not in them, say: not in the documents';

const FORM = 'Write one pair per line, in exactly this form and nothing else:\nQ: <question> | A: <answer>';

// facts a paragraph states
export const PROMPT_FACTS = (p) => `Write question-and-answer pairs about the paragraph below.
Rules:
- Each question must make sense on its own: name the person, place or thing it is about. Never say "the paragraph", "the passage" or "the text".
- Each answer must be a short phrase copied word for word from the paragraph.
- Cover every fact in the paragraph: names, dates, places, numbers, roles.
- Write at most 10 pairs.
${FORM}

Title: ${p.title}
Paragraph: ${p.text}`;

// questions whose answer is the paragraph's own subject
export const PROMPT_TITLE = (p) => `Write questions whose answer is "${p.title}".
Rules:
- Each question must describe the subject using facts from the paragraph below, without using the words of the answer.
- Each question must make sense on its own. Never say "the paragraph", "the passage" or "the text".
- Write at most 4 pairs. The answer of every pair is exactly: ${p.title}
${FORM}

Paragraph: ${p.text}`;

// questions that need two paragraphs
export const PROMPT_TWO = (a, b) => `Write questions that can only be answered by using BOTH paragraphs below together.
Rules:
- Each question must make sense on its own. Never say "the paragraph", "the passage" or "the text".
- Each answer must be a short phrase copied word for word from one of the paragraphs, or yes or no.
- Write at most 4 pairs.
${FORM}

Paragraph 1 (${a.title}): ${a.text}

Paragraph 2 (${b.title}): ${b.text}`;

// the plain baseline: retrieved paragraphs in the prompt, the same executive
export const PROMPT_RAG = (paragraphs, question) => `Answer the question using only the paragraphs below.
Rules: Reply with one line: the answer, in a few words. If the paragraphs do not contain the answer, reply exactly: not in the documents. Do not answer from your own knowledge.

${paragraphs.map((p, i) => `Paragraph ${i + 1} (${p.title}): ${p.text}`).join('\n\n')}

Question: ${question}
Answer:`;

// the control: the executive alone, with no memory and no paragraphs. Reported, never a claim: it shows how much of
// any system's score the executive could have supplied from what it already knew.
export const PROMPT_CLOSED = (question) => `Answer the question in a few words, on one line. If you do not know, reply exactly: not in the documents.

Question: ${question}
Answer:`;

// parsePairs(text) → [{ question, answer }] from the generator's "Q: … | A: …" lines; anything else is ignored
export function parsePairs(text) {
  const out = [];
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const m = line.trim().replace(/^[-*\d.)\s]+(?=Q\s*:)/i, '').match(/^Q\s*:\s*(.+?)\s*\|\s*A\s*:\s*(.+)$/i);
    if (m && m[1].trim() && m[2].trim()) out.push({ question: m[1].trim(), answer: m[2].trim().replace(/^["“”']+|["“”']+$/g, '').trim() });
  }
  return out;
}
