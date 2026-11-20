// node genome/lane-measure.mjs — choose and measure DocDec's lane share on its own sets; writes data/genome-lane.json.
// test/genome.test.mjs re-derives the file from the same data, so the share genome/cell.mjs runs is the measured one.
import { readFileSync, writeFileSync } from 'node:fs';
import { measure } from './lane-share.mjs';
const m = measure(JSON.parse(readFileSync(new URL('../data/v2/s1.json', import.meta.url), 'utf8')));
writeFileSync(new URL('../data/genome-lane.json', import.meta.url), JSON.stringify(m, null, 1) + '\n');
console.log(JSON.stringify(m));
