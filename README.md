# DocDec — grounded answers from your documents (public demo)

**▶ Live demo: https://sjgant80-hub.github.io/docdecdemo/**

A plain vector-RAG returns the nearest chunk for **every** question — including the ones your documents don't answer —
so it invents. **DocDec** answers only when a document grounds it, **cites the exact source**, and otherwise **abstains:
"not in your documents."** This page shows it side by side with a real vector-RAG baseline, on a public benchmark,
**measured** — failures kept.

## What's on the page
- **See it** — the same real questions through a baseline vector-RAG (local `nomic-embed`, cosine top-1) and through
  DocDec, both running live in your browser. Plus a free box: ask anything, with starter questions in the documents,
  out of them, and one we know fools it.
- **The numbers** — DocDec vs the baseline on SQuAD 2.0 dev (CC BY-SA 4.0), half answerable / half deliberately
  unanswerable, and on 420 real questions about **other subjects**. Every figure is what the run produced — none
  hand-typed.
- **Re-run it yourself** — one click and the visitor's browser downloads the raw benchmark (plain text + embedding
  vectors), re-chooses DocDec's settings on the practice questions, re-scores everything with the same code, and checks
  every published number against its own result.
- Self-explaining: how it works (traced from a real run), why it matters per role, security, adoption, and an **honest
  limits** section that keeps the recall trade and the look-alike-question gap on the record.

## Re-derive every number — three ways, none of which asks you to trust us
1. **In your browser** — the "Re-run the benchmark" button on the page (≈6 MB, a few seconds, runs in a background thread).
2. **On every push** — CI runs `rerun.test.mjs`: it recomputes every published number from the shipped raw data, checks
   each example shows the verdict the gate really gives it, and proves the fast settings search equals the full kernel on
   all 63,900 decisions it makes. Tampering with any published number fails the build.
3. **From scratch, on your machine** — download SQuAD 2.0 dev
   (`https://rajpurkar.github.io/SQuAD-explorer/dataset/dev-v2.0.json`), run Ollama with `nomic-embed-text`, then:
   ```
   node build-demo-data.mjs --squad dev-v2.0.json
   ```
   It refuses any file whose SHA-256 isn't the pinned one, embeds locally (nothing leaves your machine), and rewrites
   `demo-data.json` + `eval-data.json` with every number measured by `rerun.mjs` — the same file the page and CI run.
   Vectors are rounded to 3 decimals *before* measuring, so what you build is exactly what a browser recomputes.

| file | what it is |
|---|---|
| `kernel.mjs` | the grounding kernel + metrics, byte-identical to the mutation-gated engine's; inlined verbatim in the page |
| `rerun.mjs` | the one measurement path — generator, CI and the page's button all import it |
| `rerun-worker.mjs` | runs `rerun.mjs` off the page's main thread |
| `build-demo-data.mjs` | rebuilds all the data from the public SQuAD file + a local embedding model |
| `page-parity.test.mjs` · `rerun.test.mjs` | the CI receipts |

## Honest by design
The architecture truths — grounded, cites, abstains, runs on your hardware — are true by construction. The comparative
numbers are **measured on a public corpus and labelled a demo, not a customer result**; your corpus would be your own.
On 16 November 2026 a check found the free box was tuned like the benchmark and refused only 49% of real off-topic
questions; it was re-tuned on its own held-out use case (now 93.1%) and the before-number stays on the page.

## Provenance
The grounding kernel inlined in the page is **byte-identical** to `kernel.mjs`, which is itself byte-identical to the
engine kernel proven by a mutation gate in a private repo (`page-parity.test.mjs` holds the page and `kernel.mjs`
together, re-run in CI). The deeper routing — the production engine — runs privately on the customer's own hardware; the
behaviours shown here do not depend on it.

Public corpus: SQuAD 2.0 dev, Rajpurkar et al., CC BY-SA 4.0.

_Built by Kar for AI Native Solutions. Commercials are a conversation, not a web page._
