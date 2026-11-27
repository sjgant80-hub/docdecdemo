# DocDec v2 — pre-registration

Written and pushed **before** any held-out (eval) number below was computed. The commit that adds this file is the
seal: every threshold is chosen on the tune split by the rules here, and every claim passes or fails by the rule here.
Whatever the eval split says is published, failures included. Date: 2026-11-18.

## 0 · What is being tested

DocDec v1 was caught by a fair re-run: at the same operating point it tied a tuned cosine threshold and lost on refusing
unanswerable questions, because its decisions leaned on the 0.70 embedding cut-off, not on its structure. v2 adds five
layers: late interaction (L1), a graph over the corpus (L2), a temporal memory (L3), a verifier gate (L4) and a
conductor (L5). Each layer must beat **the baseline: cosine top-1 plus a tuned threshold**, on the axis it claims, or
that axis is not claimed.

## 1 · Sets and splits (built by `bench/build-sets.mjs` from SHA-pinned files; file order decides everything)

| Set | What | Split |
|---|---|---|
| S1 small | SQuAD 2.0 dev, 3 articles, 130 paragraphs, 300 answerable + 300 unanswerable (the v1 set), 600 off-topic from the other 32 articles | first 30% tune (180 / 180 off-topic), rest eval (420 / 420) |
| S2 full | the same 600 questions against all 1,204 SQuAD dev paragraphs (9.3x) | same split |
| S3 multi-hop | HotpotQA distractor validation, first 500 questions, all their paragraphs pooled into one corpus of 4,937 | first 150 tune, 350 eval |
| S4 fresh | 86 real S1 paragraphs with one answer span replaced in a later version (rule in `build-sets.mjs`; the new value is NOT meant to be true, it tests the mechanism) | no tuning, all 86 measured |
| S5 paraphrase | one paraphrase of every S1 question, written by the local model (`PROMPT_PARAPHRASE`, temperature 0.7, seed = question index) | follows the original's split |

## 2 · Systems

