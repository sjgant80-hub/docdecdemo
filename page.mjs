// page.mjs — renders DocDec v2's page from the shipped record. Every number on the page comes from data/v2/record.json
// (or the cost kernel run on data/prices.lock.json + data/v2/measured.json); none is typed into the HTML.
import K from './src/cost.mjs';
import { passMatched, passFresh, passCache, passRecycle } from './src/measure.mjs';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (x) => (typeof x === 'number' ? (100 * x).toFixed(1) + '%' : 'n/a');
const p = (t) => (t && typeof t.p === 'number' ? (t.p < 0.0001 ? 'p < 0.0001' : 'p = ' + t.p.toFixed(4)) : '');
const gbp = (x) => (typeof x === 'number' ? '£' + (x >= 100 ? Math.round(x).toLocaleString('en-GB') : x >= 1 ? x.toFixed(2) : x.toFixed(4)) : 'n/a');
const tag = (ok) => `<span class="tag ${ok ? 'pass' : 'fail'}">${ok ? 'PASS' : 'FAIL'}</span>`;
const pid = (id) => esc(String(id).replace(/_/g, ' '));

// theme
(() => { const b = $('themeBtn'); let t = null; try { t = localStorage.getItem('dd-theme'); } catch (e) { /* storage off */ } if (t) document.documentElement.setAttribute('data-theme', t);
  b.addEventListener('click', () => { const c = document.documentElement.getAttribute('data-theme'); const dark = matchMedia('(prefers-color-scheme:dark)').matches; const n = (c || (dark ? 'dark' : 'light')) === 'dark' ? 'light' : 'dark'; document.documentElement.setAttribute('data-theme', n); try { localStorage.setItem('dd-theme', n); } catch (e) { /* storage off */ } }); })();

const get = (u) => fetch(u).then((r) => { if (!r.ok) throw new Error(u + ' ' + r.status); return r.json(); });
const [R, LOCK, MEAS, GATES, PAR] = await Promise.all([get('data/v2/record.json'), get('data/prices.lock.json'), get('data/v2/measured.json').catch(() => null), get('data/v2/gates.json').catch(() => null), get('data/v2/parity.json').catch(() => null)]);
if (PAR) $('fbParity').textContent = `Checked before publishing: its tokenizer matches the model's own on ${PAR.tokenizer.identical} of ${PAR.tokenizer.texts} texts, and this browser runtime picks the same best passage on ${PAR.sameTopPassage} of ${PAR.questions} test questions and the same gate decision on ${PAR.sameGateDecision} (${PAR.vectors.identical} of ${PAR.vectors.values} vector values identical; the largest difference is ${PAR.vectors.maxDifference127ths}/127).`;
window.__record = R;
const C = R.claims;

// ── hero badges + the guild line ──
const c8pass = !!(MEAS && MEAS.c8 && MEAS.c8.pass === true);
const passN = Object.values(C).filter((c) => c.pass).length + (MEAS ? (c8pass ? 1 : 0) : 0), n = Object.keys(C).length + (MEAS ? 1 : 0);
$('badges').innerHTML = `<span class="badge ${passN === n ? 'ok' : ''}">${passN} of ${n} claims pass their pre-registered rule</span>` +
  Object.entries(C).map(([k, c]) => `<span class="badge ${c.pass ? 'ok' : 'no'}">${k} ${c.pass ? 'pass' : 'fail'}</span>`).join('') +
  (MEAS ? `<span class="badge ${c8pass ? 'ok' : 'no'}">C8 ${c8pass ? 'pass' : 'fail'}</span>` : '') +
  '<span class="badge">runs offline on a laptop CPU</span><span class="badge">re-run every number in your browser</span>';
if (R.v1) $('v1line').innerHTML = `DocDec v1 at its own published setting got <b>${pct(R.v1.accuracy)}</b> of the held-out decisions right (refused ${pct(R.v1.v1Refusal)} of unanswerable questions, answered ${pct(R.v1.v1Recall)} of answerable ones right); the tuned-cosine baseline got <b>${pct(R.v1.baseline)}</b> (refused ${pct(R.v1.baselineRefusal)}, answered ${pct(R.v1.baselineRecall)} right); ${R.v1.test.aOnly} questions went v1's way and ${R.v1.test.bOnly} the baseline's (${p(R.v1.test)}). ${R.v1.accuracy <= R.v1.baseline || R.v1.test.p >= 0.05 ? 'The finding holds: v1 did not beat the baseline.' : 'On this re-run v1 came out ahead; the finding is shown as measured.'}`;

// ── the claims board ──
const d = (k) => C[k].detail;
// the bars, read from the pre-registered pass rules themselves (src/measure.mjs), never retyped here
const scan = (ok) => { let last = null; for (let i = 0; i <= 1000; i++) if (ok(i / 1000)) last = i / 1000; return last; };
const BAR = { recallGap: scan((g) => passMatched(true, 0.5 - g, 0.5)), fresh: 1 - scan((g) => passFresh(1 - g, 1, true)),
  falseServe: scan((f) => passCache({ bar: 1, warm: 1, cold: 0, falseServeRate: f, served: 1, staleServed: 0 })),
  recycleFalseServe: scan((f) => passRecycle({ bar: 1, warm: 1, cold: 0, falseServeRate: f, served: 1, staleServed: 0 })) };
