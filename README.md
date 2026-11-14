# DocDec — grounded answers from your documents (public demo)

**▶ Live demo: https://sjgant80-hub.github.io/docdecdemo/**

A plain vector-RAG returns the nearest chunk for **every** question — including the ones your documents don't answer —
so it invents. **DocDec** answers only when a document grounds it, **cites the exact source**, and otherwise **abstains:
"not in your documents."** This page shows it side by side with a real vector-RAG baseline, on a public benchmark,
**measured** — failures kept.

## What's on the page
- **See it** — the same real questions through a baseline vector-RAG (local `nomic-embed`, cosine top-1) and through
  DocDec, both running live in your browser. Grounded + cited, or an honest abstain.
- **The numbers** — DocDec vs the baseline on SQuAD 2.0 dev (CC BY-SA 4.0), half answerable / half deliberately
  unanswerable. Every figure is what the run produced — none hand-typed. On the unanswerable questions the vector-RAG
  hallucinates on **100%** (it cannot abstain); DocDec abstains on the ones it can ground-out, and the exact rate is shown
  straight, including where it is fooled by the benchmark's adversarial unanswerable questions.
- Self-explaining: how it works (traced from a real run), why it matters per role, security, adoption, and an **honest
  limits** section that keeps the recall trade and the adversarial-abstention gap on the record.

## Honest by design
The architecture truths — grounded, cites, abstains, runs on your hardware — are true by construction. The comparative
numbers (recall, precision, hallucination, abstention) are **measured on a public corpus and labelled a demo, not a
customer result**; your corpus would be your own.

## Provenance
The grounding kernel inlined in the page is **byte-identical** to `kernel.mjs`, which is itself byte-identical to the
engine kernel proven by a mutation gate in a private repo (`page-parity.test.mjs` holds the page and `kernel.mjs`
together, re-run in CI). The deeper routing — the production engine — runs privately on the customer's own hardware; the
behaviours shown here do not depend on it.

Public corpus: SQuAD 2.0 dev, Rajpurkar et al., CC BY-SA 4.0.

_Built by Kar for AI Native Solutions. Commercials are a conversation, not a web page._