- **B0** nomic-embed-text cosine top-1, never refuses (v1's "vector-RAG").
- **B1 THE BASELINE** nomic cosine top-1, refuse when the top cosine is below t. Run with and without nomic's
  documented task prefixes; the baseline uses whichever scores higher on tune. t is searched exhaustively over the
  baseline's own tune scores.
- **V1** DocDec v1 exactly as published (its own gate rule), re-run to check the guild finding.
- **L1** ColBERT (answerai-colbert-small-v1, int8, query expansion on as the model card shows, expansion tokens not
  attended) MaxSim top-1, refuse when the normalised MaxSim (sum over the 32 query vectors / 32) is below t.
- **L1e** L1 plus the evidence check: refuse when the weakest content token (a query wordpiece that is not a special
  token, [MASK], punctuation or a stopword) has a best match below e. (t, e) searched exhaustively over tune scores.
- **+R** the reader gate added to any of the above: the local reader is shown the top-1 passage and must copy the
  answering phrase or say NONE; NONE refuses; a phrase not found word for word in the passage refuses. Thresholds are
  re-searched with the reader in the loop. **DocDec v2 single-hop = L1e+R.** B1+R is reported as the ablation (how
  much the reader does on its own).
- **Multi-hop (S3):** cosine top-2 and ColBERT top-2 vs the **graph walk** (L2): hop-1 candidates are the ColBERT
  top 5 plus paragraphs whose title is in the question; hop-2 candidates are paragraphs whose title appears in a hop-1
  paragraph (or in the question); a pair scores s(a) + s(b) + lambda x linked(a, b), with lambda searched on tune; the
  ColBERT top-2 pair is always a candidate.
- **Fresh (S4):** flat retrieval over every version vs the L3 memory read "as of" a date (only versions valid then).
- **L3 cache (S5):** a verified answer is written to memory with its source and version; a later question whose
  ColBERT question-to-question score clears c is served from memory only after the stored phrase is re-found in the
  CURRENT version of its source. c is the lowest tune score whose tune false-serve rate (a stored answer served to an
  unanswerable paraphrase) is at most 1%; if no c qualifies, the cache is off.

Selection objective everywhere a threshold is searched: decision accuracy on tune = (answerable answered with the right
paragraph + unanswerable refused) / all tune questions. Ties go to the stricter setting.

## 3 · The reader

`bench/reader.mjs` at this commit: qwen2.5:7b, temperature 0, seed 7, num_ctx 4096, num_predict 48; prompts
`PROMPT_ONE` / `PROMPT_TWO` frozen. Output rule: first line, trimmed, surrounding quotes and one trailing full stop
removed; starts with NONE = refusal. Span rule: found in the passage case-insensitively with whitespace collapsed, else
refusal.

## 4 · Metrics

Paragraph routing: recall, precision when answering, refusal of unanswerable, refusal of off-topic, decision accuracy.
Spans: SQuAD exact match / F1 against the gold answers. Multi-hop: pair exact (both gold paragraphs are the two
cited), title recall at 2, answer EM / F1. Fresh: latest version returned, stale version returned, history (as of
2021 returns v1). Cache: hits, hits right, false serves, reader calls saved, stale serves after a change. Latency: median
ms per question per path on this machine. Paired comparisons: exact two-sided McNemar on per-question outcomes.

## 5 · Claims and their pass rules (a claim is made to a buyer only if it PASSES)

| # | Claim | Passes only if (eval split) |
|---|---|---|
| C1 | Finds the specific fact a pooled vector blurs | ColBERT top-1 right-paragraph rate on answerable questions beats B0, McNemar p < 0.05, on S1 AND S2 |
| C2 | Won't answer what it can't ground, better than the baseline | (a) v2 decision accuracy beats B1, McNemar p < 0.05, on S1; and (b) at a matched operating point (v2 setting chosen on tune with tune recall at least B1's, maximising tune refusal) v2 refuses more unanswerable eval questions, McNemar p < 0.05, with eval recall no more than 2 points lower |
| C3 | Multi-hop: composes two cited sources where single retrieval returns one piece | graph pair exact beats cosine top-2, McNemar p < 0.05, on S3 |
| C4 | Precision holds at 9x the corpus | with S1's settings carried over unchanged, v2 decision accuracy beats B1 on S2, McNemar p < 0.05 |
| C5 | Current, not stale | as of now the latest version is returned for at least 95% of S4 and beats flat retrieval, McNemar p < 0.05; as of 2021, v1 is returned for at least 95% |
| C6 | Auditable | every answer on every eval set carries a span found word for word in its cited source (tested in CI) |
| C7 | Gets better with use | on eval paraphrases: warm accuracy at least cold accuracy, false serves at most 1%, reader calls saved above 0, stale serves after a change 0 |
| C8 | Sovereign and cheap | all inference on this machine (no network beyond 127.0.0.1); median latency per path measured and published |

Not claimed either way, reported: V1 vs B1 (does the guild finding reproduce), B1+R (the reader alone), the
conductor's routing accuracy and its cosine fast path (cosine top-20 then ColBERT re-rank vs full ColBERT).

**H1, the frontier prototype (never a product claim):** a training-free version of the hyperbolic idea over a
mixed-granularity index of S1 (article, paragraph and sentence nodes): direction from nomic, radius set by depth
(specificity), Poincaré distance, rankings fused with cosine (reciprocal rank). Reproduced only if the fused rank-1
answer-bearing rate beats cosine alone on eval, McNemar p < 0.05. Hubness (how often a general article node wins
rank 1 for a specific question) reported for both.

## 6 · Honest limits fixed in advance

Public benchmarks, not a client's corpus. S4's changes are synthetic. S5's paraphrases are model-written. The reader's
outputs depend on the model build; they are shipped, so every published number is re-derived from shipped data in CI.

## 7 · Addendum 1, 2026-11-21: claim C7b, a memory that reuses work and re-checks it

Written and pushed **before** any C7b number was computed; the commit that adds this section is its seal. **C7 stays FAIL
exactly as published.** C7b is a new claim with its own rule. It is never a relabel of C7, and C7's numbers, rule and
verdict are not touched.

**Why.** C7 failed: with the memory, 67.6% of decisions were right against 68.1% without it, and stored answers went to
3.45% of unanswerable reworded questions (7 of 203; the bar was 1%). That memory stored CONCLUSIONS (an answer) and served one when
a new question looked like an old one. The hypothesis tested here: keep the WORK instead (the retrieval for the earlier
question and the reader's phrase), and before serving anything, re-run the grounding checks for the NEW question against
the CURRENT source.

**Use (what is stored).** As in C7: every original S1 question, tune and eval, goes through DocDec v2 at its tune-chosen
setting (bar t, evidence bar e, reader on). For each question it answers, the memory keeps that question's work, one
record per question: the passage and version it chose, its late-interaction score and evidence, the reader's raw output,
and the answer span with its character offsets.

**Serve (what a reworded question gets).** For each S5 paraphrase:

1. Take the remembered question with stored work that matches it best by ColBERT question-to-question MaxSim (the same
   shipped table C7 uses).
2. If that match scores below the match bar m, nothing is served: the question takes the cold path (DocDec v2 as usual).
3. Otherwise the stored work is re-checked for the NEW question against the version of the stored source valid now
   (2026-11-18): the new question's MaxSim score and evidence are computed against that one passage from the shipped
   token vectors, and the real gate (`src/gate.mjs` decide) runs on them with v2's t and e, the reader's stored output
   standing in for a new reader call. It must pass check 2 (score at least t), check 3 (every content word of the new
   question supported at least e) and check 5 (the reader's phrase found word for word in the current version), and the
   span the gate finds must be at the stored offsets with the stored text. Any failure: nothing is served, the cold path runs.
4. Only then is the stored answer served (its source and its span). This path never makes a new reader call, and never
   serves a model's output without check 5.

**m, chosen on the tune split only.** m is the lowest tune match score whose tune false-serve rate is at most 1%, where a
false serve is an unanswerable tune paraphrase whose best match clears m AND passes the re-check (a match that fails the
re-check can never be served, whatever the bar). Otherwise the rule is C7's (`pickBar`). If no m qualifies, the memory is
off. t and e are v2's tune-chosen values, unchanged. Nothing is chosen on eval.

**Stale.** After the S4 changes land (86 sources get a later version), the same eval serve is run again against the
changed store. A stored answer is stale when its source's current version no longer holds the stored span's text at the
stored offsets. A stale serve is a stale answer served.

**C7b passes only if, on the 420 eval paraphrases:**

- (a) stored answers given to unanswerable paraphrases are at most 1% of the unanswerable eval paraphrases;
- (b) decision accuracy with the memory is at least decision accuracy without it (the cold path alone), with C7's
  definition (answerable: answered with the right paragraph; unanswerable: refused); with the memory, a served question
  is scored on the stored answer and every other question on its cold decision;
- (c) no stale serve after the S4 changes;
- and the test is not empty: m exists and at least one eval paraphrase is served. A memory that never serves has not
  been tested; that is recorded as FAIL (not tested), never as a pass.

**Reported as benefits, never part of the rule:** reader calls saved (served paraphrases whose cold path would have asked
the reader, because it passed checks 2 and 3 on its own best passage; C7 counted every serve, C7b counts only these), and
passages scored with the memory against without it (the cold path scores all 130 passages; a re-check scores one). **Also
reported, not part of the rule:** how many re-checks each check stopped; exact match of the served spans against the new
question's gold answers beside the cold path's on the same questions (a reused phrase answered the earlier question); the
paired exact McNemar test of with-memory against without; and the cost the memory adds (every question is first matched
against every remembered question, served or not).

**Where it is computed.** `src/memory.mjs` (the stored work and the re-check, new functions beside C7's) and
`src/measure.mjs` (the one v2 measurement). Published in `data/v2/record.json` under `claims.C7b` and `s5b`, re-derived
from the shipped data on every push by `test/record.test.mjs` and in a visitor's browser by the page's re-run button.
`rerun.mjs` and `rerun.test.mjs` are version one's measurement path and stay as published.

## 8 · Addendum 2, 2026-11-21: G1, a memo of retrieval scores

Written and pushed **before** any G1 number was computed; the commit that adds this section is its seal. G1 is a
measurement of speed with its own pass rule. It changes no other claim and no other number.

**What.** `src/foldcache.mjs` keeps the retrieval scores of a question (late interaction over every passage, ranked,
the evidence for the top three, and both cosines: exactly what `src/assemble.mjs` computes for a question) so that the
SAME question asked again on the SAME index is not scored again.

- **Key:** the question, lower-cased, runs of whitespace as one space, trimmed (the ColBERT tokenizer is uncased and
  splits on whitespace, so equal keys mean equal encodings), together with the index version: the exact sorted list of
  the passage-version ids in the index (kept whole, not hashed, so two different indexes can never share a version).
- **Eviction:** keeping anything under a new index version first drops every entry kept under the old one (none of them
  could ever be used again); beyond the capacity, the least recently used entry goes.
- A reworded question has a different key, so this memo never answers it. That is the memory's job (claims C7, C7b).

**The bench (`bench/foldcache.mjs`, shipped data only, on this laptop).** The 420 eval questions of S1 (no two share a
key) against the 130 S1 passages (index A), the passages decoded once before timing, as a running index is held in
memory. Three rounds, each with an empty memo of capacity 1,000: every question is asked once (cold: the memo misses and
the scores are computed) and then once more (warm: the memo answers). The time of each memo call, computation included
when it misses, by `performance.now()`. Then the S4 changes land (index B: the 86 changed passages replaced by their
later versions) and every question is asked again under B's version, once.

**G1 passes only if:**

- (a) every cold result equals the shipped score table (`data/v2/scores-s1.json`) for that question, field for field,
  and every warm result is the result its cold call kept;
- (b) under index B, none of the 420 is answered from the memo, and every result equals a fresh computation on index B;
- (c) the median warm time per question is at most one tenth of the median cold time.

**Reported, not part of the rule:** both medians and 90th percentiles, hits, misses and evictions, the machine, its free
memory, and what else was running. **Not counted in either time:** encoding the question with the model (in the speed
table; a hit skips that too, so on a repeat the real saving is larger than G1 shows) and the reader. Timings are machine
measurements: published as measured, never re-derived; CI re-checks (a) and (b) on a sample of the shipped questions.

## 9 · Addendum 3, 2026-11-27: the Memory Model, a trained memory beside the retriever

Written and pushed **before** any model was shown a paragraph or a question of the sealed set below. The commit that
adds this section seals the claims, their bars and the way an answer is read ("bars first"). The few settings a small
dev round must decide (9.8) are frozen in a second commit, before the sealed run starts. Sections 0 to 8 do not change.

### 9.0 · What is being tested, and whose numbers are whose

The idea is from **"MeMo: Memory as a Model"** (Quek, Lee, Leong, Verma, Prakash, Chen, Low, Rus, Solar-Lezama;
arXiv:2605.15156, May 2026). Instead of retrieving passages, one small **memory model** is trained on the corpus, so
the knowledge is in its weights. A frozen larger model (the **executive**) puts a few questions to it and writes the
answer. The paper reports, on its own benchmarks with its own models:

- NarrativeQA: 53.58% against 23.21% for the best retrieval baseline, with Gemini 3 Flash as the executive
  (26.85% against 21.39% with Qwen2.5-32B);
- retrieval losing about 6 points when the corpus is doubled with distractors, the memory staying within noise;
- +26.73 points on NarrativeQA when the executive is swapped, with no retraining of the memory.

**Those numbers are theirs.** Nothing here repeats them as ours. What is tested here is whether the same shape
reproduces against DocDec's own baseline, on this machine.

**It is the same shape at a very different scale.** Their memory is a 14-billion-parameter model, fully fine-tuned on
about 1.3 million generated question-and-answer pairs, with hundreds of GPU-hours. Ours is a 1-billion-parameter model
with a small trained adapter, on a laptop processor, trained on a few thousand pairs. A result here says whether a
memory this small earns a place beside DocDec on a corpus this small. It neither confirms nor refutes the paper at its
own scale.

### 9.1 · Sets (by rule: `src/mmsets.mjs`, `bench/mm/build-sets.mjs`, shipped as `data/v3/sets.json`)

From the same SHA-pinned HotpotQA file as S3, in file order, from rows DocDec v2 never touched (v2 used rows 0 to 499).
Every question is multi-hop: its answer needs two paragraphs. File order and the rule decide everything; no row was
skipped.

| Set | Rows from | Answerable | Unanswerable | Foreign | Corpus | Noise |
|---|---|---|---|---|---|---|
| dev (never a claim) | 500 | 30 | 10 | 10 | 60 paragraphs, 4,006 words | 60 paragraphs |
| **sealed** | 600 | 120 (100 bridge, 20 comparison; 5 answered yes or no) | 60 | 60 | 240 paragraphs, 17,074 words | 240 paragraphs, 23,714 words |

- **Answerable:** both of the question's source paragraphs are in the corpus.
- **Unanswerable:** neither source paragraph is in the corpus or in the noise. The right reply is a refusal.
- **Foreign:** further questions whose sources are kept wholly outside. They are never tested. Their paragraphs are
  used only to make training examples of refusing (9.3).
- **Noise:** for each answerable question, its first two annotated distractor paragraphs, until the noise is as large
  as the corpus. The **doubled corpus** is corpus plus noise: 480 paragraphs, 40,788 words.
- No question and no paragraph is shared between the dev set and the sealed set.

### 9.2 · Systems (all on this machine; no network beyond 127.0.0.1; every model greedy, fixed seed)

- **MM, the Memory Model system.** The memory is Llama 3.2 1B Instruct with a LoRA adapter trained on the corpus
  (9.3). The executive is qwen2.5:7b. A conductor (`src/interrogate.mjs`, written and mutation-gated before the sealed
  run) lets the executive put **at most 3** questions to the memory. The memory answers each one alone: no passage, no
  earlier turn, nothing but the question. Then the executive must give its final answer. Every turn is logged.
- **MM-edge.** The same memory weights, with llama3.2:1b as the executive. Used for K3 only.
- **RAG, the plain baseline.** nomic-embed-text cosine, the top 5 paragraphs, handed to the same executive
  (qwen2.5:7b) with a frozen prompt that allows the refusal phrase.
- **DocDec v2,** exactly as sealed in sections 0 to 6: late interaction and the graph walk with the settings chosen
  on S3's tune split carried over unchanged, then the verifier-gated reader (it copies a phrase from the passages, or
  refuses). Its answer is the copied phrase.

Each system is run on the corpus and on the doubled corpus. For the doubled corpus the memory is trained again from
the start on all 480 paragraphs (its knowledge is its weights); RAG and DocDec v2 are re-indexed.

### 9.3 · How the memory is trained: only from paragraphs, never from a test question

1. **Generate.** The generator (qwen2.5:7b, frozen prompts) reads one corpus paragraph at a time and writes
   question-and-answer pairs: facts the paragraph states, and questions whose answer is the paragraph's own subject
   (its title). For pairs of paragraphs where one names the other's title (the corpus's own links, by
   `src/graph.mjs`'s mention rule, never by looking at a test question) it writes questions that need both.
2. **Ground.** Code decides what may be trained on. A pair is kept only if its answer is found word for word in its
   source paragraph or paragraphs, or is the source's title, or is yes or no for a two-paragraph comparison; its
   question does not point at "the passage", "the paragraph" or "the text"; the question is at most 40 words and the
   answer at most 12; and it is not a repeat. Everything dropped is counted, with its reason.
3. **Refusals are trained, not bolted on.** The same generation is run over the foreign paragraphs. Their questions
   become training examples whose answer is exactly `not in the documents`: one for every three grounded pairs, the
   first in order.
4. **The integrity guard.** Code strikes, and counts, any training question that after normalising equals a test
   question (answerable or unanswerable, dev or sealed), or shares at least 80% of its distinct words with one. The
   generator's inputs are recorded; none holds a test question.
5. **Train.** LoRA on the frozen 1B model, with the loss on the answer only. Rank, epochs, learning rate and token
   limits are set by the dev round and frozen before the sealed run (9.8).

### 9.4 · How an answer is read (code, exact; no model judges anything)

- The **final answer** is the first line a system gives, cut at 20 words.
- It is a **refusal** if it is empty, or if, normalised (`norm` in `src/mmsets.mjs`), it contains `not in documents`
  (the phrase `not in the documents`, as normalised), or if DocDec's reader refused.
- **Answerable question.** *Right:* not a refusal, and the gold answer's words appear in it, in order, as whole words
  (for a yes or no gold answer: its first word is that word). *Wrong:* an answer that is not right, which is a
  confident wrong answer. *No answer:* a refusal.
- **Unanswerable question.** *Right:* a refusal. *Wrong:* any answer.
- Accuracy is right over all, on the named set. Paired comparisons are the exact two-sided McNemar test
  (`src/stats.mjs`).

### 9.5 · Claims and their pass rules (the sealed set; the executive is qwen2.5:7b unless it says otherwise)

| # | Claim | Passes only if |
|---|---|---|
| K1 | Long-document lift | on the 120 answerable questions with the corpus: MM's accuracy is at least **5 points** above the better of DocDec v2 and RAG (DocDec v2 when they tie), and exact McNemar against that better baseline gives p < 0.05 |
| K2 | Noise robustness | a system's drop is its accuracy on the 120 with the corpus minus with the doubled corpus. MM's drop is at least **3 points smaller** than RAG's. DocDec v2's drop is reported beside them |
| K3 | Executive swap | the same memory weights (the same adapter SHA-256), the corpus, the 120: accuracy with qwen2.5:7b as the executive is not below accuracy with llama3.2:1b |
| K4 | Honest boundary | on the 60 unanswerable questions with the corpus: MM gives no more confident wrong answers than RAG. DocDec v2's count is reported beside them: it is the stricter comparison |
| K5 | Held-out integrity | 0 test questions are in either training file by the guard's two rules; 0 paragraphs kept outside are in either corpus; the generator was shown no test question. Re-checked from the shipped files in CI |

**The rule: adopt or dissolve.** The memory path is adopted into DocDec only if **all five** pass. Otherwise it
dissolves: its weights are not used, DocDec stays as it is, and the result is published with the failed claims in red.
An adopted memory is a new trained model. It would ship only after a person's recorded yes: the run proposes, a person
decides.

**Reported, never a claim:** every system's right, wrong and no-answer counts on both sets and both corpora; MM by
question type; how many of its 3 questions the executive used; how often the memory answered a sub-question with
`not in the documents`; the median seconds per question for each system; the hours of generating and training (the
cost retrieval does not pay); and the dev round.

### 9.6 · The spend wall

Model work on the sealed run is capped: 8 hours generating, 10 hours for each of the two trainings, 14 hours
answering, and 40 hours in all. If a cap is reached the run stops and what was measured is published as measured. A
claim whose runs did not finish is shown as not measured, and the memory dissolves (adoption needs all five to pass).

### 9.7 · Honest limits fixed in advance

- One corpus (240 Wikipedia paragraphs, 17,074 words), one kind of question, one memory size, one machine. K1 is
  named for the paper's long-document claim; this corpus is not a book, and each question needs two paragraphs of it.
- An unanswerable question is one whose two annotated sources are outside the corpus. A few may still be answerable
  from other paragraphs. Every system sees the same corpus, so this favours none.
- An answer is read as right when it contains the gold answer. A long answer could contain it by luck; the same rule
  and the same 20-word cut apply to every system.
- With 120 questions, a difference under about 9 points can be chance. K1 therefore also needs p < 0.05. K2, K3 and
  K4 compare small counts by the plain rules above; the exact counts are published with them.
- Training cost against query cost: the memory pays hours of training once for a corpus, and again when the corpus
  changes. Retrieval pays nothing up front. A corpus that changes hourly keeps retrieval, whatever this run says.
- Grounded, not proven: the memory answers from its weights, not from a cited passage. Even if adopted, its answers
  are labelled as recalled, and DocDec's word-for-word citation is still the only path that shows its source.

### 9.8 · Order of work

1. This section: the claims and bars, before anything is run.
2. A dev round on the dev set. It is published and it is never a claim. It fixes the prompts, the token limits and
   the training settings. Its memory is used nowhere else.
3. A second commit freezes those settings and every file that can change a result (`data/v3/seal.json`, a SHA-256 of
   each), before the sealed generation starts.
4. The sealed run: generate, ground, guard, train twice, answer, under the spend wall.
5. The verdicts, worked out by code from the shipped records. CI re-derives every published number.