const pts = (x) => (100 * x).toFixed(1) + ' points';
// one line per failed claim: which part of its rule failed, from the record
const WHY = {
  C2: (x) => (!x.a.pass ? 'Decision accuracy did not beat the baseline.' : x.b && x.b.v2Recall !== undefined ? `Safer, but over the line: it refuses ${pct(x.b.v2Refusal)} of unanswerable questions against the baseline's ${pct(x.b.baselineRefusal)}, and answers ${pts(x.b.baselineRecall - x.b.v2Recall)} fewer answerable ones right; the rule allowed ${pts(BAR.recallGap)}.` : esc(x.b && x.b.why)),
  C5: () => { const s = R.s4, miss = s.n - s.retrieval.latestMemory; return `Retrieval, not staleness: as of today only current versions are in its index, so it never served an old one. In ${miss} of ${s.n} cases it picked a different paragraph altogether, so it returned the current version ${pct(d('C5').latestMemory)} of the time against a bar of ${pct(BAR.fresh)}${d('C5').history < BAR.fresh ? `, and the as-of-2021 read missed the same way (${pct(d('C5').history)})` : ''}.`; },
  C7: (x) => { const f = []; if (!(x.warmAccuracy >= x.coldAccuracy)) f.push(`with the memory it was slightly less accurate (${pct(x.warmAccuracy)} against ${pct(x.coldAccuracy)})`);
    if (!(x.falseServeRate <= BAR.falseServe)) f.push(`it gave stored answers to ${pct(x.falseServeRate)} of unanswerable reworded questions (the bar was ${pct(BAR.falseServe)})`);
    if (!(x.readerCallsSaved > 0)) f.push('it saved no reader calls'); if (x.staleServed !== 0) f.push(`it served ${x.staleServed} stale answers`);
    return `The memory does not earn its place yet: ${f.join('; ')}. It did save ${x.readerCallsSaved} reader calls and served no stale answer.`; },
  C7b: (x) => { const f = [];
    if (x.matchBar === null) f.push('no match bar qualified on the tune split, so the memory was off');
    else if (!(x.served > 0)) f.push('nothing was served on the held-out questions');
    if (!(x.falseServeRate <= BAR.recycleFalseServe)) f.push(`it gave stored answers to ${pct(x.falseServeRate)} of unanswerable reworded questions (the bar was ${pct(BAR.recycleFalseServe)})`);
    if (!(x.warmAccuracy >= x.coldAccuracy)) f.push(`with the memory it was less accurate (${pct(x.warmAccuracy)} against ${pct(x.coldAccuracy)})`);
    if (x.staleServed !== 0) f.push(`it served ${x.staleServed} stale answers`);
    return `Reusing the work and re-checking it did not pass either: ${f.join('; ')}. It served ${x.served} reworded questions from memory and saved ${x.readerCallsSaved} reader calls; against the cold path it won ${x.test.aOnly} question${x.test.aOnly === 1 ? '' : 's'} and lost ${x.test.bOnly}; after the changes ${x.staleServed} stale answers were served and ${x.staleCaught} caught.${c7bWhy()}`; },
};
// C7b's false serves, read from the record: which the cold path got wrong too, and which it refused (and at which check)
function c7bWhy() {
  const b = R.s5b; if (!b || !(b.falseServes > 0)) return '';
  const L = b.lostWhereColdWasRight, at = [1, 2, 3, 4, 5].filter((k) => L[k] > 0), lost = at.reduce((a, k) => a + L[k], 0);
  const only4 = at.length === 1 && at[0] === 4;
  return ` Why, found after the result: of the ${b.falseServes} stored answers given to unanswerable questions, ${b.falseServes - lost} the cold path got wrong too (it answered those questions itself)${lost ? `, and ${lost} it refused ${only4 ? 'only because its own reader call, made afresh for the new question, found no answer in the passage (check 4), a check that reused work cannot repeat without a new reader call' : `at ${at.map((k) => `check ${k} (${L[k]})`).join(', ')}`}` : ''}.`;
}
// a line under a claim whatever its verdict (C7b is new: when it passes, it still says what changed from C7)
const SAYS = {
  C7b: (x) => `A second design, pre-registered after C7 failed: the memory keeps the work behind each answer (the passage, its scores, the reader's phrase) and re-runs the gate's checks for the new question on the current passage before serving anything. ${x.served} reworded questions were served from memory and ${x.readerCallsSaved} reader calls saved; after the changes ${x.staleServed} stale answers were served and ${x.staleCaught} caught.`,
};
const row = (k, cells) => `<tr><td><b>${k}</b> ${esc(C[k].claim)}${!C[k].pass && WHY[k] ? `<br><span class="small muted">${WHY[k](d(k))}</span>` : C[k].pass && SAYS[k] ? `<br><span class="small muted">${SAYS[k](d(k))}</span>` : ''}</td>${cells}<td>${tag(C[k].pass)}</td></tr>`;
const rows = [
  row('C1', `<td>right passage first: ${pct(d('C1').s1.colbert)} (guild corpus), ${pct(d('C1').s2.colbert)} (9x corpus)</td><td>${pct(d('C1').s1.cosine)}, ${pct(d('C1').s2.cosine)}</td><td>${p(d('C1').s1.test)}; ${p(d('C1').s2.test)}</td>`),
  row('C2', `<td>decisions right ${pct(d('C2').a.v2)}; at the baseline's recall, refuses ${pct(d('C2').b.v2Refusal)} of unanswerable (recall ${pct(d('C2').b.v2Recall)})</td><td>${pct(d('C2').a.baseline)}; refuses ${pct(d('C2').b.baselineRefusal)} (recall ${pct(d('C2').b.baselineRecall)})</td><td>${p(d('C2').a.test)}; ${p(d('C2').b.test)}</td>`),
  row('C3', `<td>both right sources cited: ${pct(d('C3').graph)}</td><td>cosine top-2: ${pct(d('C3').cosineTop2)}</td><td>${p(d('C3').test)}</td>`),
  row('C4', `<td>decisions right at 9x: ${pct(d('C4').v2)} (precision ${pct(d('C4').precisionS2)}, was ${pct(d('C4').precisionS1)})</td><td>${pct(d('C4').baseline)}</td><td>${p(d('C4').test)}</td>`),
  row('C5', `<td>latest version: ${pct(d('C5').latestMemory)}; history as of 2021: ${pct(d('C5').history)}</td><td>flat index: ${pct(d('C5').latestFlat)}</td><td>${p(d('C5').test)}</td>`),
  row('C6', `<td>${d('C6').verbatim} of ${d('C6').audited} answers found word for word at their offsets</td><td>a cloud RAG gives no offsets to check</td><td>exact count</td>`),
  row('C7', `<td>right ${pct(d('C7').warmAccuracy)} with memory, ${d('C7').readerCallsSaved} reader calls saved, ${pct(d('C7').falseServeRate)} false serves, ${d('C7').staleServed} stale serves</td><td>without memory: ${pct(d('C7').coldAccuracy)}</td><td>pass rule: no worse, false serves at most 1%, no stale serve</td>`),
  ...(C.C7b ? [row('C7b', `<td>right ${pct(d('C7b').warmAccuracy)} with memory, ${d('C7b').served} served after the re-check, ${d('C7b').readerCallsSaved} reader calls saved, ${pct(d('C7b').falseServeRate)} false serves, ${d('C7b').staleServed} stale serves</td><td>without memory: ${pct(d('C7b').coldAccuracy)}</td><td>pass rule: no worse, false serves at most ${pct(BAR.recycleFalseServe)}, no stale serve, something served (${p(d('C7b').test)}, reported only)</td>`)] : []),
];
// C8 is decided by the speed run's own record (bench/latency.mjs): every outgoing connection it opened, and its medians
const c8 = MEAS && MEAS.c8 ? MEAS.c8 : null;
const netLine = (nw) => { if (!nw || !Array.isArray(nw.connections)) return 'connections not recorded';
  const total = nw.connections.reduce((a, [, k]) => a + k, 0), hosts = nw.connections.map(([h]) => esc(h)).join(', ');
  if (nw.outside.length) return `connections left the machine: ${nw.outside.map(esc).join(', ')}`;
  return total === 1 ? `its one network connection went to this machine (${hosts}) and was reused for every call`
    : `all ${total} of its network connections went to this machine (${hosts})`; };
