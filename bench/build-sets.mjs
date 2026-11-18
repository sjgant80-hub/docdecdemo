// bench/build-sets.mjs — every test set DocDec v2 is measured on, built deterministically from SHA-pinned public files.
// No randomness and no hand-picking: file order and fixed rules decide everything. Writes bench/cache/sets.json.
//
//   SQuAD 2.0 dev (CC BY-SA 4.0)  → small (the v1 set: 3 articles, 130 paragraphs, 300+300 questions, 600 off-topic),
//                                   full (all 35 articles, 1,204 paragraphs: the same questions in a 9x haystack),
//                                   fresh (real paragraphs with one fact changed later: does the latest version win?)
//   HotpotQA distractor validation (CC BY-SA 4.0) → multi-hop (each answer needs two Wikipedia paragraphs)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { asyncBufferFromFile, parquetReadObjects } from 'hyparquet';
import { compressors } from 'hyparquet-compressors';

const HERE = dirname(fileURLToPath(import.meta.url));
export const SQUAD_SHA256 = '80a5225e94905956a6446d296ca1093975c4d3b3260f1d6c8f68bc2ab77182d8';
export const HOTPOT_SHA256 = 'c20b638ca82b21d04fe12e14ff417ad05153d4d215a65de54497fca4e972f7c6';
export const SMALL_ARTICLES = ['Normans', 'Oxygen', 'Computational_complexity_theory'];
const CAP = { answerable: 300, unanswerable: 300, outOfScope: 600 };
export const HOTPOT_N = 500;
const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const pin = (path, want) => { const b = readFileSync(path); const got = sha(b); if (got !== want) throw new Error(`${path}: sha256 ${got} is not the pinned ${want}`); return b; };

// ── SQuAD ──
const squad = JSON.parse(pin(join(HERE, 'raw', 'dev-v2.0.json'), SQUAD_SHA256).toString('utf8'));
const small = { paragraphs: [], questions: [], outOfScope: [] };
const full = { paragraphs: [] };
const oosPool = []; let na = 0, nu = 0;
for (const a of squad.data) {
  const inSmall = SMALL_ARTICLES.includes(a.title);
  a.paragraphs.forEach((p, pi) => {
    const id = a.title + '#' + pi;
    full.paragraphs.push({ id, title: a.title, text: p.context });
    if (!inSmall) { for (const q of p.qas) oosPool.push({ qid: 'oos:' + q.id, text: q.question }); return; }
    small.paragraphs.push({ id, title: a.title, text: p.context });
    for (const q of p.qas) {
      if (q.is_impossible) { if (nu >= CAP.unanswerable) continue; nu++; } else { if (na >= CAP.answerable) continue; na++; }
      small.questions.push({ qid: q.id, text: q.question, goldId: q.is_impossible ? null : id, impossible: !!q.is_impossible,
        answers: q.is_impossible ? [] : [...new Set(q.answers.map((x) => x.text))] });
    }
  });
}
const step = Math.max(1, Math.floor(oosPool.length / CAP.outOfScope));
small.outOfScope = oosPool.filter((_, i) => i % step === 0).slice(0, CAP.outOfScope);

// ── fresh: one fact per paragraph changed in a later version (rule fixed in PREREG.md §4) ──
const once = (hay, needle) => needle.length > 0 && hay.indexOf(needle) >= 0 && hay.indexOf(needle) === hay.lastIndexOf(needle);
const answerable = small.questions.filter((q) => !q.impossible);
const textOf = new Map(small.paragraphs.map((p) => [p.id, p.text]));
const changed = new Set(); const fresh = [];
answerable.forEach((q, i) => {
  if (changed.has(q.goldId)) return;
  const P = textOf.get(q.goldId), a = q.answers[0];
  if (!a || !once(P, a)) return;
  let b = null;
  if (/^\d{4}$/.test(a)) b = String(Number(a) + 7);
  else if (/\d/.test(a)) { const runs = [...a.matchAll(/\d+/g)]; const last = runs[runs.length - 1]; b = a.slice(0, last.index) + String(Number(last[0]) + 3) + a.slice(last.index + last[0].length); }
  else {
    const cap = /^[A-Z]/.test(a);
    for (let k = 1; k < answerable.length && b === null; k++) {
      const o = answerable[(i + k) % answerable.length], c = o.answers[0];
      if (!c || o.goldId === q.goldId || /\d/.test(c) || /^[A-Z]/.test(c) !== cap || P.includes(c) || c.toLowerCase() === a.toLowerCase()) continue;
      b = c;
    }
  }
  if (b === null || b === a || P.includes(b)) return;
  changed.add(q.goldId);
  const at = P.indexOf(a);
  fresh.push({ qid: q.qid, text: q.text, sourceId: q.goldId, oldAnswer: a, newAnswer: b,
    v1: { id: q.goldId + '@v1', text: P, validFrom: '2020-01-01' }, v2: { id: q.goldId + '@v2', text: P.slice(0, at) + b + P.slice(at + a.length), validFrom: '2026-06-01' } });
});

// ── HotpotQA: the first 500 questions in file order, every paragraph they carry pooled into ONE corpus ──
const hotRows = await parquetReadObjects({ file: await asyncBufferFromFile(join(HERE, 'raw', 'hotpot_qa-distractor-validation.parquet')), compressors });
pin(join(HERE, 'raw', 'hotpot_qa-distractor-validation.parquet'), HOTPOT_SHA256);
const hot = { paragraphs: [], questions: [] }; const byTitle = new Map();
for (const r of hotRows.slice(0, HOTPOT_N)) {
  const titles = Array.from(r.context.title), sents = Array.from(r.context.sentences);
  titles.forEach((t, i) => { if (!byTitle.has(t)) { const s = Array.from(sents[i]); byTitle.set(t, true); hot.paragraphs.push({ id: t, title: t, sentences: s, text: s.join('') }); } });
  const gold = [...new Set(Array.from(r.supporting_facts.title))];
  hot.questions.push({ qid: r.id, text: r.question, answer: r.answer, type: r.type, level: r.level, gold });
}

mkdirSync(join(HERE, 'cache'), { recursive: true });
const out = { v: 'docdec-sets/1', squadSha256: SQUAD_SHA256, hotpotSha256: HOTPOT_SHA256, small, full, fresh, hot };
writeFileSync(join(HERE, 'cache', 'sets.json'), JSON.stringify(out));
console.log(`small: ${small.paragraphs.length} paragraphs, ${small.questions.length} questions (${na}/${nu}), ${small.outOfScope.length} off-topic`);
console.log(`full: ${full.paragraphs.length} paragraphs (${(full.paragraphs.length / small.paragraphs.length).toFixed(1)}x)`);
console.log(`fresh: ${fresh.length} changed facts`); console.log(fresh.slice(0, 4).map((f) => `  ${f.text} | ${f.oldAnswer} -> ${f.newAnswer}`).join('\n'));
console.log(`hotpot: ${hot.paragraphs.length} pooled paragraphs, ${hot.questions.length} questions (${hot.questions.filter((q) => q.type === 'bridge').length} bridge / ${hot.questions.filter((q) => q.type === 'comparison').length} comparison); gold pairs of 2: ${hot.questions.filter((q) => q.gold.length === 2).length}`);
