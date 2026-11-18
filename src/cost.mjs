// DocDec v2 · src/cost.mjs — the cost case, computed, never typed. Pure.
// Every price and rate comes from data/prices.lock.json (copied verbatim from the estate registry, each with its source
// and the date it was checked). Every quantity comes from the measurement (tokens, seconds, words). The buyer sets
// the volume. What is NOT counted is named: it all sits on the cloud side, so the comparison flatters the cloud.

const fin = (x) => typeof x === 'number' && Number.isFinite(x);
const arr = (x) => (Array.isArray(x) ? x : []);
const pos = (x, d) => (fin(x) && x >= 0 ? x : d);

export function entry(lock, id) { return arr(lock && lock.entries).find((e) => e && e.id === id) || null; }

// perQuestionApiGbp(api, inTok, outTok, gbpPerUsd) → £ for one question's generation call at list price
export function perQuestionApiGbp(api, inTok, outTok, gbpPerUsd) {
  if (!api || !fin(api.inPerM) || !fin(api.outPerM)) return null;
  const usd = (pos(inTok, 0) * api.inPerM + pos(outTok, 0) * api.outPerM) / 1e6;
  return usd * (api.currency === 'GBP' ? 1 : pos(gbpPerUsd, 0));
}
// perQuestionLocalGbp(seconds, watts, pencePerKwh) → £ of electricity for one question on your own machine
export function perQuestionLocalGbp(seconds, watts, pencePerKwh) { return (pos(seconds, 0) * pos(watts, 0)) / 3.6e6 * pos(pencePerKwh, 0) / 100; }
// checkMinutes(words, wpm) → minutes a person spends reading what an answer cites, to check it
export function checkMinutes(words, wpm) { return fin(wpm) && wpm > 0 ? pos(words, 0) / wpm : 0; }

// costCase(lock, measured, inputs) → the monthly and yearly comparison
//   measured: { inTokens, outTokens, localSeconds, passageWords, sentenceWords }
//   inputs:   { questionsPerMonth (default 10000), watts: 'low'|'high' (default 'high'), check: true (default) }
export const API_IDS = ['gpt-5-nano', 'gpt-5-mini', 'gemini-3.1-flash-lite', 'claude-haiku-4.5', 'claude-sonnet-5'];
export function costCase(lock, measured, inputs) {
  const m = measured || {}, i = inputs || {};
  const q = pos(i.questionsPerMonth, 10000);
  const fx = entry(lock, 'fx-gbp-usd'), power = entry(lock, 'intel-i7-1255u-power'), elec = entry(lock, 'desnz-electricity-nondomestic');
  const wage = entry(lock, 'uk-national-living-wage'), cpi = entry(lock, 'ons-cpi'), read = entry(lock, 'brysbaert-2019-reading-rate');
  const watts = power ? (i.watts === 'low' ? power.wattsLow : power.wattsHigh) : 0;
  const localQ = perQuestionLocalGbp(m.localSeconds, watts, elec ? elec.pencePerKwh : 0);
  const check = i.check !== false;
  const minsCloud = check ? checkMinutes(m.passageWords, read ? read.wpm : 0) : 0;
  const minsLocal = check ? checkMinutes(m.sentenceWords, read ? read.wpm : 0) : 0;
  const hourly = wage ? wage.value : 0;
  const staffCloud = (q * minsCloud / 60) * hourly, staffLocal = (q * minsLocal / 60) * hourly;
  const rise = cpi ? cpi.value : 0;
  const apis = API_IDS.map((id) => entry(lock, id)).filter(Boolean).map((api) => {
    const perQ = perQuestionApiGbp(api, m.inTokens, m.outTokens, fx ? fx.gbpPerUsd : 0);
    const month = q * perQ + staffCloud;
    return { id: api.id, model: api.model, provider: api.provider, perQuestionGbp: perQ, monthGbp: month, yearGbp: 12 * month, nextYearGbp: 12 * month * (1 + rise) };
  });
  const localMonth = q * localQ + staffLocal;
  return {
    questionsPerMonth: q, watts, check,
    local: { perQuestionGbp: localQ, electricityMonthGbp: q * localQ, staffMonthGbp: staffLocal, monthGbp: localMonth, yearGbp: 12 * localMonth },
    cloud: { staffMonthGbp: staffCloud, apis },
    checkMinutes: { cloud: minsCloud, docdec: minsLocal },
    savingYearGbp: apis.map((a) => ({ id: a.id, gbp: a.yearGbp - 12 * localMonth })),
    notCounted: ['the cloud stack’s embedding calls and vector-database subscription (no sourced price held, so the cloud side is cheaper here than it is)',
      'hardware: the same machine runs either way, so it cancels out', 'the time spent on answers that are wrong and believed: unmeasured, and the reason grounding exists'],
  };
}

export default { entry, perQuestionApiGbp, perQuestionLocalGbp, checkMinutes, costCase, API_IDS };
