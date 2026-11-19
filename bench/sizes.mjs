// bench/sizes.mjs — writes data/v2/sizes.json: the bytes the page's re-run downloads, so the page can say so before you
// press the button. test/page.test.mjs checks these against the real files, so the figure cannot drift.
import { statSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const V2 = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'v2');
export const RERUN_FILES = ['s1', 's2', 's3', 's4', 's5', 'h1', 'reader', 'v1', 'record', 'scores-s1'].map((n) => n + '.json');
const bytes = Object.fromEntries(RERUN_FILES.map((f) => [f, statSync(join(V2, f)).size]));
const total = Object.values(bytes).reduce((a, b) => a + b, 0);
writeFileSync(join(V2, 'sizes.json'), JSON.stringify({ rerun: { files: bytes, total } }, null, 1) + '\n');
console.log(`re-run downloads ${(total / 1e6).toFixed(1)} MB across ${RERUN_FILES.length} files`);