const sp = MEAS ? `<tr><td><b>C8</b> Sovereign and cheap</td><td>${netLine(MEAS.network)}; about ${MEAS.localSecondsPerQuestion} s a question on a ${esc(MEAS.machine.cpu)}${MEAS.conditions && !MEAS.conditions.quiet ? ', timed while other jobs shared the machine (see the speed table)' : ''}</td><td>a cloud API call per question</td><td>connections recorded on one machine</td><td>${tag(c8 !== null && c8.pass === true)}</td></tr>` : '';
$('claimsTbl').querySelector('tbody').innerHTML = rows.join('') + sp;
$('claimsNote').textContent = `Held-out questions: ${R.splits.s1.eval} on the guild corpus (its first ${R.splits.s1.tune} tuned every setting), ${R.s3.eval} multi-hop, ${R.s4.n} changed facts. ${R.complete ? 'Every reader call the measurement needed was made.' : 'Some reader calls were missing when this record was made; the affected numbers count them as refusals.'}` +
  (R.sources && R.sources.readerThreads ? ` The reader (${R.sources.reader}, temperature ${R.sources.readerOptions.temperature}, seed ${R.sources.readerOptions.seed}) ran on CPU; its answers by thread count, a speed setting only: ${Object.entries(R.sources.readerThreads).map(([t, k]) => `${k} at ${t === 'Ollama default (6 on this laptop)' ? 'the default 6 threads' : t + ' threads'}`).join(', ')}.` : '');

// ── examples ──
const E = R.examples;
const mark = (text, start, end) => esc(text.slice(0, start)) + '<mark>' + esc(text.slice(start, end)) + '</mark>' + esc(text.slice(end));
const evid = (rows) => `<div class="ev">${rows.map((r) => `<span class="${r.sim < 0.5 ? 'weak' : ''}" title="best match in the passage">${esc(r.token)} → ${esc(r.matched ?? '—')} ${r.sim.toFixed(2)}</span>`).join('')}</div>`;
const li = (x, win) => `<div class="card"><p class="q">${esc(x.question)}</p><p class="small muted">The right passage: ${pid(x.gold)} · the answer: ${esc(x.answers.join(' / '))}</p>
  <div class="grid two"><div><p class="small"><b>One vector (cosine)</b> picked ${pid(x.cosine.id)} <span class="verdict ${x.cosine.id === x.gold ? 'ok' : 'no'}">${x.cosine.id === x.gold ? 'right' : 'wrong'}</span></p><div class="passage">${esc(x.cosine.text)}</div></div>
  <div><p class="small"><b>Late interaction (ColBERT)</b> picked ${pid(x.colbert.id)} <span class="verdict ${x.colbert.id === x.gold ? 'ok' : 'no'}">${x.colbert.id === x.gold ? 'right' : 'wrong'}</span></p><div class="passage">${esc(x.colbert.text)}</div>
  <p class="small muted">Each question word and its best match in this passage (similarity 0 to 1; weak matches in red):</p>${evid(x.colbert.evidence)}</div></div>${win ? '' : '<p class="small muted">The other way round, kept: here the single vector was right and late interaction was not.</p>'}</div>`;
$('exLate').innerHTML = (E.lateWins.length ? E.lateWins.map((x) => li(x, true)).join('') : '<p class="muted">No held-out question had cosine wrong and late interaction right.</p>') + E.lateLoses.map((x) => li(x, false)).join('');

$('exRefuse').innerHTML = (E.offTopic ? `<div class="card"><p class="small muted">A question about a different subject entirely:</p><p class="q">${esc(E.offTopic.question)}</p><p><span class="verdict no">Refused</span>: ${esc(E.offTopic.why)}. The nearest passage it had was ${pid(E.offTopic.nearest.id)}.</p></div>` : '') +
  E.nearMiss.map((x) => `<div class="card"><p class="small muted">A question written to look answerable from one paragraph (it is not). The baseline answered it from ${pid(x.baselineAnswered.id)}.</p><p class="q">${esc(x.question)}</p>
  <p><span class="verdict no">Refused at check ${x.check}</span>: ${esc(x.why)}.${x.check === 4 ? ` The reader looked at ${pid(x.v2Looked.id)} and said “${esc(x.reader)}”.` : ''}</p><div class="passage">${esc(x.v2Looked.text)}</div></div>`).join('');

