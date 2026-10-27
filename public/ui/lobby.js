import {$, $$, esc, clamp, restart, COLORS, ROUNDS, TIMERS, roundsLabel, timerLabel, MODE_HINTS, toast, ctl, load, save} from './util.js';
import {api} from './net.js';
import {SFX} from './sfx.js';

let wired = false, room = null;
let moved = load('same-same-moved', false);
let posTimer = null, lastPos = 0, pendingPos = null, holdMineUntil = 0;
let lastSets = '', lastFoot = '';

const meOf = r => r.players.find(p => p.id === r.me);
const isHost = r => r.me === r.hostId;
const hostOf = r => r.players.find(p => p.id === r.hostId);

// Positions are 0-100 on the server. In Battle each team gets its own half of the board.
function shown(p, r){
  let [x, y] = p.pos || [50, 50];
  if(r.mode === 'battle') x = p.team === 'red' ? 4 + x * .42 : 54 + x * .42;
  return [clamp(x, 6, 94), clamp(y, r.mode === 'battle' ? 22 : 12, 88)];
}

function makeBubble(p, i){
  const el = document.createElement('div');
  el.className = 'hb'; el.dataset.id = p.id;
  el.innerHTML = `<div class="float" style="--d:${3 + (i % 5) * .6}s;--hx:${i % 2 ? 12 : -12}px;--hy:${i % 3 ? -12 : 10}px"><div class="pop"><div class="av"></div></div><span class="nm"></span></div>`;
  return el;
}
function patchBubble(el, p, r){
  const mine = p.id === r.me;
  el.classList.toggle('mine', mine);
  el.classList.toggle('away', !p.connected);
  const a = el.querySelector('.av');
  a.className = 'av' + (mine ? ' me' : '') + (r.mode === 'battle' ? ` team-${p.team}` : '');
  a.style.setProperty('--c', COLORS[p.color] || COLORS.sky);
  if(a.textContent !== p.avatar) a.textContent = p.avatar;
  const nm = `${esc(p.name)}${p.isHost ? '<span class="tag">host</span>' : ''}${p.connected ? '' : '<span class="tag off">away</span>'}`;
  const label = el.querySelector('.nm');
  if(label.innerHTML !== nm) label.innerHTML = nm;
  const hint = el.querySelector('.hint');
  if(mine && !moved && !hint) el.querySelector('.float').insertAdjacentHTML('beforeend', '<span class="hint">tap to move</span>');
  if((!mine || moved) && hint) hint.remove();
  if(!(mine && Date.now() < holdMineUntil)){ const [x, y] = shown(p, r); el.style.left = x + '%'; el.style.top = y + '%'; }
}
function syncBubbles(r, first){
  const hang = $('#hang'), ids = new Set(r.players.map(p => p.id));
  $$('.hb', hang).forEach(el => { if(!ids.has(el.dataset.id)) el.remove(); });
  r.players.forEach((p, i) => {
    let el = hang.querySelector(`.hb[data-id="${p.id}"]`);
    if(!el){ el = makeBubble(p, i); hang.appendChild(el); if(!first) SFX.join(); }
    patchBubble(el, p, r);
  });
}

function paintFooter(r){
  const host = isHost(r);
  $('#codeTxt').textContent = r.code;
  $('#count').textContent = `${r.players.length} here`;
  $('#sides').hidden = r.mode !== 'battle';
  $('#modeHint').textContent = MODE_HINTS[r.mode];
  const items = [['rounds', 'Rounds', roundsLabel(r.settings.rounds)], ['timer', 'Timer', timerLabel(r.settings.timer)]];
  const sets = items.map(([k, l, v]) => host
    ? `<button type="button" class="set" data-set="${k}"><span>${l}</span><b>${v}</b></button>`
    : `<div class="set"><span>${l}</span><b>${v}</b></div>`).join('');
  if(sets !== lastSets){ $('#sets').innerHTML = sets; lastSets = sets; }
  const foot = host
    ? `<div class="modes" role="group" aria-label="Mode">${['classic', 'battle', 'chaos'].map(m => `<button type="button" data-m="${m}" aria-pressed="${m === r.mode}">${m[0].toUpperCase() + m.slice(1)}</button>`).join('')}</div><button type="button" class="btn go" id="go">GO</button>`
    : `<p class="waiting">Waiting for <b>${esc(hostOf(r)?.name || 'the host')}</b> to start</p>`;
  if(foot !== lastFoot){ $('#footRow').innerHTML = foot; lastFoot = foot; }
}

function queuePos(x, y){
  pendingPos = {x:Math.round(x), y:Math.round(y)};
  clearTimeout(posTimer);
  posTimer = setTimeout(() => { lastPos = Date.now(); const p = pendingPos; pendingPos = null; api('pos', p).catch(() => {}); }, Math.max(0, 150 - (Date.now() - lastPos)));
}
function onBoardTap(e){
  if(!room) return;
  const box = $('#hang').getBoundingClientRect(), mine = $('.hb.mine'), me = meOf(room);
  if(!mine || !me) return;
  const x = (e.clientX - box.left) / box.width * 100, y = (e.clientY - box.top) / box.height * 100;
  let serverX = x, team = null;
  if(room.mode === 'battle'){ team = x < 50 ? 'red' : 'blue'; serverX = clamp((x - (team === 'red' ? 4 : 54)) / .42, 0, 100); }
  mine.style.left = clamp(x, 6, 94) + '%';
  mine.style.top = clamp(y, room.mode === 'battle' ? 22 : 12, 88) + '%';
  holdMineUntil = Date.now() + 900;
  if(!moved){ moved = true; save('same-same-moved', true); mine.querySelector('.hint')?.remove(); }
  SFX.pop();
  if(team && me.team !== team) api('team', {team}).catch(err => toast(err.message));
  queuePos(serverX, y);
}

function wire(){
  wired = true;
  $('#hang').addEventListener('click', onBoardTap);
  $('#sets').addEventListener('click', e => {
    const b = e.target.closest('[data-set]'); if(!b || !room) return;
    const s = {...room.settings};
    if(b.dataset.set === 'rounds') s.rounds = ROUNDS[(ROUNDS.indexOf(s.rounds) + 1) % ROUNDS.length];
    else s.timer = TIMERS[(TIMERS.indexOf(s.timer) + 1) % TIMERS.length];
    SFX.pop(); restart(b, 'pop');
    api('settings', s).catch(err => toast(err.message));
  });
  $('#footRow').addEventListener('click', async e => {
    const m = e.target.closest('[data-m]');
    if(m){ SFX.pop(); api('mode', {mode:m.dataset.m}).catch(err => toast(err.message)); return; }
    const go = e.target.closest('#go');
    if(go){ go.disabled = true; try { await api('start'); } catch(err){ toast(err.message); restart(go, 'shake'); } finally { go.disabled = false; } }
  });
  $('#codeChip').addEventListener('click', async () => {
    const code = room?.code; if(!code) return;
    try { await navigator.clipboard.writeText(`${location.origin}/?room=${code}`); toast('Invite link copied'); }
    catch { toast(`Room code: ${code}`); }
  });
  $('#lobbyLeave').addEventListener('click', () => { if(confirm('Leave this room?')) ctl.leave(); });
}

export function enter(r){
  if(!wired) wire();
  room = r; lastSets = ''; lastFoot = '';
  $$('.hb', $('#hang')).forEach(el => el.remove());
  syncBubbles(r, true);
  paintFooter(r);
}
export function update(prev, next){ room = next; syncBubbles(next, false); paintFooter(next); }
export function exit(){ clearTimeout(posTimer); room = null; }
