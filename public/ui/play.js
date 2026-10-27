import {$, $$, esc, clamp, restart, COLORS, TEAM, av, colorsOf, ruleOk, WORD_RE, CHECK, toast} from './util.js';
import {api, serverNow} from './net.js';
import {SFX} from './sfx.js';
import {burst} from './fx.js';

const STEP = 1150;          // time between reveals
const LATE_MS = 8000;       // joined this long after a reveal started: skip straight to the result
let wired = false, room = null, key = '', seatIds = '', lastAfter = '';
let timers = [], tick = null, warned = false, resultShown = false, counting = false, busy = false;

const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.push(t); return t; };
function clearAll(){ timers.forEach(clearTimeout); timers = []; clearInterval(tick); tick = null; }
const meOf = r => r.players.find(p => p.id === r.me);
const isHost = r => r.me === r.hostId;
const hostOf = r => r.players.find(p => p.id === r.hostId);
const isBattle = r => r.mode === 'battle';
const seatEl = id => $(`.seat[data-id="${id}"]`);
const norm = w => w ? w.toLocaleLowerCase('en') : '';
// You always sit at the bottom: put yourself first, then everyone else in room order.
const ordered = r => { const me = meOf(r); return me ? [me, ...r.players.filter(p => p.id !== r.me)] : r.players; };