if (E.grounded) { const g = E.grounded; $('exGrounded').innerHTML = `<div class="card"><p class="q">${esc(g.question)}</p><p><span class="verdict ok">Answer:</span> <b>${esc(g.span.text)}</b> — from ${pid(g.source.id)}, characters ${g.span.start} to ${g.span.end}. Anyone can check that those characters of that passage say exactly this.</p>
  <div class="passage">${mark(g.source.text, g.span.start, g.span.end)}</div><p class="small muted">The question's words and their best matches in the passage:</p>${evid(g.evidence)}</div>`; }

if (E.multiHop) { const m = E.multiHop; const cd = m.composed; $('exMulti').innerHTML = `<div class="card"><p class="q">${esc(m.question)}</p><p class="small muted">A ${esc(m.type)} question: it needs ${pid(m.gold[0])} and ${pid(m.gold[1])}. Expected answer: ${esc(m.answer)}.</p>
  <div class="grid two"><div><p class="small"><b>Single retrieval, top two passages</b></p>${m.single.map((s) => `<div class="passage"><b>${pid(s.id)}</b> <span class="verdict ${m.gold.includes(s.id) ? 'ok' : 'no'}">${m.gold.includes(s.id) ? 'needed for the answer' : 'not needed for the answer'}</span><br>${esc(s.text)}</div>`).join('')}</div>
  <div><p class="small"><b>DocDec's graph walk</b>${m.linked ? ': the first passage mentions the second, so the walk follows it' : ''}</p>${m.walk.map((s) => `<div class="passage"><b>${pid(s.id)}</b> <span class="verdict ${m.gold.includes(s.id) ? 'ok' : 'no'}">${m.gold.includes(s.id) ? 'needed for the answer' : 'not needed for the answer'}</span><br>${esc(s.text)}</div>`).join('')}
  ${cd && !cd.refuse ? `<p><span class="verdict ok">Composed answer:</span> <b>${esc(cd.answer)}</b>${cd.verdict ? ' (a yes/no verdict, with each source cited by its sentence)' : ''}</p><p class="small muted">Cited: “${esc(cd.cites[0].text)}” and “${esc(cd.cites[1].text)}”</p>` : cd ? `<p><span class="verdict no">Refused</span>: ${esc(cd.why)}</p>` : ''}</div></div></div>`; }

if (E.fresh) { const f = E.fresh; const diff = (txt, val) => { const i = txt.indexOf(val); return i < 0 ? esc(txt) : mark(txt, i, i + val.length); };
  $('exFresh').innerHTML = `<div class="card"><p class="q">${esc(f.question)}</p><p class="small muted">The paragraph changed on ${esc(f.v2.validFrom)}: “${esc(f.oldAnswer)}” became “${esc(f.newAnswer)}”. (A synthetic change to test the mechanism.)</p>
  <div class="row"><button type="button" id="asNow">As of today</button><button type="button" class="ghost" id="asThen">As of 2021</button></div><div id="freshView" style="margin-top:10px"></div>
  <p class="small"><b>A flat index</b> holds both versions side by side; it picked ${f.flatPicked.endsWith('@v1') ? 'the OLD version' : 'the new version'} and answered “${esc(f.flatSaid ?? 'nothing')}”.</p></div>`;
  const show = (now) => { $('freshView').innerHTML = now ? `<p><span class="verdict ok">DocDec, as of today:</span> reads only the version valid today and answers “${esc(f.memorySaid ?? 'nothing')}”.</p><div class="passage">${diff(f.v2.text, f.newAnswer)}</div>`
    : `<p><span class="verdict warn">DocDec, as of 2021:</span> the old version, which was true then, is kept with its end date, so history has an answer.</p><div class="passage">${diff(f.v1.text, f.oldAnswer)}</div>`; $('asNow').className = now ? '' : 'ghost'; $('asThen').className = now ? 'ghost' : ''; };
  $('asNow').onclick = () => show(true); $('asThen').onclick = () => show(false); show(true); }

{ const s = R.s5; const c = C.C7.detail; $('exMemory').innerHTML = s ? `<div class="card"><p>Every answer DocDec verified was remembered with its source, version and exact words: <b>${s.answersGiven}</b> answers consolidated into <b>${s.remembered}</b> facts (the same words from the same source are one fact, with everyone who asked kept as its provenance), and <b>${s.refusedLogged}</b> refused questions logged as gaps. Then every held-out question was asked again in different words (written by the local model).
  A remembered answer is only served if the new question matches a remembered one closely (the bar was chosen on the tune split so that at most 1% of tune unanswerable questions got a stored answer) <i>and</i> its exact words are still in the current version of the source.</p>
  <p>Served from memory: <b>${s.served}</b> of ${s.eval} (${s.served} reader calls saved). Right with the memory: ${pct(c.warmAccuracy)}; without it: ${pct(c.coldAccuracy)}. Stored answers wrongly given to unanswerable questions: <b>${s.falseServes}</b>.
  After the fresh-set changes landed, answers whose source changed were caught by the re-check ${s.staleCaught} times and served stale <b>${s.staleServed}</b> times.
  Four months of no use later, the metabolism keeps ${s.metabolismFourMonthsLater.kept} cached answers and prunes ${s.metabolismFourMonthsLater.pruned}; the source versions themselves are never pruned.</p></div>` : '<p class="muted">Not measured.</p>';
  const b = R.s5b; if (b && C.C7b) { const x = C.C7b.detail, st = b.stoppedBy, sp = b.servedSpans;
    $('exMemory').innerHTML += `<div class="card"><p><b>A second design (claim C7b, ${C.C7b.pass ? 'passed' : 'failed'}).</b> That memory stored answers, and C7 failed. This one, pre-registered before it was measured, keeps the <i>work</i> behind each answer instead: the passage it chose, its scores and the reader's phrase, for <b>${b.kept}</b> answered questions.
  A reworded question first finds its closest remembered question. If that match reaches ${b.matchBar ?? 'a bar (none qualified, so the memory was off)'} (the lowest bar at which no more than ${pct(BAR.recycleFalseServe)} of tune unanswerable questions would have been served after the re-check), the gate's checks run again <i>for the new question</i> on the current version of that one passage: its own score against the bar, every content word of the new question supported, and the reader's phrase found word for word at the same characters. Only then is anything served. No new reader call is made.</p>
  <p>Served from memory: <b>${b.served}</b> of ${b.eval}; ${b.tried - b.served} more cleared the match but were stopped by the re-check (${st[2]} at the bar, ${st[3]} at the evidence check, ${st[5]} word for word, ${st.offsets} moved, ${st[4] + st.other} other). Right with the memory: ${pct(x.warmAccuracy)}; without it: ${pct(x.coldAccuracy)}. Stored answers wrongly given to unanswerable questions: <b>${b.falseServes}</b> of ${b.unanswerable}.
  After the fresh-set changes: served stale <b>${b.afterChanges.staleServed}</b> times, caught ${b.afterChanges.staleCaught} times.
  Reader calls saved: ${b.readerCallsSaved}. Passages scored: ${b.passagesScored.withMemory.toLocaleString('en-GB')} with the memory against ${b.passagesScored.without.toLocaleString('en-GB')} without, though every question is first matched against all ${b.matchedAgainstPerQuestion} remembered questions, served or not.
  A reused phrase answered the earlier question, not always the new one: of ${sp.answerable} answerable questions served, ${sp.exactMatch} were word-for-word right answers; the cold path got ${sp.coldExactMatchOnSame} of the same questions word-for-word right.${C.C7b.pass ? '' : c7bWhy()}</p></div>`; } }

