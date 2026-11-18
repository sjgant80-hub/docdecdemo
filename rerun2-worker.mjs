// rerun2-worker.mjs — the page's "Re-run it yourself": downloads the shipped data and re-derives the whole record with
// the same pure code the generator and CI run, then compares it with the published record field by field.
import { assemble } from './src/assemble.mjs';
import { measure } from './src/measure.mjs';
import { pick } from './src/examples.mjs';
import { compareRecords, publishable } from './src/publish.mjs';

const get = (u) => fetch(u).then((r) => { if (!r.ok) throw new Error(u + ' ' + r.status); return r.json(); });
self.onmessage = async (ev) => {
  const full = ev.data && ev.data.full === true;
  const t0 = performance.now();
  try {
    const names = ['s1', 's2', 's3', 's4', 's5', 'h1', 'reader', 'v1'];
    self.postMessage({ progress: 'Downloading the shipped data…' });
    const files = await Promise.all(names.map((n) => get('data/v2/' + n + '.json')));
    const F = Object.fromEntries(names.map((n, i) => [n, files[i]]));
    const published = await get('data/v2/record.json');
    const shipped = await get('data/v2/scores-s1.json');
    let scoresSame = null, A;
    if (full) {
      self.postMessage({ progress: 'Re-scoring from the shipped vectors (late interaction on every question)…' });
      A = assemble(F);
      scoresSame = JSON.stringify([A.s1Scores, A.oosScores, A.s4Scores, A.qq, A.paraScores]) === JSON.stringify([shipped.q, shipped.oos, shipped.s4, shipped.qq, shipped.para]);
    } else {
      A = assemble(F, { s1Scores: shipped.q, oosScores: shipped.oos, s4Scores: shipped.s4, qq: shipped.qq, paraScores: shipped.para });
    }
    self.postMessage({ progress: 'Searching every threshold, deciding every question, testing every claim…' });
    const rec = measure(A.D);
    const ex = pick(F, A.D, rec);
    const mine = publishable(rec, ex, published.sources);
    const { fields, diffs } = compareRecords(mine, published);
    self.postMessage({ same: diffs.length === 0 && (scoresSame !== false), fields, diffs, full, scoresSame, seconds: ((performance.now() - t0) / 1000).toFixed(1) });
  } catch (e) { self.postMessage({ error: String(e && e.message || e) }); }
};
