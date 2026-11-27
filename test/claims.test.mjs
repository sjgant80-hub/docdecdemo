// claims.test.mjs — claims.json is current, and its verdicts are the record's own, not asserted here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { build, json } from '../make-claims.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const record = JSON.parse(readFileSync(join(ROOT, 'data/v2/record.json'), 'utf8'));

test('claims.json exists and is exactly what the record forces (never drifts)', () => {
  assert.ok(existsSync(join(ROOT, 'claims.json')), 'run: node make-claims.mjs');
  assert.equal(readFileSync(join(ROOT, 'claims.json'), 'utf8'), json(), 'claims.json is stale — regenerate it');
});

test('every verdict comes from the record, not from this file', () => {
  const b = build();
  for (const row of b.claims) {
    if (row.id === 'C8') continue; // measured.json
    assert.equal(row.pass, record.claims[row.id].pass === true, `${row.id} must mirror the record`);
  }
  // the count is the real one: passed never exceeds total, and the known failures are present
  assert.ok(b.passed < b.total, 'DocDec keeps real failures — passed must be below total');
  assert.equal(b.claims.find((r) => r.id === 'C2').pass, false, 'C2 is a kept failure in the record');
});