$('exFail').innerHTML = `<div class="grid two"><div class="card"><p class="small"><b>Refused, though the answer was there</b></p>${E.refusedAnswerable.map((x) => `<p class="q">${esc(x.question)}</p><p class="small">Answer was: ${esc(x.answers.join(' / '))}. Refused at check ${x.check}: ${esc(x.why)}.</p>`).join('')}</div>
  <div class="card"><p class="small"><b>Answered, though it should have refused</b></p>${E.answeredUnanswerable.map((x) => `<p class="q">${esc(x.question)}</p><p class="small">Gave “${esc(x.span.text)}” from ${pid(x.source.id)}: the words really are there, but they do not answer this question.</p>`).join('')}</div></div>`;

{ const gv = R.globalView, rc = gv.refusedByCheck, total = Object.values(rc).reduce((a, b) => a + b, 0);
  const why = { 1: 'there was nothing to search', 2: 'no source cleared the bar', 3: 'a content word had no support', 4: 'the reader found no answer in the best source', 5: 'the reader’s phrase was not in the source' };
  $('exPicture').innerHTML = `<div class="grid two"><div class="card"><p class="small"><b>What the nine-times corpus holds</b>: its ${gv.themes.length} themes, biggest first, each with its most distinctive words (a flat index has no such view; this comes from the graph layer).</p>
  <div class="tbl"><table><tr><th>Theme</th><th class="num">Passages</th><th>Distinctive words</th></tr>${gv.themes.slice(0, 12).map((t) => `<tr><td>${esc(t.title.replace(/_/g, ' '))}</td><td class="num">${t.paragraphs}</td><td class="small">${esc(t.words.join(', '))}</td></tr>`).join('')}</table></div>
  <p class="small muted">${gv.themes.length > 12 ? `and ${gv.themes.length - 12} more.` : ''}</p></div>
  <div class="card"><p class="small"><b>What it was asked and refused</b> (held-out questions on the guild corpus, by the check that refused them). In use, this log is the list of gaps in your documents.</p>
  <div class="tbl"><table><tr><th>Refused because</th><th class="num">Questions</th></tr>${Object.entries(rc).map(([k, v]) => `<tr><td>check ${k}: ${why[k]}</td><td class="num">${v}</td></tr>`).join('')}<tr><td><b>all refusals</b></td><td class="num"><b>${total}</b></td></tr></table></div></div></div>`; }

// ── the trace ──
if (E.grounded) { const g = E.grounded, ch = R.chosen.v2;
  $('trace').innerHTML = `<p class="q">${esc(g.question)}</p><ol class="steps">
  <li><b>Route (L5).</b> The conductor reads it as ${g.route === 'compositional' ? 'a two-fact question (' + esc(g.routeWhy) + ')' : 'a one-fact question, so no graph walk is needed'}. (On a large corpus it would first narrow the field with plain cosine; in the measured runs every passage is scored, and what the shortlist would cost is measured separately in the conductor table below.)</li>
  <li><b>Late interaction (L1).</b> Every word-piece of the question finds its best match in every passage. ${pid(g.source.id)} scores highest.</li>
  <li><b>The bar (L4, check 2).</b> Its score must reach ${ch.t}, the bar chosen on the tune split. It does.</li>
  <li><b>The evidence (L4, check 3).</b> The weakest content word's best match must reach ${ch.e}. ${evid(g.evidence)}</li>
  <li><b>The reader (L4, check 4).</b> The local model is shown only this passage and asked to copy the answering phrase or say NONE. It copied “${esc(g.span.text)}”.</li>
  <li><b>The word-for-word check (L4, check 5).</b> The phrase is found in the passage at characters ${g.span.start} to ${g.span.end}. Answer given, with its sentence: “${esc(g.sentence.text)}”</li></ol>`; }

// ── all the numbers ──
const sysNames = ['B0', 'B1', 'L1', 'L1e', 'B1+R', 'L1+R', 'v2'];
const label = { B0: 'cosine, always answers', B1: 'BASELINE: cosine + tuned cut-off', L1: 'late interaction + tuned cut-off', L1e: '+ evidence check', 'B1+R': 'baseline + reader gate', 'L1+R': 'late interaction + reader gate', v2: 'DocDec v2 (all checks)' };
$('sysTbl').innerHTML = '<tr><th>System</th><th>Corpus</th><th class="num">Decisions right</th><th class="num">Answerable answered right</th><th class="num">Precision</th><th class="num">Unanswerable refused</th><th class="num">Exact match</th></tr>' +
  sysNames.flatMap((s) => [['guild corpus', R.s1[s]], ['9x corpus', R.s2[s]]].map(([c, m]) => `<tr><td>${s === 'v2' || s === 'B1' ? '<b>' + esc(label[s]) + '</b>' : esc(label[s])}</td><td>${c}</td><td class="num">${pct(m.accuracy)}</td><td class="num">${pct(m.recall)}</td><td class="num">${pct(m.precision)}</td><td class="num">${pct(m.refusal)}</td><td class="num">${m.spans && m.spans.em != null ? pct(m.spans.em) : '—'}</td></tr>`)).join('');
