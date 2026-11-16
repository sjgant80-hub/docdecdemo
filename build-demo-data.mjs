#!/usr/bin/env node
// docdecdemo · build-demo-data.mjs — regenerate everything this demo shows, from public data, on your own machine.
//
//   1. download SQuAD 2.0 dev (CC BY-SA 4.0):  https://rajpurkar.github.io/SQuAD-explorer/dataset/dev-v2.0.json
//   2. run a local embedding model:            ollama pull nomic-embed-text   (Ollama on 127.0.0.1:11434)
//   3. node build-demo-data.mjs --squad path/to/dev-v2.0.json [--cache embed-cache.json] [--ollama http://127.0.0.1:11434]
//
// Writes demo-data.json (what the page shows) and eval-data.json (what "Re-run it yourself" recomputes). Every number
// is measured by rerun.mjs — the same file the page and CI run. Embeddings are rounded to 3 decimals BEFORE anything
// is measured, so the published numbers are exactly what a browser recomputes from the shipped vectors. Nothing is
// sent anywhere: the corpus and questions are embedded on your local model.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { measureAll, pickExamples, publish, SQUAD_SHA256, ARTICLES, EMBED_MODEL as MODEL } from './rerun.mjs';

const CAP = { answerable: 300, unanswerable: 300, outOfScope: 600 };

