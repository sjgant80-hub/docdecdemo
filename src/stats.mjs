// DocDec v2 · src/stats.mjs — the paired test every claim is judged by (exact two-sided McNemar), pure.

const fin = (x) => (typeof x === 'number' && Number.isFinite(x));
const arr = (x) => (Array.isArray(x) ? x : []);

// lnChoose(n, k) → ln C(n, k), summed exactly in logs (n here is at most a few thousand)
export function lnChoose(n, k) {
  if (!Number.isInteger(n) || !Number.isInteger(k) || k < 0 || k > n) return -Infinity;
  const m = Math.min(k, n - k);
  let s = 0;
  for (let i = 1; i <= m; i++) s += Math.log(n - m + i) - Math.log(i);
  return s;
}

// mcnemar(b, c) → exact two-sided p for b discordant pairs one way and c the other (binomial, p = 1/2)
export function mcnemar(b, c) {
  const B = Number.isInteger(b) ? Math.max(0, b) : 0, Cc = Number.isInteger(c) ? Math.max(0, c) : 0;
  const n = B + Cc;
  if (n === 0) return 1;
  const k = Math.min(B, Cc);
  let tail = 0;
  for (let i = 0; i <= k; i++) tail += Math.exp(lnChoose(n, i) - n * Math.LN2);
  return Math.min(1, 2 * tail);
}

// paired(a, b) — a, b: arrays of 0/1 outcomes for the same questions in the same order. → { aOnly, bOnly, p, a, b, n }
export function paired(a, b) {
  const A = arr(a), B = arr(b);
  const n = Math.min(A.length, B.length);
  let aOnly = 0, bOnly = 0, sa = 0, sb = 0;
  for (let i = 0; i !== n; i++) {
    const x = A[i] ? 1 : 0, y = B[i] ? 1 : 0;
    sa += x; sb += y;
    if (x === 1 && y === 0) aOnly++;
    if (x === 0 && y === 1) bOnly++;
  }
  return { n, a: sa, b: sb, aOnly, bOnly, p: mcnemar(aOnly, bOnly) };
}

// beats(a, b, alpha) → true when a is right on more questions than b AND the difference is significant at alpha
export function beats(a, b, alpha) {
  const t = paired(a, b);
  const al = fin(alpha) ? alpha : 0.05;
  return t.aOnly > t.bOnly && t.p < al;
}

export function median(xs) {
  const v = arr(xs).filter(fin).slice().sort((x, y) => x - y);
  if (v.length === 0) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 === 1 ? v[m] : (v[m - 1] + v[m]) / 2;
}

export default { lnChoose, mcnemar, paired, beats, median };