$('offTbl').innerHTML = '<tr><th>System</th><th class="num">Refused</th></tr>' + Object.entries(R.offTopic).map(([s, o]) => `<tr><td>${esc(label[s])}</td><td class="num">${o.refused} of ${o.of} (${pct(o.refusal)})</td></tr>`).join('');
const h = R.s3;
$('hotTbl').innerHTML = `<tr><th>Method</th><th class="num">Both right sources</th><th class="num">Right sources found (of 2)</th><th class="num">Answer exact match</th></tr>
  <tr><td><b>cosine top-2 (baseline)</b></td><td class="num">${pct(h.pairExact.cosineTop2)}</td><td class="num">${pct(h.recallAt2.cosineTop2)}</td><td class="num">${pct(h.answers.cosineTop2.em)}</td></tr>
  <tr><td>late interaction top-2</td><td class="num">${pct(h.pairExact.colbertTop2)}</td><td class="num">${pct(h.recallAt2.colbertTop2)}</td><td class="num">—</td></tr>
  <tr><td><b>DocDec graph walk</b></td><td class="num">${pct(h.pairExact.graph)}</td><td class="num">${pct(h.recallAt2.graph)}</td><td class="num">${pct(h.answers.graph.em)}</td></tr>
  <tr><td colspan="4" class="small muted">${h.eval} held-out questions over ${h.paragraphs.toLocaleString('en-GB')} pooled paragraphs (${h.edges.toLocaleString('en-GB')} mention links); the walk's link bonus was chosen on ${h.tune} tune questions from ${h.lambdasTried} values. Bridge questions: walk ${pct(h.bridge.graph)} vs cosine ${pct(h.bridge.cosine)}; comparison questions: walk ${pct(h.comparison.graph)} vs cosine ${pct(h.comparison.cosine)}.</td></tr>`;
const f4 = R.s4;
$('freshTbl').innerHTML = `<tr><th>Of ${f4.n} changed facts</th><th class="num">Count</th></tr><tr><td>Changes recognised as a new version of their own paragraph, with no source ids given</td><td class="num">${f4.detection.linkedToItsOwnOldVersion}</td></tr><tr><td>Changes linked to a wrong paragraph</td><td class="num">${f4.detection.linkedWrong}</td></tr>
  <tr><td>DocDec read the current version</td><td class="num">${f4.retrieval.latestMemory}</td></tr><tr><td>Flat index read the current version / the old one</td><td class="num">${f4.retrieval.latestFlat} / ${f4.retrieval.staleFlat}</td></tr><tr><td>As of 2021, DocDec read the then-current version</td><td class="num">${f4.retrieval.historyAsOf2021}</td></tr>
  <tr><td>Answers giving the new value: DocDec / flat</td><td class="num">${f4.answers.memoryNewValue} / ${f4.answers.flatNewValue}</td></tr><tr><td>Answers giving the old value: DocDec / flat</td><td class="num">${f4.answers.memoryOldValue} / ${f4.answers.flatOldValue}</td></tr>`;
$('memTbl').innerHTML = R.s5 ? `<tr><th>Measure</th><th class="num">Value</th></tr><tr><td>Facts remembered from use</td><td class="num">${R.s5.remembered}</td></tr><tr><td>Match bar (chosen on tune)</td><td class="num">${R.s5.threshold ?? 'none qualified: memory off'}</td></tr><tr><td>Held-out paraphrases served from memory</td><td class="num">${R.s5.served} of ${R.s5.eval}</td></tr><tr><td>Right with memory / without</td><td class="num">${R.s5.warmRight} / ${R.s5.coldRight}</td></tr><tr><td>False serves / stale serves</td><td class="num">${R.s5.falseServes} / ${R.s5.staleServed}</td></tr>` +
  (R.s5b ? `<tr><td colspan="2"><b>Second design (C7b): the work kept, re-checked for each new question</b></td></tr><tr><td>Answered questions whose work is kept</td><td class="num">${R.s5b.kept}</td></tr><tr><td>Match bar (chosen on tune)</td><td class="num">${R.s5b.matchBar ?? 'none qualified: memory off'}</td></tr>
  <tr><td>Held-out paraphrases that cleared the match / passed the re-check and were served</td><td class="num">${R.s5b.tried} / ${R.s5b.served} of ${R.s5b.eval}</td></tr><tr><td>Right with memory / without</td><td class="num">${R.s5b.warmRight} / ${R.s5b.coldRight}</td></tr>
  <tr><td>False serves / stale serves after the changes</td><td class="num">${R.s5b.falseServes} / ${R.s5b.afterChanges.staleServed}</td></tr><tr><td>Reader calls saved</td><td class="num">${R.s5b.readerCallsSaved}</td></tr>` : '') : '';
$('condTbl').innerHTML = `<tr><th>Measure</th><th class="num">Value</th></tr><tr><td>One-fact questions read as one fact (guild corpus)</td><td class="num">${pct(R.l5.routing.lookupReadAsLookup)} of ${R.l5.routing.lookupN}</td></tr><tr><td>Two-fact questions read as two facts (HotpotQA)</td><td class="num">${pct(R.l5.routing.compositionalReadAsCompositional)} of ${R.l5.routing.compositionalN}</td></tr>
  <tr><td>Right passage first: full late interaction over all ${esc(R.l5.fastPath.corpus)}</td><td class="num">${pct(R.l5.fastPath.fullColbertTop1)}</td></tr><tr><td>Right passage first: cosine shortlist of 20, then late interaction</td><td class="num">${pct(R.l5.fastPath.shortlist20ThenColbert)}</td></tr>`;
