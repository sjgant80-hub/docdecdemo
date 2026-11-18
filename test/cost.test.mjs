import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import K from '../src/cost.mjs';

const lock = JSON.parse(readFileSync(new URL('../data/prices.lock.json', import.meta.url), 'utf8'));
const near = (a, b, eps = 1e-12) => Math.abs(a - b) < eps;

test('the lock holds every entry the cost case reads, each sourced and dated', () => {
  for (const id of [...K.API_IDS, 'fx-gbp-usd', 'intel-i7-1255u-power', 'desnz-electricity-nondomestic', 'uk-national-living-wage', 'ons-cpi', 'brysbaert-2019-reading-rate']) {
    const e = K.entry(lock, id);
    assert.ok(e, id);
    assert.ok(typeof e.source === 'string' && e.source.length > 10, id + ' has a source');
    assert.match(e.checked || '', /^2026-\d\d-\d\d$/, id + ' has a check date');
  }
  assert.equal(K.entry(lock, 'nope'), null);
  assert.equal(K.entry(null, 'x'), null);
  assert.equal(K.entry({ entries: [null, { id: 'x' }] }, 'x').id, 'x');
});

test('perQuestionApiGbp: list prices per million tokens, converted to pounds', () => {
  const api = { inPerM: 2, outPerM: 10, currency: 'USD' };
  assert.ok(near(K.perQuestionApiGbp(api, 1000, 100, 0.75), (1000 * 2 + 100 * 10) / 1e6 * 0.75));
  assert.ok(near(K.perQuestionApiGbp({ inPerM: 1, outPerM: 1, currency: 'GBP' }, 1e6, 0, 0.5), 1), 'a GBP price is not converted');
  assert.equal(K.perQuestionApiGbp(null, 1, 1, 1), null);
  assert.equal(K.perQuestionApiGbp({ inPerM: 'x', outPerM: 1 }, 1, 1, 1), null);
  assert.equal(K.perQuestionApiGbp({ inPerM: NaN, outPerM: 1 }, 1, 1, 1), null, 'NaN is not a price');
  assert.equal(K.perQuestionApiGbp({ inPerM: 1, outPerM: 'x' }, 1, 1, 1), null);
  assert.equal(K.perQuestionApiGbp(api, -5, -5, 1), 0, 'negative tokens read as 0');
  assert.equal(K.perQuestionApiGbp(api, 0, 0, 1), 0, 'zero tokens cost nothing');
});

test('perQuestionLocalGbp / checkMinutes', () => {
  assert.ok(near(K.perQuestionLocalGbp(3600, 1000, 100), 1), 'a kilowatt for an hour at 100p is one pound');
  assert.ok(near(K.perQuestionLocalGbp(10, 55, 24.51), 10 * 55 / 3.6e6 * 0.2451));
  assert.equal(K.perQuestionLocalGbp(-1, 55, 20), 0);
  assert.equal(K.perQuestionLocalGbp(0, 55, 20), 0);
  assert.equal(K.checkMinutes(238, 238), 1);
  assert.equal(K.checkMinutes(100, 0), 0);
  assert.equal(K.checkMinutes(100, -3), 0);
  assert.equal(K.checkMinutes(100, 'x'), 0);
  assert.equal(K.checkMinutes(-4, 238), 0);
});

test('costCase: totals add up from the parts; the buyer sets volume, power and checking', () => {
  const m = { inTokens: 300, outTokens: 6, localSeconds: 4, passageWords: 120, sentenceWords: 24 };
  const c = K.costCase(lock, m, { questionsPerMonth: 1000 });
  assert.equal(c.questionsPerMonth, 1000);
  assert.equal(c.watts, 55, 'default: the chip’s maximum turbo power, the figure least kind to the local side');
  assert.ok(near(c.local.electricityMonthGbp, 1000 * K.perQuestionLocalGbp(4, 55, 24.51)));
  assert.ok(near(c.checkMinutes.cloud, 120 / 238)); assert.ok(near(c.checkMinutes.docdec, 24 / 238));
  assert.ok(near(c.cloud.staffMonthGbp, 1000 * (120 / 238) / 60 * 12.71, 1e-9));
  assert.ok(near(c.local.monthGbp, c.local.electricityMonthGbp + c.local.staffMonthGbp));
  assert.equal(c.cloud.apis.length, K.API_IDS.length);
  for (const a of c.cloud.apis) {
    assert.ok(near(a.monthGbp, 1000 * a.perQuestionGbp + c.cloud.staffMonthGbp, 1e-9));
    assert.ok(near(a.yearGbp, 12 * a.monthGbp, 1e-9));
    assert.ok(near(a.nextYearGbp, a.yearGbp * 1.031, 1e-9));
  }
  assert.ok(near(c.savingYearGbp[0].gbp, c.cloud.apis[0].yearGbp - c.local.yearGbp, 1e-9));
  const low = K.costCase(lock, m, { questionsPerMonth: 1000, watts: 'low' });
  assert.equal(low.watts, 15);
  const off = K.costCase(lock, m, { questionsPerMonth: 1000, check: false });
  assert.equal(off.cloud.staffMonthGbp, 0); assert.equal(off.local.staffMonthGbp, 0); assert.equal(off.check, false);
  const dflt = K.costCase(lock, m, {});
  assert.equal(dflt.questionsPerMonth, 10000, 'default volume 10,000 a month');
  assert.equal(K.costCase(lock, m, { questionsPerMonth: -3 }).questionsPerMonth, 10000);
  assert.equal(K.costCase(lock, m, { questionsPerMonth: 0 }).questionsPerMonth, 0, 'zero is a volume');
  const bare = K.costCase({ entries: [] }, null, null);
  assert.equal(bare.watts, 0); assert.equal(bare.cloud.apis.length, 0); assert.equal(bare.local.monthGbp, 0);
  assert.ok(bare.notCounted.length >= 3);
  const noRise = K.costCase({ entries: [K.entry(lock, 'gpt-5-mini'), K.entry(lock, 'fx-gbp-usd')] }, m, { questionsPerMonth: 1 });
  assert.ok(near(noRise.cloud.apis[0].nextYearGbp, noRise.cloud.apis[0].yearGbp), 'no CPI entry: no rise');
  const usd = K.costCase({ entries: [K.entry(lock, 'gpt-5-mini')] }, m, { questionsPerMonth: 1 });
  assert.equal(usd.cloud.apis[0].perQuestionGbp, 0, 'no exchange rate held: a USD price is not guessed into pounds');
});
