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
