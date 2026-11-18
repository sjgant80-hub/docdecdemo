// DocDec v2 · src/v1.mjs — DocDec v1 exactly as published, re-run on its own shipped data (eval-data.json) through its
// own measurement (rerun.mjs) and kernel (kernel.mjs), to check the guild finding against the v2 baseline. Pure.
import K from '../kernel.mjs';
import { prepare, benchmark } from '../rerun.mjs';

// v1Outcomes(evalData) → { gate, per: 0/1 decision-correct on v1's eval split in file order, recall, refusal, qids }
export function v1Outcomes(evalData) {
  const P = prepare(evalData.paragraphs, evalData.questions, []);
  const bench = benchmark(P);
  let nA = 0, nU = 0, rt = 0, refU = 0;
  const per = bench.evalQs.map((q) => {
    const r = K.route(q.qterms, P.docs, P.idf, { ...bench.gate, confidence: q.conf });
    if (q.impossible) { nU++; if (r.abstain) refU++; return r.abstain ? 1 : 0; }
    nA++; const ok = !r.abstain && r.answer === q.goldId ? 1 : 0; rt += ok; return ok;
  });
  return { gate: bench.gate, per, recall: nA ? rt / nA : null, refusal: nU ? refU / nU : null, qids: bench.evalQs.map((q) => q.qid) };
}
export default { v1Outcomes };