// what else shared the local model during the timing run (recorded by bench/latency.mjs), said plainly
function speedConditions(k) {
  if (!k) return '';
  if (k.quiet) return ' Nothing else was using the local model during the run.';
  const bits = [];
  if (k.otherModelsLoaded.length) bits.push(`other jobs had ${k.otherModelsLoaded.map(esc).join(', ')} loaded on the same model server`);
  if (k.readerReloads) bits.push(`the reader had to be reloaded ${k.readerReloads} time${k.readerReloads === 1 ? '' : 's'}`);
  return ` Not a quiet machine: ${bits.join(', and ')}. These times are slower than the same laptop with nothing else running, and the cost below uses them as measured.`;
}
$('speedTbl').innerHTML = MEAS ? `<tr><th>Step (median of ${MEAS.n} questions)</th><th class="num">ms</th></tr>` + Object.entries({ colbertEncodeQuestion: 'encode the question (ColBERT)', cosineOver1204: 'cosine over 1,204 passages', maxsimOver130: 'late interaction over 130 passages', maxsimOver1204: 'late interaction over 1,204 passages', graphWalk: 'graph walk (multi-hop)', reader: 'the reader (7B, CPU)' }).map(([k, l]) => `<tr><td>${l}</td><td class="num">${MEAS.medianMs[k]}</td></tr>`).join('') +
  `<tr><td colspan="2" class="small muted">${esc(MEAS.machine.cpu)}, ${MEAS.machine.cores} threads, ${MEAS.machine.memoryGb} GB, ${esc(MEAS.machine.gpu)}. The reader read ${MEAS.readerTokens.promptMean} tokens and wrote ${MEAS.readerTokens.outputMean} on average.${speedConditions(MEAS.conditions)}</td></tr>` : '<tr><td>Not measured yet.</td></tr>';

// ── the frontier ──
$('h1Out').innerHTML = R.h1 ? `<p>Index: ${R.h1.nodes.article} article nodes, ${R.h1.nodes.paragraph} paragraphs, ${R.h1.nodes.sentence} sentences. On ${R.h1.n} held-out answerable questions, the first result held the answer: cosine ${pct(R.h1.rank1AnswerBearing.cosine)}, hyperbolic ${pct(R.h1.rank1AnswerBearing.hyperbolic)}, fused ${pct(R.h1.rank1AnswerBearing.fused)} (${p(R.h1.test)}).
  A general article node came first: cosine ${pct(R.h1.hubness.cosine)}, hyperbolic ${pct(R.h1.hubness.hyperbolic)}, fused ${pct(R.h1.hubness.fused)}.</p><p><b>${R.h1.reproduced ? 'Reproduced in this training-free version: fusion beat cosine alone under the pre-registered rule.' : 'Not reproduced in this training-free version: fusion did not beat cosine alone under the pre-registered rule.'}</b> Either way it is not a product claim; a trained version is the next experiment, and would be measured the same way.</p>` : 'Not measured.';

// ── blueprint ──
const BP = [['L1 late interaction', 'src/late.mjs', 'MaxSim: every question word-piece takes its best match; the weakest content match is the evidence'],
  ['L2 graph', 'src/graph.mjs', 'titles as entities, mentions as links; the two-hop walk; the corpus’s themes'],
  ['L3 dated memory', 'src/memory.mjs', 'versions with validity windows, supersede-not-overwrite, verified answers re-checked before reuse, metabolism; the work behind an answer kept and re-checked for each new question (C7b)'],
  ['L4 verifier gate', 'src/gate.mjs', 'the five checks, word-for-word span finding, SQuAD scoring, two-source answers'],
  ['L5 conductor', 'src/conduct.mjs', 'reads one fact or two; the cosine shortlist'],
  ['Measurement', 'src/measure.mjs', 'every number and verdict on this page, by the pre-registered rules'],
  ['Assembly', 'src/assemble.mjs', 'shipped data to measurement input; re-scores from vectors'],
  ['Significance', 'src/stats.mjs', 'exact two-sided McNemar'],
  ['Cost case', 'src/cost.mjs', 'this against that, from the price lock and the measurements'],
  ['Frontier', 'src/hyper.mjs', 'Poincaré ball, radius by depth, fusion (prototype only)'],
  ['Examples', 'src/examples.mjs', 'the fixed rules that pick every example on this page'],
  ['Genome', 'genome/cell.mjs', 'the birth-check hooks: the judge is the C6 audit; the lane is word overlap with the index'],
  ['Genome lane', 'genome/lane-share.mjs', 'the lane share, chosen on tune questions and measured on held-out ones']];
fetch('data/genome-lane.json').then((r) => r.json()).then((L) => { const pc = (x) => `${(x * 100).toFixed(1)}%`; $('laneIn').textContent = pc(L.eval.inLaneAccepted); $('laneOut').textContent = pc(L.eval.offTopicRefused); }).catch(() => {});
$('bpTbl').querySelector('tbody').innerHTML = BP.map(([n2, f, w]) => { const g = GATES && GATES.files ? GATES.files[f] : null; return `<tr><td><b>${esc(n2)}</b></td><td><a href="${f}"><code>${f}</code></a></td><td>${esc(w)}</td><td class="num">${g ? `${g.killed}/${g.total}${g.clean ? ' clean' : ''}` : '—'}</td></tr>`; }).join('');

