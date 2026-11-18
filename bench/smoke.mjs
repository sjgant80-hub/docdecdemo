// bench/smoke.mjs — the encoder's sanity check: shapes, unit length, and the model card's own example ranking.
import { load, encodeQuery, encodeDoc, DIM } from './colbert.mjs';
const io = await load();
console.log('onnx io', JSON.stringify(io));
const maxsim = (Q, D) => { let s = 0; for (const q of Q) { let m = -1; for (const d of D) { let x = 0; for (let i = 0; i < q.length; i++) x += q[i] * d[i]; if (x > m) m = x; } s += m; } return s; };
const docs = ['Venus is often called Earth\'s twin because of its similar size and proximity.',
  'Mars, known for its reddish appearance, is often referred to as the Red Planet.',
  'Jupiter, the largest planet in our solar system, has a prominent red spot.',
  'Saturn, famous for its rings, is sometimes mistaken for the Red Planet.'];
for (const variant of [{ expand: true, attendExpansion: false }, { expand: true, attendExpansion: true }, { expand: false }]) {
  const q = await encodeQuery('Which planet is known as the Red Planet?', variant);
  const ds = await Promise.all(docs.map((d) => encodeDoc(d)));
  const scores = ds.map((d) => maxsim(q.vecs, d.vecs));
  const norm = Math.sqrt(q.vecs[3].reduce((a, x) => a + x * x, 0));
  console.log(JSON.stringify(variant), 'q', q.vecs.length + 'x' + q.vecs[0].length, 'dim', DIM, '|v|', norm.toFixed(4), 'scores', scores.map((s) => s.toFixed(3)).join(' '), 'best', scores.indexOf(Math.max(...scores)));
}
const d = await encodeDoc(docs[1]);
console.log('doc tokens', d.tokens.join(' '));
