// freebox.mjs — "Ask your own question": the real late-interaction model, running in YOUR browser.
// The model (answerai-colbert-small-v1, int8 ONNX, 34 MB) is fetched once from Hugging Face and refused unless its
// SHA-256 matches the pinned one; it runs on onnxruntime-web (WebAssembly, one thread), the exact build whose output
// bench/parity-web.mjs compared with the engine that made the published numbers (data/v2/parity.json). The
// question is tokenised by src/wordpiece.mjs, scored against the guild corpus by src/late.mjs, and judged by
// src/gate.mjs's first three checks with the setting chosen on the tune split. Nothing you type leaves the page.
import WP from './src/wordpiece.mjs';
import L from './src/late.mjs';
import GT from './src/gate.mjs';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let FB = null, vocab = null, inv = null, ort = null, sess = null, docs = null;

async function boot() {
  const status = $('fbStatus');
  $('fbLoad').disabled = true;
  try {
    status.textContent = 'Fetching the corpus and the vocabulary…';
    FB = await (await fetch('data/v2/freebox.json')).json();
    vocab = WP.vocabFrom(await (await fetch('data/v2/vocab.txt')).text());
    inv = []; for (const [p, i] of vocab) inv[i] = p;
    docs = FB.docs.map((d) => ({ ...d, m: L.fromInt8(L.b64ToInt8(d.v), 96) }));
    status.textContent = 'Fetching the runtime…';
    ort = await import(FB.ort.module);
    ort.env.wasm.wasmPaths = FB.ort.wasmPaths; ort.env.wasm.numThreads = 1;
    status.textContent = 'Downloading the model (34 MB, once; your browser may keep it)…';
    const buf = await (await fetch(FB.model.url)).arrayBuffer();
    const hex = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buf))].map((b) => b.toString(16).padStart(2, '0')).join('');
    if (hex !== FB.model.sha256) throw new Error('the downloaded model is not the pinned one (sha256 ' + hex.slice(0, 12) + '…); refusing to run it');
    status.textContent = 'Starting the model…';
    sess = await ort.InferenceSession.create(new Uint8Array(buf));
    status.innerHTML = '<span class="verdict ok">Ready.</span> The model is running in this tab. Type a question about the Normans, oxygen or computational complexity, or about anything else, to watch it refuse.';
    $('fbAsk').disabled = false; $('fbQ').disabled = false; $('fbQ').focus();
  } catch (e) {
    status.innerHTML = '<span class="verdict no">Could not start:</span> ' + esc(e.message) + '. The examples above, the numbers and the re-run do not need the model.';
    $('fbLoad').disabled = false;
  }
}

async function encode(text) {
  const { ids, mask } = WP.queryIds(text, vocab, FB.config);
  const n = ids.length;
  const T = (a) => new ort.Tensor('int64', BigInt64Array.from(a.map(BigInt)), [1, n]);
  const out = await sess.run({ input_ids: T(ids), attention_mask: T(mask), token_type_ids: T(ids.map(() => 0)) });
  const d = out[sess.outputNames[0]].data, v = new Int8Array(n * 96);
  for (let i = 0; i < n; i++) { let s = 0; for (let k = 0; k < 96; k++) s += d[i * 96 + k] ** 2; s = Math.sqrt(s) || 1; for (let k = 0; k < 96; k++) v[i * 96 + k] = Math.max(-127, Math.min(127, Math.round((d[i * 96 + k] / s) * 127))); }
  return { m: L.fromInt8(v, 96), tokens: ids.map((id) => inv[id] ?? '[UNK]') };
}

// highlight the passage's words that a question word matched (a wordpiece's word, case-insensitively)
function highlight(text, matched) {
  const want = new Set(matched.filter(Boolean).map((t) => t.replace(/^##/, '').toLowerCase()).filter((t) => t.length >= 2));
  return esc(text).replace(/[\p{L}\p{N}]+/gu, (w) => ([...want].some((p) => w.toLowerCase().startsWith(p) || w.toLowerCase() === p) ? '<mark>' + w + '</mark>' : w));
}

async function ask() {
  const q = $('fbQ').value.trim();
  if (!q) return;
  $('fbAsk').disabled = true;
  const t0 = performance.now();
  const e = await encode(q);
  const ranked = L.rank(docs.map((d) => { const m = L.maxsim(e.m, d.m, 96); return { id: d.id, score: Math.round(m.score * 1e6) / 1e6, m, d }; }));
  const top = ranked[0];
  const ev = L.evidence(e.tokens, top.m.sims, top.m.best, top.d.tokens);
  const g = GT.decide({ id: top.id, score: top.score, weakest: ev.weakest, weakestToken: ev.weakestToken }, { bar: FB.gate.t, evidence: FB.gate.e });
  const ms = Math.round(performance.now() - t0);
  const chips = ev.tokens.map((r) => `<span class="${r.sim < FB.gate.e ? 'weak' : ''}">${esc(r.token)} → ${esc(r.matched ?? '—')} ${r.sim.toFixed(2)}</span>`).join('');
  $('fbOut').innerHTML = `<p>${g.refuse ? `<span class="verdict no">Refused at check ${g.check}:</span> ${esc(g.why)}.` : '<span class="verdict ok">Passes checks 1 to 3</span>: a source clears the bar and supports every content word of the question.'}
    <span class="small muted">(${ms} ms in this tab; best score ${top.score.toFixed(3)} against a bar of ${FB.gate.t}; weakest word ${esc(String(ev.weakestToken ?? '').replace(/^##/, ''))} at ${ev.weakest.toFixed(2)} against ${FB.gate.e})</span></p>
    <p class="small"><b>Best passage:</b> ${esc(top.d.title.replace(/_/g, ' '))} (${esc(top.id)})</p><div class="passage">${highlight(top.d.text, ev.tokens.filter((r) => r.sim >= FB.gate.e).map((r) => r.matched))}</div>
    <p class="small muted">Each question word and its best match in that passage:</p><div class="ev">${chips}</div>
    <p class="small muted">${g.refuse ? 'Nothing is answered.' : 'In the full system the reader now copies the answering phrase out of this passage or says NONE, and the gate checks the copy word for word (checks 4 and 5). That step runs on your own machine, not in this page.'} Runner-up passages: ${ranked.slice(1, 3).map((r) => `${esc(r.id)} (${r.score.toFixed(3)})`).join(', ')}.</p>`;
  $('fbAsk').disabled = false;
}

$('fbLoad').addEventListener('click', boot);
$('fbAsk').addEventListener('click', ask);
$('fbQ').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') ask(); });
for (const b of document.querySelectorAll('[data-fbq]')) b.addEventListener('click', () => { $('fbQ').value = b.getAttribute('data-fbq'); if (sess) ask(); });
