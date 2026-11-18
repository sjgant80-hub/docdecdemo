// DocDec v2 · src/publish.mjs — what gets published from a measurement, and how two records are compared. Pure.
// One definition, used by the generator (bench/export.mjs), CI (test/record.test.mjs) and the page's re-run.

const strip = (o) => JSON.parse(JSON.stringify(o, (k, v) => (k === 'per' ? undefined : v)));

// publishable(rec, examples, sources) → the record exactly as data/v2/record.json holds it
export function publishable(rec, examples, sources) {
  const pub = Object.fromEntries(Object.entries(rec).filter(([k]) => !k.startsWith('_') && k !== 'needs' && k !== 'hotPairs'));
  const a = rec.s3 && rec.s3.answers ? rec.s3.answers : null;
  const complete = rec.needs.length === 0 && (!a || (a.graph.missing === 0 && a.cosineTop2.missing === 0));
  return { ...strip(pub), examples: strip(examples), complete, sources };
}

// compareRecords(a, b) → { fields: leaves compared, diffs: ['path: a vs b'] } over every leaf of either record
export function compareRecords(a, b) {
  const diffs = []; let fields = 0;
  const walk = (x, y, path) => {
    const ox = x !== null && typeof x === 'object', oy = y !== null && typeof y === 'object';
    if (ox && oy) {
      const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
      for (const k of keys) walk(x[k], y[k], path ? path + '.' + k : k);
      return;
    }
    fields++;
    if (JSON.stringify(x) !== JSON.stringify(y)) diffs.push(`${path}: ${JSON.stringify(x)} vs ${JSON.stringify(y)}`);
  };
  walk(a, b, '');
  return { fields, diffs };
}

export default { publishable, compareRecords };
