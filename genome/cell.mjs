// cell.mjs — DocDec's three answers for the birth check (seed.json, genome/).
//
// judge  DocDec's own audit, claim C6: an answer record is verified when its words are exactly the cited passage's
//        characters at its offsets in DocDec's index; unverified when they are not; refused when the input is not an
//        answer record, or cites a passage that is not in the index.
// lane   a word-overlap check over the same index (genome/lane-share.mjs): a question is in lane when enough of its
//        content words appear as whole words in the indexed passages. The share is the one chosen and measured on
//        DocDec's own question sets (data/genome-lane.json). It is not DocDec's measured refusal (that is the gate,
//        with the 34 MB model); it is the boundary a conductor can check before it calls DocDec at all.
import { readFileSync } from 'node:fs';
import { laneShare, vocabulary } from './lane-share.mjs';

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const docs = read('../data/v2/freebox.json').docs;
const byId = new Map(docs.map((d) => [d.id, d.text]));
const VOCAB = vocabulary(docs);
export const LANE = read('../data/genome-lane.json');

export async function judge(input) {
  const rec = input !== null && typeof input === 'object' && typeof input.source === 'string' && Number.isInteger(input.start)
    && Number.isInteger(input.end) && typeof input.text === 'string';
  if (!rec || !byId.has(input.source)) return 'refused';
  return byId.get(input.source).slice(input.start, input.end) === input.text ? 'verified' : 'unverified';
}

export async function inLane(input) {
  const q = input !== null && typeof input === 'object' ? input.question : null;
  return typeof q === 'string' && laneShare(q, VOCAB) >= LANE.share;
}

// health: DocDec cannot see its page's visitors or its callers from inside the repository, so it says so
export async function health() {
  return { used: null, dependedOn: null, lastEarned: null };
}