// ── the cost case ──
function cost() {
  const measured = { inTokens: MEAS ? MEAS.readerTokens.promptMean : 0, outTokens: MEAS ? MEAS.readerTokens.outputMean : 0, localSeconds: MEAS ? MEAS.localSecondsPerQuestion : 0,
    passageWords: R.s1.v2.spans.passageWords, sentenceWords: R.s1.v2.spans.sentenceWords };
  const c = K.costCase(LOCK, measured, { questionsPerMonth: Number($('vol').value), watts: $('wattsLow').checked ? 'low' : 'high', check: $('checkOn').checked });
  // per-question amounts are fractions of a penny: shown in pence to two significant figures, never rounded to £0.0000
  const perQ = (x) => (typeof x !== 'number' ? 'n/a' : x >= 0.01 ? gbp(x) : x === 0 ? '0p' : `${Number((x * 100).toPrecision(2))}p`);
  const q = c.questionsPerMonth;
  $('costTbl').innerHTML = `<tr><th>Setup</th><th class="num">Model or electricity, per question</th>${c.check ? '<th class="num">With checking, per question</th>' : ''}<th class="num">A month</th><th class="num">A year</th><th class="num">Next year (+CPI)</th></tr>` +
    c.cloud.apis.map((a) => `<tr><td>Cloud: ${esc(a.provider)} ${esc(a.model)}${c.check ? ' + checking time' : ''}</td><td class="num">${perQ(a.perQuestionGbp)}</td>${c.check ? `<td class="num">${perQ(a.monthGbp / q)}</td>` : ''}<td class="num">${gbp(a.monthGbp)}</td><td class="num">${gbp(a.yearGbp)}</td><td class="num">${gbp(a.nextYearGbp)}</td></tr>`).join('') +
    `<tr><td><b>DocDec on your machine</b>${c.check ? ' + checking time' : ''}</td><td class="num">${perQ(c.local.perQuestionGbp)}</td>${c.check ? `<td class="num">${perQ(c.local.monthGbp / q)}</td>` : ''}<td class="num"><b>${gbp(c.local.monthGbp)}</b></td><td class="num"><b>${gbp(c.local.yearGbp)}</b></td><td class="num">—</td></tr>`;
  $('costNote').innerHTML = `Quantities measured here: the reader reads ${measured.inTokens} tokens and writes ${measured.outTokens} a question, about ${measured.localSeconds} s of a laptop CPU at ${c.watts} W${MEAS && MEAS.conditions && !MEAS.conditions.quiet ? ' (timed while other jobs shared the laptop, so the electricity here is on the high side)' : ''}.
    ${c.check ? `Checking an answer means reading what it cites: the whole passage (${measured.passageWords.toFixed(0)} words on average, ${c.checkMinutes.cloud.toFixed(2)} min) for a chunk-citing cloud setup, the one cited sentence (${measured.sentenceWords.toFixed(0)} words, ${c.checkMinutes.docdec.toFixed(2)} min) for DocDec${(() => { const rd = K.entry(LOCK, 'brysbaert-2019-reading-rate'), wg = K.entry(LOCK, 'uk-national-living-wage'); return rd && wg ? `, at ${rd.wpm} words a minute (the adult average for non-fiction, Brysbaert 2019) and £${wg.value.toFixed(2)} an hour (the UK National Living Wage, the legal minimum; most staff cost more, which raises both bills and widens the gap)` : ', at the reading rate and wage in the lock'; })()}. Most of either bill is that reading time.` : ''}
    Not counted, all on the cloud side: ${c.notCounted.map(esc).join('; ')}.`;
  return c;
}
['vol', 'wattsLow', 'checkOn'].forEach((id) => $(id).addEventListener('input', cost));
const c0 = cost();

// ── the board ──
const cheapest = c0.cloud.apis.reduce((a, b) => (a && a.yearGbp < b.yearGbp ? a : b), null);
$('board').innerHTML = `<ul><li><b>Trust.</b> ${passN} of ${n} pre-registered claims pass against the baseline that caught version one; the ones that fail are shown as failed.</li>
  <li><b>Control.</b> No document leaves the building; every answer is an audit record with the exact words and where they are.</li>
  <li><b>Cost.</b> At ${c0.questionsPerMonth.toLocaleString('en-GB')} questions a month: ${gbp(c0.local.yearGbp)} a year on your own machines${c0.check ? ', checking time included' : ''}, against ${gbp(cheapest ? cheapest.yearGbp : null)} a year for the cheapest cloud model in the lock, before the cloud's search and storage fees, which are not counted.</li>
  <li><b>Proof you can repeat.</b> Every number re-derives in a browser from the shipped data, and from scratch on any machine with the published commands.</li></ul>`;

// ── paper results + limits ──
$('paperResults').textContent = Object.entries(C).map(([k, c]) => `${k} ${c.pass ? 'passed' : 'failed'}`).join(', ') + (MEAS ? `, C8 ${c8pass ? 'passed' : 'failed'}` : '') + '.';
const fails = Object.entries(C).filter(([, c]) => !c.pass).map(([k, c]) => `${k} (${c.claim.toLowerCase()})`);
$('limitsDyn').textContent = fails.length ? `Failed claims, not made: ${fails.join('; ')}.` : 'Every pre-registered claim passed on these sets; that is a statement about these sets, not a guarantee on yours.';

// ── re-run ──
function rerun(full) {
  const out = $('rerunOut'); out.hidden = false; out.innerHTML = 'Starting a background thread…';
  $('rerunQuick').disabled = $('rerunFull').disabled = true;
  const w = new Worker('rerun2-worker.mjs', { type: 'module' });
  w.onmessage = (ev) => { const m = ev.data;
    if (m.progress) { out.textContent = m.progress; return; }
    $('rerunQuick').disabled = $('rerunFull').disabled = false; w.terminate();
    if (m.error) { out.innerHTML = `<span class="verdict no">The re-run stopped:</span> ${esc(m.error)}`; return; }
    out.innerHTML = `<p><span class="verdict ${m.same ? 'ok' : 'no'}">${m.same ? 'Identical.' : 'Different.'}</span> Re-derived in ${m.seconds} s: ${m.fields} published fields compared, ${m.diffs.length} differ${m.full ? '; the score tables were first rebuilt from the shipped vectors and matched the shipped tables ' + (m.scoresSame ? 'exactly' : 'NOT exactly') : ''}.</p>${m.diffs.length ? `<pre>${esc(m.diffs.slice(0, 20).join('\n'))}</pre>` : ''}`; };
  w.onerror = (e) => { out.textContent = 'The re-run could not start: ' + e.message; $('rerunQuick').disabled = $('rerunFull').disabled = false; };
  w.postMessage({ full });
}
get('data/v2/sizes.json').then((s) => { $('rerunSize').textContent = `Either one downloads about ${Math.round(s.rerun.total / 1e6)} MB of shipped data first; on a phone, use Wi-Fi.`; }).catch(() => { /* size unknown: say nothing */ });
$('rerunQuick').onclick = () => rerun(false);
$('rerunFull').onclick = () => rerun(true);
