// bench/mm/run.mjs — one system answers every question of a set, once, cold. The answers are read by src/mmscore.mjs.
//   node bench/mm/run.mjs <dev | sealed> <mm | rag | closed> <large | edge> <corpus | doubled> [--port 8860] [--adapter <sha256>]
//     mm       the Memory Model system: the executive puts at most 3 questions to the trained memory (src/interrogate.mjs)
//     rag      the plain baseline: nomic cosine, the top 5 paragraphs, the same executive
//     closed   the control: the executive alone, with no memory and no paragraphs (reported, never a claim)
// Writes data/v3/<set>/run-<system>-<executive>-<corpus>.json: every question with the system's raw output, the answer
// as read, the outcome, and (for mm) the whole conversation. A run resumes: a question already answered is not asked again.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import SCORE from '../../src/mmscore.mjs';
import { interrogate } from '../../src/interrogate.mjs';
import { generate, embed, memory, save } from './llm.mjs';
import { EXECUTIVES, EXEC_OPTIONS, RAG_TOP, PROMPT_RAG, PROMPT_CLOSED } from './prompts.mjs';

const HERE = dirname(fileURLToPath(import.meta.url)), ROOT = join(HERE, '..', '..');
const [which, system, exec, corpusName] = process.argv.slice(2);
const opt = (k, d) => { const i = process.argv.indexOf(k); return i < 0 ? d : process.argv[i + 1]; };
if (!['dev', 'sealed'].includes(which) || !['mm', 'rag', 'closed'].includes(system) || !EXECUTIVES[exec] || !['corpus', 'doubled'].includes(corpusName)) { console.error('usage: node bench/mm/run.mjs <dev | sealed> <mm | rag | closed> <large | edge> <corpus | doubled> [--port 8860] [--adapter <sha256>]'); process.exit(2); }
const set = JSON.parse(readFileSync(join(ROOT, 'data', 'v3', 'sets.json'), 'utf8'))[which];
const dir = join(ROOT, 'data', 'v3', which); mkdirSync(dir, { recursive: true });
const out = join(dir, `run-${system}-${exec}-${corpusName}.json`);
const model = EXECUTIVES[exec], executive = async (prompt) => (await generate(model, prompt, EXEC_OPTIONS)).raw;
const paragraphs = corpusName === 'doubled' ? [...set.corpus, ...set.noise] : set.corpus;
const questions = [...set.answerable.map((q) => ({ ...q, answerable: true })), ...set.unanswerable.map((q) => ({ ...q, answerable: false }))];

const ident = { v: 'docdec-mm-run/1', set: which, system, executive: model, executiveOptions: EXEC_OPTIONS, corpus: corpusName, paragraphs: paragraphs.length, adapterSha256: system === 'mm' ? opt('--adapter', null) : null };
let rec = { ...ident, seconds: 0, rows: [] };
if (existsSync(out)) { const was = JSON.parse(readFileSync(out, 'utf8')); if (Object.keys(ident).every((k) => JSON.stringify(was[k]) === JSON.stringify(ident[k]))) rec = was; }
const done = new Set(rec.rows.map((r) => r.qid));

// rag: every paragraph embedded once; a question's top paragraphs by cosine
let vectors = null;
const cos = (a, b) => { let d = 0, x = 0, y = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; } return d / (Math.sqrt(x) * Math.sqrt(y) || 1); };
const top = async (question) => {
  if (!vectors) { vectors = []; for (const p of paragraphs) vectors.push(await embed(`search_document: ${p.title}\n${p.text}`)); save(); }
  const q = await embed(`search_query: ${question}`);
  return vectors.map((v, i) => [cos(q, v), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]).slice(0, RAG_TOP).map(([score, i]) => ({ ...paragraphs[i], score: Math.round(score * 1000) / 1000 }));
};
const ask = system === 'mm' ? memory(Number(opt('--port', '8860'))) : null;

const t0 = Date.now(), base = rec.seconds;
for (const [i, q] of questions.entries()) {
  if (done.has(q.qid)) continue;
  const t1 = Date.now();
  let output, extra = {};
  if (system === 'mm') { const r = await interrogate(q.text, { executive, memory: ask }); output = r.answer; extra = { asked: r.asked, forced: r.forced, log: r.log }; }
  else if (system === 'rag') { const ps = await top(q.text); output = await executive(PROMPT_RAG(ps, q.text)); extra = { retrieved: ps.map((p) => ({ id: p.id, score: p.score })), bothSources: q.answerable ? q.gold.every((t) => ps.some((p) => p.id === t)) : null }; }
  else output = await executive(PROMPT_CLOSED(q.text));
  const read = SCORE.read(output, q);
  rec.rows.push({ qid: q.qid, answerable: q.answerable, type: q.type, question: q.text, gold: q.answerable ? q.answer : null, output, final: read.final, outcome: read.outcome, ms: Date.now() - t1, ...extra });
  rec.seconds = base + Math.round((Date.now() - t0) / 1000);
  if (rec.rows.length % 5 === 0 || i === questions.length - 1) { writeFileSync(out, JSON.stringify(rec)); save(); console.log(`${rec.rows.length} of ${questions.length} · ${rec.seconds} s`); }
}
const order = new Map(questions.map((q, n) => [q.qid, n]));
rec.rows.sort((a, b) => order.get(a.qid) - order.get(b.qid));
rec.complete = rec.rows.length === questions.length;
writeFileSync(out, JSON.stringify(rec)); save();
const A = SCORE.tally(rec.rows.filter((r) => r.answerable).map((r) => r.outcome)), U = SCORE.tally(rec.rows.filter((r) => !r.answerable).map((r) => r.outcome));
console.log(`done: ${system} · ${model} · ${corpusName}: answerable ${A.right} right, ${A.wrong} wrong, ${A.none} no answer of ${A.n}; unanswerable ${U.right} refused, ${U.wrong} answered of ${U.n}; ${rec.seconds} s`);
