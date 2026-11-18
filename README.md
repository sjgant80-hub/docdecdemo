# DocDec — the grounding layer

**▶ Live: https://sjgant80-hub.github.io/docdecdemo/**

DocDec answers only from your own documents, gives the exact words it relied on (at character offsets anyone can
check), and refuses what the documents do not support. Plain vector search is its first, cheapest step, not the product.
It runs offline on an ordinary laptop CPU.

Version one was caught out by a fair re-run: at the same operating point it tied a tuned cosine cut-off and refused fewer
unanswerable questions. Version two is measured against exactly that baseline, **cosine top-1 plus a cut-off tuned on
the same data**. The rules were published before any held-out number was computed: [PREREG.md](PREREG.md). Every claim
that fails is shown as failed. The results are on the live page, generated from `data/v2/record.json`, never typed.

## The five layers

| Layer | File | What it does |
|---|---|---|
| L1 late interaction | `src/late.mjs` | ColBERT MaxSim (answerai-colbert-small-v1, int8, on CPU): every question word-piece takes its best match; the weakest content match is the evidence |
| L2 graph | `src/graph.mjs` | the corpus's own titles as entities, mentions as links; the two-hop walk; the corpus's themes |
| L3 dated memory | `src/memory.mjs` | versions with validity windows (supersede, never overwrite), verified answers re-checked against the current version before reuse, metabolism |
| L4 verifier gate | `src/gate.mjs` | five checks; a local reader (qwen2.5:7b via Ollama) may only copy a phrase or say NONE, and the phrase must be found word for word |
| L5 conductor | `src/conduct.mjs` | one fact or two; the cosine shortlist |

Measurement: `src/measure.mjs` (every number and verdict), `src/assemble.mjs`, `src/stats.mjs` (exact McNemar),
`src/examples.mjs` (the fixed rules that pick every example), `src/cost.mjs` (the cost case from `data/prices.lock.json`),
`src/hyper.mjs` (the frontier prototype, never claimed), `src/wordpiece.mjs` (the model's tokenizer, for the in-browser box).
Every module is mutation-gated CLEAN (witness v0.6); the counts are in `data/v2/gates.json` and on the page.

## Re-derive every number

1. **In your browser:** the page's re-run button downloads the shipped data and re-derives the whole record with the same
   code, then compares it field by field.
2. **On every push:** CI re-scores the guild corpus, the off-topic set, the fresh set and the paraphrases from the
   shipped vectors, re-runs the whole measurement, requires it to equal `data/v2/record.json`, proves the fast threshold
   search equals the real gate on every decision, RUNS the page against the shipped data, and mutation-gates every module.
3. **From scratch, on your machine:** see `bench/` and the commands on the page. Pinned SHA-256s refuse any other input
   file. Everything runs locally (Ollama for nomic-embed-text and qwen2.5:7b, onnxruntime for ColBERT).

Data: SQuAD 2.0 dev (Rajpurkar et al., CC BY-SA 4.0), HotpotQA distractor validation (Yang et al., CC BY-SA 4.0).
Model: answerai-colbert-small-v1 (Apache-2.0; its `vocab.txt` is shipped in `data/v2/`). The first version's page is kept
as [v1.html](v1.html), its numbers still re-derived in CI.

_Built by Kar. Supplied by [AI Native Solutions](https://www.ai-nativesolutions.com). MIT licence._
