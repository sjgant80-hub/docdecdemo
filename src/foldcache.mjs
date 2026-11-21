// DocDec v2 · src/foldcache.mjs — a memo of retrieval scores (G1 in PREREG.md §8). Pure: no clock, no I/O.
//
// Scoring a question against every passage (late interaction) is the heaviest step after the reader, and its result
// depends on two things only: the question's words and the passages in the index. So when the SAME question comes again
// and the index has not changed, the scores are the same: they are kept, and reused instead of computed again.
//   key       the question, lower-cased, runs of whitespace as one space, trimmed (the model's tokenizer is uncased and
//             splits on whitespace, so equal keys mean equal encodings), together with the index version
//   version   the exact sorted list of the passage-version ids in the index, kept whole (not hashed), so two different
//             indexes can never share a version
//   eviction  keeping anything under a new index version first drops every entry kept under the old one (none of them
//             could ever be used again); beyond the capacity, the least recently used entry goes
// A reworded question has a different key, so this memo never answers it: that is the memory's job (claims C7, C7b).

const str = (x) => (typeof x === 'string' ? x : '');
const usable = (memo) => !!memo && memo.entries instanceof Map;

// createMemo(capacity) → an empty memo (capacity: a whole number of entries above 0, else 1,000)
export function createMemo(capacity) {
  return { capacity: Number.isInteger(capacity) && capacity > 0 ? capacity : 1000, version: null, entries: new Map(), hits: 0, misses: 0, evicted: 0 };
}

// questionKey(question) → the memo's key for a question
export function questionKey(question) { return str(question).toLowerCase().replace(/\s+/g, ' ').trim(); }

// indexVersion(ids) → the index version: every passage-version id in the index, sorted, as one exact string
export function indexVersion(ids) { return JSON.stringify((Array.isArray(ids) ? ids : []).map(String).sort()); }

// lookup(memo, question, version) → the scores kept for this question on this index, or undefined. A hit becomes the
// most recently used entry.
export function lookup(memo, question, version) {
  if (!usable(memo) || version !== memo.version) return undefined;
  const k = questionKey(question);
  if (!memo.entries.has(k)) return undefined;
  const value = memo.entries.get(k);
  memo.entries.delete(k);
  memo.entries.set(k, value);
  return value;
}

// put(memo, question, version, value) — keep value for this question on this index. A new index version empties the
// memo first; beyond the capacity the least recently used entry goes. Returns how many entries this call evicted.
export function put(memo, question, version, value) {
  if (!usable(memo)) return 0;
  let gone = 0;
  if (version !== memo.version) { gone = memo.entries.size; memo.entries.clear(); memo.version = version; }
  const k = questionKey(question);
  memo.entries.delete(k);
  memo.entries.set(k, value);
  while (memo.entries.size > memo.capacity) { memo.entries.delete(memo.entries.keys().next().value); gone++; }
  memo.evicted += gone;
  return gone;
}

// scored(memo, question, version, compute) → { value, hit }: the kept scores when this question was already scored on
// this index, else compute() (kept for next time). Without a usable memo it simply computes.
export function scored(memo, question, version, compute) {
  const run = () => (typeof compute === 'function' ? compute() : undefined);
  if (!usable(memo)) return { value: run(), hit: false };
  const kept = lookup(memo, question, version);
  if (kept !== undefined) { memo.hits++; return { value: kept, hit: true }; }
  memo.misses++;
  const value = run();
  if (value !== undefined) put(memo, question, version, value);
  return { value, hit: false };
}

export default { createMemo, questionKey, indexVersion, lookup, put, scored };
