// bench/colbert.mjs — the ColBERT token encoder for DocDec's L1 (late interaction), run on your own CPU.
// answerdotai/answerai-colbert-small-v1 (Apache-2.0), int8 ONNX, through onnxruntime-node; the tokenizer is the
// model's own tokenizer.json through transformers.js, loaded from disk (remote loading switched off).
// Nothing is sent anywhere: text in, one 96-dimensional unit vector per token out.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ort from 'onnxruntime-node';
import { AutoTokenizer, env } from '@huggingface/transformers';

const HERE = dirname(fileURLToPath(import.meta.url));
export const MODEL_DIR = join(HERE, 'models', 'answerai-colbert-small-v1');
export const MODEL_FILE = 'model_int8.onnx';
export const MODEL_SHA256 = 'de45baeaa7a48cda647fcf71582e2a0920dca303654034570aa6144d84526283';
const CFG = JSON.parse(readFileSync(join(MODEL_DIR, 'onnx_config.json'), 'utf8'));
export const DIM = CFG.embedding_dim; // 96
const Q_PREFIX = CFG.query_prefix_id; // [unused0] = 1
const D_PREFIX = CFG.document_prefix_id; // [unused1] = 2
const MASK = CFG.mask_token_id; // 103
const Q_LEN = CFG.query_length; // 32
const D_LEN = CFG.document_length; // 300
const SKIP = new Set(CFG.skiplist_words);

env.allowRemoteModels = false;
env.localModelPath = join(HERE, 'models');
let tok = null, sess = null;
export async function load() {
  if (!tok) tok = await AutoTokenizer.from_pretrained('answerai-colbert-small-v1');
  if (!sess) sess = await ort.InferenceSession.create(join(MODEL_DIR, MODEL_FILE), { intraOpNumThreads: 8 });
  return { inputs: sess.inputNames, outputs: sess.outputNames };
}

// wordpiece ids without [CLS]/[SEP]
function pieces(text) {
  const enc = tok(String(text), { add_special_tokens: false });
  return Array.from(enc.input_ids.data, (x) => Number(x));
}
const CLS = 101, SEP = 102;

async function run(ids, mask) {
  const n = ids.length;
  const feeds = {
    input_ids: new ort.Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, n]),
    attention_mask: new ort.Tensor('int64', BigInt64Array.from(mask.map(BigInt)), [1, n]),
  };
  if (sess.inputNames.includes('token_type_ids')) feeds.token_type_ids = new ort.Tensor('int64', new BigInt64Array(n), [1, n]);
  const out = await sess.run(feeds);
  const t = out[sess.outputNames[0]];
  return { data: t.data, dims: t.dims };
}
function unit(v) { let s = 0; for (const x of v) s += x * x; s = Math.sqrt(s) || 1; return v.map((x) => x / s); }
function rows(res) {
  const [, n, d] = res.dims; const out = [];
  for (let i = 0; i < n; i++) out.push(unit(Array.from(res.data.subarray(i * d, (i + 1) * d))));
  return out;
}

// encodeQuery(text, { expand }) → { vecs: [[96]], tokens: [string] } — [CLS] [Q] text [SEP], padded with [MASK] to 32
// when expand is on (ColBERT query augmentation; the expansion tokens are attended to only if attendExpansion).
export async function encodeQuery(text, { expand = true, attendExpansion = false } = {}) {
  await load();
  const p = pieces(text).slice(0, Q_LEN - 3);
  const ids = [CLS, Q_PREFIX, ...p, SEP];
  const mask = ids.map(() => 1);
  while (expand && ids.length < Q_LEN) { ids.push(MASK); mask.push(attendExpansion ? 1 : 0); }
  const vecs = rows(await run(ids, mask));
  const tokens = ids.map((id) => tok.decode([id]));
  return { vecs, tokens, ids };
}

// encodeDoc(text) → { vecs, tokens, ids } — long text is split into overlapping windows of at most 300 positions so no
// part of a paragraph is silently truncated; punctuation tokens (the model's skiplist) and [CLS]/[SEP]/[D] are dropped.
export async function encodeDoc(text) {
  await load();
  const p = pieces(text);
  const W = D_LEN - 3, STRIDE = W - 50;
  const vecs = [], tokens = [], ids = [], seen = new Set();
  for (let start = 0; start === 0 || start < p.length; start += STRIDE) {
    const win = p.slice(start, start + W);
    const wid = [CLS, D_PREFIX, ...win, SEP];
    const v = rows(await run(wid, wid.map(() => 1)));
    for (let i = 2; i < wid.length - 1; i++) {
      const pos = start + i - 2;
      if (seen.has(pos)) continue; // overlap: keep the first window's vector for a position
      const t = tok.decode([wid[i]]);
      if (SKIP.has(t)) continue;
      seen.add(pos); vecs.push(v[i]); tokens.push(t); ids.push(wid[i]);
    }
    if (start + W >= p.length) break;
  }
  return { vecs, tokens, ids };
}
