// docdecdemo · rerun-worker.mjs — runs rerun.mjs off the page's main thread, so the page stays responsive while a
// visitor's browser re-derives every published number. Same code as CI and the generator; this file only moves it.
import { measureAll, spotCheck } from './rerun.mjs';

self.onmessage = async (e) => {
  try {
    const { vectors } = e.data;
    self.postMessage({ stage: 'downloading the raw benchmark…' });
    const r = await fetch(new URL('./eval-data.json', import.meta.url));
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const ev = await r.json();
    self.postMessage({ stage: 'recomputing every number…' });
    const t0 = performance.now();
    const paragraphs = ev.paragraphs.map((p) => ({ ...p, vec: vectors[p.id] }));
    const { P, bench, free, offTopic } = measureAll(paragraphs, ev.questions, ev.outOfScope);
    self.postMessage({ stage: 'spot-checking the settings search against the full DocDec code…' });
    const sc = spotCheck(P, 2000);
    const { evalQs, tuneQs, ...b } = bench;
    self.postMessage({ done: true, secs: (performance.now() - t0) / 1000, bench: b, free, offTopic, sc, counts: { paragraphs: ev.paragraphs.length, questions: ev.questions.length + ev.outOfScope.length } });
  } catch (err) { self.postMessage({ error: String(err && err.message || err) }); }
};