/* reveal order: the most common word first, the same order on every device */
function hash(s){ let x = 2166136261; for(const c of s) x = Math.imul(x ^ c.charCodeAt(0), 16777619); return x >>> 0; }
export function revealPlan(record){
  const count = new Map();
  for(const g of record.guesses){ const w = norm(g.word); if(w) count.set(w, (count.get(w) || 0) + 1); }
  const best = [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || '';
  const mix = list => [...list].sort((a, b) => hash(a.id + record.at) - hash(b.id + record.at));
  const major = best ? record.guesses.filter(g => norm(g.word) === best) : [];
  const others = record.guesses.filter(g => g.word && norm(g.word) !== best);
  const blank = record.guesses.filter(g => !g.word);
  return {best, majorCount:major.length, total:record.guesses.length, streak:major.length >= 2, order:[...mix(major), ...mix(others), ...blank]};
}

/* layout: everyone around an oval table */
function geo(){
  const a = $('#arena'), W = a.clientWidth, H = a.clientHeight, s = W < 560 ? 56 : 68;
  const rx = Math.max(104, Math.min(W / 2 - s / 2 - 18, 300)), ry = Math.max(104, Math.min((H - s - 50) / 2, rx * 1.45, 300));
  return {W, H, cx:W / 2, cy:H / 2 - 10, rx, ry, R:Math.min(rx, ry), s};
}
function layout(){
  if(!room || document.body.dataset.screen !== 'play') return;
  const g = geo(), list = ordered(room), n = list.length, root = document.documentElement.style;
  root.setProperty('--seat', g.s + 'px'); root.setProperty('--R', g.R); root.setProperty('--spot', Math.round(clamp(g.R * .46, 58, 104)) + 'px');
  list.forEach((p, i) => {
    const a = (90 + i * 360 / n) * Math.PI / 180, el = seatEl(p.id);
    if(el){ el.style.left = g.cx + g.rx * Math.cos(a) + 'px'; el.style.top = g.cy + g.ry * Math.sin(a) + 'px'; }
  });
  Object.assign($('#table').style, {left:g.cx + 'px', top:g.cy + 'px', width:Math.round(g.rx * 1.36) + 'px', height:Math.round(g.ry * 1.36) + 'px'});
  const c = $('#center'); c.style.left = g.cx + 'px'; c.style.top = g.cy + 'px'; c.style.width = Math.round(g.rx * 2 - g.s * 1.1) + 'px';
}
function callout(text, cls = ''){
  const g = geo(), el = document.createElement('div');
  el.className = 'callout ' + cls; el.textContent = text; el.style.top = Math.max(4, g.cy - g.ry * .62) + 'px';
  $('#arena').appendChild(el); setTimeout(() => el.remove(), 2300);
}

/* seats */
function buildSeats(r){
  const list = ordered(r), ids = list.map(p => p.id).join(',');
  if(ids === seatIds) return;
  seatIds = ids;
  $('#seats').innerHTML = list.map(p => `<div class="seat" data-id="${p.id}"><div class="av"></div><span class="badge"></span><span class="lab"></span></div>`).join('');
}
function patchSeats(r){
  const host = isHost(r);
  for(const p of r.players){
    const el = seatEl(p.id); if(!el) continue;
    const a = el.querySelector('.av');
    a.className = 'av' + (p.id === r.me ? ' me' : '') + (isBattle(r) ? ` team-${p.team}` : '');
    a.style.setProperty('--c', COLORS[p.color] || COLORS.sky);
    if(a.textContent !== p.avatar) a.textContent = p.avatar;
    const removable = host && !p.connected && p.id !== r.me;
    el.classList.toggle('away', !p.connected);
    el.classList.toggle('removable', removable);
    el.title = removable ? `Remove ${p.name}` : '';
    const lab = el.querySelector('.lab');
    if(!lab.classList.contains('pill') && lab.textContent !== p.name) lab.textContent = p.name;
  }
}
function paintBadges(r){
  for(const p of r.players){
    const b = seatEl(p.id)?.querySelector('.badge'); if(!b) continue;
    const state = p.submitted ? 'done' : 'think';
    if(b.dataset.state === state) continue;
    b.dataset.state = state; b.style.display = '';
    if(state === 'done'){ b.className = 'badge done pop'; b.innerHTML = CHECK; }
    else { b.className = 'badge'; b.innerHTML = '<i></i><i></i><i></i>'; }
  }
}

/* header */
function shownScore(r){ return r.scores.group - (r.phase === 'reveal' && !resultShown ? r.latestOutcome?.points || 0 : 0); }
function shownTeams(r){ const s = {...r.battleScores}; if(r.phase === 'reveal' && !resultShown && r.latestOutcome?.winner) s[r.latestOutcome.winner]--; return s; }
function paintHud(r){
  $('#roundTxt').textContent = r.settings.rounds ? `Round ${r.round} of ${r.settings.rounds}` : `Round ${r.round}`;
  $('#tryTxt').textContent = `Try ${r.attempt}`;
  if(isBattle(r)){ const s = shownTeams(r); $('#scoreBox').innerHTML = `<span class="tr">Red ${s.red}</span><span class="tb">Blue ${s.blue}</span>`; }
  else if(!counting) $('#scoreBox').innerHTML = `<span id="score">${shownScore(r)}</span><small>pts</small>`;
  const rule = $('#rule');
  $('#play').classList.toggle('chaos', !!r.modifier);
  if(r.modifier){
    const html = `<b>${esc(r.modifier.label)}</b><span>${esc(r.modifier.detail)}</span>`;
    if(rule.hidden || rule.innerHTML !== html){ rule.innerHTML = html; rule.hidden = false; restart(rule, 'pop'); }
  } else rule.hidden = true;
}
function countUp(from, to){
  counting = true; const t0 = performance.now();
  (function step(t){
    const k = Math.min(1, (t - t0) / 700), el = $('#score');
    if(el) el.textContent = Math.round(from + (to - from) * k);
    if(k < 1) requestAnimationFrame(step); else counting = false;
  })(t0);
}

/* writing */
const warnAt = r => r.settings.timer > 30 ? 30 : 10;
function tickTimer(){
  const r = room; if(!r || r.phase !== 'writing' || !r.endsAt) return;
  const ms = Math.max(0, r.endsAt - serverNow()), left = Math.ceil(ms / 1000);
  $('#timer').textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  $('#tbar').style.width = (r.writeMs ? ms / r.writeMs * 100 : 0) + '%';
  if(!warned && ms > 0 && left <= warnAt(r)){
    warned = true; $('#timer').classList.add('hot'); $('#tbar').classList.add('hot');
    callout(`${warnAt(r)} seconds left!`); SFX.warn();
  }
  if(ms <= 0){ $('#timer').className = 'timer out'; clearInterval(tick); tick = null; }
}
function lockedLine(r){ return `${r.players.filter(p => p.submitted).length} of ${r.players.length} locked in`; }
function showForm(){
  $('#wordForm').hidden = false; $('#after').hidden = true; lastAfter = '';
  const input = $('#word'); input.value = '';
  if(matchMedia('(pointer:fine)').matches) setTimeout(() => input.focus(), 60);
}
function showLocked(r, word){
  $('#wordForm').hidden = true; $('#wordErr').textContent = '';
  const me = meOf(r), waiting = r.players.some(p => !p.submitted);
  const html = `<div class="lockbox">${me ? av(me, 'sm') : ''}<div><span>Locked in</span><br><b>${esc(norm(word || r.myWord))}</b></div></div>${isHost(r) && waiting ? '<button type="button" class="btn ghost small" id="revealNow">Reveal now</button>' : ''}`;
  setAfter(html);
}
function setAfter(html){ const af = $('#after'); af.hidden = false; if(html !== lastAfter){ af.innerHTML = html; lastAfter = html; } }
function startWriting(r){
  warned = false;
  for(const p of r.players){
    const el = seatEl(p.id); if(!el) continue;
    el.classList.remove('hop', 'shake');
    const lab = el.querySelector('.lab'); lab.className = 'lab'; lab.textContent = p.name;
    el.querySelector('.badge').dataset.state = '';
  }
  paintBadges(r);
  const last = r.attempt > 1 ? r.history.at(-1) : null, c = $('#center');
  if(!last) c.innerHTML = `<div class="prompt pop">Say any word</div><div class="locked" id="lockedN">${lockedLine(r)}</div>`;
  else {
    const plan = revealPlan(last), words = [...new Set(last.guesses.map(g => norm(g.word)).filter(Boolean))];
    c.innerHTML = `<div class="cap">Meet in the middle</div><div class="clues">${words.map((w, i) => `<span class="pill ${plan.streak && w === plan.best ? 'ok' : ''}" style="animation-delay:${i * 70}ms">${esc(w)}</span>`).join('')}</div><div class="locked" id="lockedN">${lockedLine(r)}</div>`;
  }
  $('#wordErr').textContent = '';
  if(r.selfSubmitted) showLocked(r); else showForm();
  const t = $('#timer'), bar = $('#tbar');
  if(r.endsAt){
    t.hidden = false; bar.hidden = false; t.className = 'timer'; bar.className = 'tbar';
    if((r.endsAt - serverNow()) / 1000 <= warnAt(r)){ warned = true; t.classList.add('hot'); bar.classList.add('hot'); }
    tickTimer(); tick = setInterval(tickTimer, 200);
  } else { t.hidden = true; bar.hidden = true; }
}
function patchWriting(r){
  paintBadges(r);
  const line = $('#lockedN'); if(line) line.textContent = lockedLine(r);
  if(r.selfSubmitted) showLocked(r);
}
function fail(message, shakeRule){
  $('#wordErr').textContent = message;
  restart($('#wordForm'), 'shake');
  if(shakeRule) restart($('#rule'), 'shake');
}
async function submit(e){
  e.preventDefault();
  const r = room; if(busy || !r || r.phase !== 'writing' || r.selfSubmitted) return;
  const word = $('#word').value.trim().normalize('NFC');
  if(!word || [...word].length > 20 || !WORD_RE.test(word)) return fail('Use one word with letters only.');
  if(!ruleOk(word, r.modifier)) return fail(`That breaks the rule: ${r.modifier.label}.`, true);
  busy = true;
  try { await api('submit', {word}); SFX.lock(); if(room?.phase === 'writing') showLocked(room, word); }
  catch(err){ fail(err.message); }
  finally { busy = false; }
}

/* reveal */
function revealOne(g, k, plan, quiet){
  const ok = plan.streak && norm(g.word) === plan.best;
  const seat = seatEl(g.id);
  if(seat){
    const lab = seat.querySelector('.lab');
    lab.textContent = g.word ? norm(g.word) : 'no word';
    lab.className = 'lab pill ' + (ok ? 'ok' : 'bad') + (quiet ? '' : ' pop');
    if(!quiet) restart(seat, ok ? 'hop' : 'shake');
  }
  if(quiet) return;
  const firstBreak = !ok && plan.order.slice(0, k).every(q => plan.streak && norm(q.word) === plan.best);
  $('#center').innerHTML = `<div class="spot ${ok ? 'ok pop' : 'bad shake'}">${av(g, g.id === room.me ? 'me' : '')}<div class="sn">${esc(g.name)}</div><div class="sw">${g.word ? esc(norm(g.word)) : '...'}</div><div class="ss">${ok ? `${k + 1} in a row` : g.word ? 'Streak broken' : 'Ran out of time'}</div></div>`;
  if(ok) SFX.tick(k); else if(firstBreak) SFX.buzz(); else SFX.soft();
}
function startReveal(r){
  $('#timer').hidden = true; $('#tbar').hidden = true;
  $('#wordForm').hidden = true; $('#wordErr').textContent = '';
  $$('.badge').forEach(b => { b.style.display = 'none'; b.dataset.state = ''; });
  const record = r.history.at(-1);
  const mine = record?.guesses.find(g => g.id === r.me);
  if(mine && !mine.word) setAfter('<p class="note">You ran out of time this try</p>');
  else { $('#after').hidden = true; lastAfter = ''; }
  $('#center').innerHTML = '';
  if(!record) return showResult(r, null, true);
  if(isBattle(r)) for(const p of r.players){
    if(record.guesses.some(g => g.id === p.id)) continue;
    const lab = seatEl(p.id)?.querySelector('.lab');
    if(lab){ lab.className = 'lab pill unknown'; lab.textContent = '?'; }
  }
  const plan = revealPlan(record);
  if(serverNow() - record.at > LATE_MS){
    plan.order.forEach((g, k) => revealOne(g, k, plan, true));
    return showResult(r, plan, true);
  }
  let start = 450;
  if(r.latestOutcome?.reason === 'time'){ callout("Time's up!", 'bad'); SFX.buzz(); start = 1300; }
  plan.order.forEach((g, k) => later(() => revealOne(g, k, plan, false), start + k * STEP));
  later(() => showResult(room, plan, false), start + plan.order.length * STEP + 250);
}
function near(plan){
  const n = plan ? plan.majorCount : 0, total = plan ? plan.total : 0;
  return `<div class="near pop"><b>${n} of ${total}</b><span>${n >= 2 ? 'Almost there' : 'All different'}</span></div>`;
}
function celebrate(r, players, colors, quiet){
  if(quiet) return;
  players.forEach((p, i) => later(() => restart(seatEl(p.id), 'hop'), i * 70));
  const box = $('#arena').getBoundingClientRect(), g = geo();
  burst(box.left + g.cx, box.top + g.cy, colors, 60);
  SFX.win();
}
function showResult(r, plan, quiet){
  resultShown = true;
  const o = r.latestOutcome || {}, c = $('#center');
  if(isBattle(r)){
    const team = meOf(r)?.team;
    if(o.winner && o.winner === team){
      c.innerHTML = `<div class="bang shout">SAME SAME!</div><div class="won pop">${esc(norm(o.winningWord))}</div><div class="sub">Your team takes the round</div>`;
      celebrate(r, r.players.filter(p => p.team === team), [TEAM[team].hex, '#FFD23F', '#FFFFFF'], quiet);
    } else {
      c.innerHTML = near(plan);
      if(o.winner && !quiet){ callout(`${TEAM[o.winner].name} synced first`, 'bad'); SFX.buzz(); }
    }
  } else if(o.matched){
    c.innerHTML = `<div class="bang shout">SAME SAME!</div><div class="won pop">${esc(norm(o.winningWord))}</div><div class="pts">+${o.points}</div>`;
    celebrate(r, r.players, colorsOf(r.players), quiet);
    if(!quiet) countUp(r.scores.group - o.points, r.scores.group);
  } else c.innerHTML = near(plan);
  paintHud(r);
  paintNext(r);
}
function endsGame(r){
  if(isBattle(r)) return Math.max(r.battleScores.red, r.battleScores.blue) >= 3;
  return r.settings.rounds > 0 && r.round >= r.settings.rounds;
}
function paintNext(r){
  const o = r.latestOutcome || {}, host = hostOf(r), finalRound = o.matched && endsGame(r);
  const label = o.matched ? (finalRound ? 'See results' : 'Next round') : 'Try again';
  const main = `<button type="button" class="btn ${o.matched ? 'go' : ''}" id="nextBtn">${label}</button>`;
  if(isHost(r)) setAfter(main + (finalRound ? '' : '<button type="button" class="btn ghost" id="endBtn">End game</button>'));
  else if(!host || !host.connected) setAfter(main);
  else setAfter(`<p class="note">${esc(host.name)} is starting the next ${o.matched ? 'round' : 'try'}</p>`);
}

/* wiring */
function wire(){
  wired = true;
  $('#wordForm').addEventListener('submit', submit);
  $('#word').addEventListener('input', () => { $('#wordErr').textContent = ''; });
  $('#after').addEventListener('click', async e => {
    const b = e.target.closest('button'); if(!b) return;
    const action = {nextBtn:'next', endBtn:'end', revealNow:'reveal'}[b.id]; if(!action) return;
    b.disabled = true;
    try { await api(action); } catch(err){ toast(err.message); b.disabled = false; }
  });
  $('#seats').addEventListener('click', async e => {
    const seat = e.target.closest('.seat.removable'); if(!seat || !room) return;
    const p = room.players.find(q => q.id === seat.dataset.id); if(!p) return;
    if(!confirm(`Remove ${p.name}? They're offline.`)) return;
    try { await api('remove', {targetId:p.id}); } catch(err){ toast(err.message); }
  });
  addEventListener('resize', layout);
  window.visualViewport?.addEventListener('resize', layout);
}
function handle(r){
  room = r;
  buildSeats(r); patchSeats(r);
  const k = `${r.round}|${r.attempt}|${r.phase}`;
  if(k !== key){
    clearAll(); key = k; resultShown = false;
    paintHud(r); layout();
    if(r.phase === 'writing') startWriting(r);
    else if(r.phase === 'reveal') startReveal(r);
  } else {
    if(r.phase === 'writing') patchWriting(r);
    else if(r.phase === 'reveal' && resultShown) paintNext(r);
    paintHud(r); layout();
  }
}
export function enter(r){
  if(!wired) wire();
  key = ''; seatIds = ''; lastAfter = ''; resultShown = false; counting = false;
  $$('.callout').forEach(el => el.remove());
  handle(r);
}
export function update(prev, next){ handle(next); }
export function exit(){ clearAll(); room = null; key = ''; }