const arg = (name, dflt) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : dflt; };
const squadPath = arg('squad');
if (!squadPath) { console.error('usage: node build-demo-data.mjs --squad dev-v2.0.json [--cache file] [--ollama url]'); process.exit(2); }
const raw = readFileSync(squadPath);
const sha = createHash('sha256').update(raw).digest('hex');
if (sha !== SQUAD_SHA256) { console.error(`SQuAD file sha256 ${sha} is not the pinned ${SQUAD_SHA256} — refusing to build from a different file.`); process.exit(1); }
const squad = JSON.parse(raw.toString('utf8'));
const cachePath = arg('cache', 'embed-cache.json');
const ollama = arg('ollama', 'http://127.0.0.1:11434');
const cache = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, 'utf8')) : {};
const key = (t) => createHash('sha1').update(t).digest('hex');
let fresh = 0;
async function embed(text) {
  const k = key(text);
  if (!cache[k]) {
    const r = await fetch(ollama + '/api/embeddings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: MODEL, prompt: text }) });
    const j = await r.json(); if (!j.embedding) throw new Error('no embedding from ' + ollama + ' (is ' + MODEL + ' pulled?)');
    cache[k] = j.embedding; fresh++;
    if (fresh % 50 === 0) writeFileSync(cachePath, JSON.stringify(cache));
  }
  return cache[k].map((x) => Math.round(x * 1000) / 1000); // round FIRST: the page ships these exact vectors
}

// ── the corpus, deterministic by file order ──
const paragraphs = [], questions = [], outOfScopePool = []; let na = 0, nu = 0;
for (const a of squad.data) {
  if (!ARTICLES.includes(a.title)) { for (const p of a.paragraphs) for (const q of p.qas) outOfScopePool.push({ qid: 'oos:' + q.id, text: q.question }); continue; }
  a.paragraphs.forEach((p, pi) => {
    const id = a.title + '#' + pi;
    paragraphs.push({ id, text: p.context });
    for (const q of p.qas) {
      if (q.is_impossible) { if (nu >= CAP.unanswerable) continue; nu++; } else { if (na >= CAP.answerable) continue; na++; }
      questions.push({ qid: q.id, text: q.question, goldId: q.is_impossible ? null : id, impossible: !!q.is_impossible, answerText: q.is_impossible ? null : (q.answers[0] && q.answers[0].text) || null });
    }
  });
}
const step = Math.max(1, Math.floor(outOfScopePool.length / CAP.outOfScope));
const outOfScope = outOfScopePool.filter((_, i) => i % step === 0).slice(0, CAP.outOfScope);
console.log(`corpus: ${paragraphs.length} paragraphs · ${questions.length} questions (${na} answerable / ${nu} unanswerable) · ${outOfScope.length} out-of-scope from the other ${squad.data.length - ARTICLES.length} articles`);

console.log(`embedding on local ${MODEL}…`);
for (const p of paragraphs) p.vec = await embed(p.text);
for (const q of questions) q.vec = await embed(q.text);
for (const q of outOfScope) q.vec = await embed(q.text); // for the full DocDec off-topic measurement (the free box ignores vectors)
writeFileSync(cachePath, JSON.stringify(cache));
console.log(`  ${fresh} new embeddings (${paragraphs.length + questions.length + outOfScope.length - fresh} from cache)`);

// ── measure (rerun.mjs — the same code the page and CI run) ──
const { P, bench, free, offTopic } = measureAll(paragraphs, questions, outOfScope);
const pct = (x) => (x == null ? 'n/a' : (100 * x).toFixed(1) + '%');
console.log(`\nbenchmark gate chosen on ${bench.tune} tune questions (${bench.configsTried} configs): ${JSON.stringify(bench.gate)}`);
console.log(`  DocDec   recall ${pct(bench.docdec.recall)} · precision ${pct(bench.docdec.precisionWhenAnswering)} · hallucination ${pct(bench.docdec.hallucinationRate)} · abstention ${pct(bench.docdec.groundedAbstention)}`);
console.log(`  RAG      recall ${pct(bench.vectorRag.recall)} · precision ${pct(bench.vectorRag.precisionWhenAnswering)} · hallucination ${pct(bench.vectorRag.hallucinationRate)} · abstention ${pct(bench.vectorRag.groundedAbstention)}`);
console.log(`free-box gate (${free.configsTried} configs): ${JSON.stringify(free.gate)} · out-of-scope abstention ${pct(free.eval.outOfScopeAbstention)} (before: ${pct(free.before.outOfScopeAbstention)}) · recall ${pct(free.eval.recall)} · adversarial ${pct(free.eval.adversarialAbstention)}`);
console.log(`full DocDec on real off-topic questions: refused ${offTopic.abstained}/${offTopic.total} = ${pct(offTopic.abstention)}`);

// ── the examples + every published field: built by rerun.mjs, so CI can rebuild and compare them whole ──
const demoQuestions = pickExamples(P, bench);
const pub = publish({ bench, free, offTopic }, { paragraphs: paragraphs.length, questions: questions.length, answerable: na, unanswerable: nu });
const demo = { v: 'docdecdemo/3', corpus: ARTICLES, counts: { paragraphs: paragraphs.length, evalQuestions: bench.eval }, idf: [...P.idf.entries()], ...pub,
  docsCorpus: P.docs.map((d) => ({ id: d.id, terms: d.terms, text: paragraphs.find((p) => p.id === d.id).text })),
  vectors: Object.fromEntries(paragraphs.map((p) => [p.id, p.vec])), demoQuestions };
const evalData = { v: 'docdecdemo-eval/1', squadSha256: SQUAD_SHA256, note: 'raw text + 3-decimal vectors; rerun.mjs recomputes every token, the gate choice and every metric from these',
  paragraphs: paragraphs.map((p) => ({ id: p.id, text: p.text })), questions: questions.map((q) => ({ qid: q.qid, text: q.text, goldId: q.goldId, impossible: q.impossible, answerText: q.answerText, vec: q.vec })), outOfScope };
writeFileSync('demo-data.json', JSON.stringify(demo));
writeFileSync('eval-data.json', JSON.stringify(evalData));
const kb = (f) => (readFileSync(f).length / 1024).toFixed(0) + 'KB';
console.log(`\nexamples: ${demoQuestions.map((q) => q.label).join(', ')}`);
console.log(`wrote demo-data.json (${kb('demo-data.json')}) + eval-data.json (${kb('eval-data.json')})`);
