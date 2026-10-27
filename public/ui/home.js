import {$, pick, restart, EMOJI, COLORS, av, colorsOf, ctl, load, save} from './util.js';
import {api} from './net.js';
import {SFX} from './sfx.js';
import {burst} from './fx.js';

const me = Object.assign({name:'', avatar:'😎', color:'sky'}, load('same-same-me', {}));
if(!EMOJI.includes(me.avatar)) me.avatar = '😎';
if(!COLORS[me.color]) me.color = 'sky';
let busy = false, wired = false;

/* the looping mini demo: three players throw words until they match */
const DEMO_P = [{avatar:'🦊', color:'orange'}, {avatar:'🐸', color:'grass'}, {avatar:'🐙', color:'pink'}];
const DEMO_X = [18, 50, 82];
const DEMO = [
  {w:['pizza','moon','cake'], cap:'Everyone says a word at once'},
  {w:['cheese','night','cheese'], cap:'No match? Find a new word that links them'},
  {w:['mouse','mouse','mouse'], cap:'Everyone says the same word. You score!', win:true}
];
let demoTimers = [];
const demoLater = (fn, ms) => demoTimers.push(setTimeout(fn, ms));
export function stopDemo(){ demoTimers.forEach(clearTimeout); demoTimers = []; }
function startDemo(){
  stopDemo();
  $('#demoStage').innerHTML = DEMO_P.map((p, i) => `<div class="dp" style="left:${DEMO_X[i]}%">${av(p)}</div>`).join('');
  let t = 250;
  for(const step of DEMO){ demoLater(() => demoStep(step), t); t += step.win ? 3800 : 2700; }
  demoLater(startDemo, t);
}
function demoStep(step){
  const stage = $('#demoStage'), cap = $('#demoCap');
  cap.textContent = step.cap; restart(cap, 'fade');
  const count = {}; step.w.forEach(w => count[w] = (count[w] || 0) + 1);
  const width = stage.clientWidth;
  step.w.forEach((w, i) => demoLater(() => {
    const seat = stage.children[i], el = document.createElement('span');
    el.className = 'fw pill' + (count[w] > 1 ? ' ok' : '') + (step.win ? ' win' : '');
    el.textContent = w;
    el.style.setProperty('--tx', (50 - DEMO_X[i]) / 100 * width + 'px');
    seat.appendChild(el); restart(seat.querySelector('.av'), 'hop');
    setTimeout(() => el.remove(), 2300);
  }, i * (step.win ? 120 : 280)));
  if(step.win) demoLater(() => {
    const b = document.createElement('div');
    b.className = 'dbang shout'; b.textContent = 'SAME SAME!';
    stage.appendChild(b); setTimeout(() => b.remove(), 2100);
    const r = stage.getBoundingClientRect();
    burst(r.left + r.width / 2, r.top + 40, colorsOf(DEMO_P), 24);
  }, 1350);
}

/* your look */
function paintLook(){
  $('#mePreview').innerHTML = av(me, 'me');
  $('#emojiGrid').innerHTML = EMOJI.map(e => `<button type="button" role="radio" aria-checked="${e === me.avatar}" aria-label="${e}" data-e="${e}">${e}</button>`).join('');
  $('#colorRow').innerHTML = Object.keys(COLORS).map(k => `<button type="button" role="radio" aria-checked="${k === me.color}" aria-label="${k}" data-c="${k}" style="--c:${COLORS[k]}"></button>`).join('');
}
function bump(){ paintLook(); restart($('#mePreview .av'), 'pop'); SFX.pop(); save('same-same-me', me); }
function readName(){ me.name = $('#name').value.trim().replace(/\s+/g, ' ').slice(0, 18); save('same-same-me', me); return me.name; }
function setErr(message, shakeEl){ $('#homeErr').textContent = message || ''; if(message && shakeEl) restart(shakeEl, 'shake'); }
function setBusy(v){ busy = v; for(const id of ['#create', '#join', '#joinOpen']) $(id).disabled = v; }
function openJoin(code = ''){ $('#row2').hidden = true; $('#joinRow').hidden = false; if(code) $('#codeIn').value = code; $('#codeIn').focus(); }
function closeJoin(){ $('#joinRow').hidden = true; $('#row2').hidden = false; setErr(''); }

async function create(){
  if(busy) return;
  if(!readName()){ setErr('Enter a name first.', $('#name')); $('#name').focus(); return; }
  setErr(''); setBusy(true);
  try { await ctl.join(await api('create', {name:me.name, avatar:me.avatar, color:me.color})); }
  catch(e){ setErr(e.message, $('#create')); }
  finally { setBusy(false); }
}
async function join(){
  if(busy) return;
  const code = $('#codeIn').value.trim().toUpperCase();
  if(!readName()){ setErr('Enter a name first.', $('#name')); $('#name').focus(); return; }
  if(code.length < 4){ setErr('Enter the room code your friend sent you.', $('#joinRow')); return; }
  setErr(''); setBusy(true);
  try { await ctl.join(await api('join', {code, name:me.name, avatar:me.avatar, color:me.color})); }
  catch(e){ setErr(e.message, $('#joinRow')); }
  finally { setBusy(false); }
}

function wire(){
  wired = true;
  $('#emojiGrid').addEventListener('click', e => { const b = e.target.closest('[data-e]'); if(b){ me.avatar = b.dataset.e; bump(); } });
  $('#colorRow').addEventListener('click', e => { const b = e.target.closest('[data-c]'); if(b){ me.color = b.dataset.c; bump(); } });
  $('#mePreview').addEventListener('click', () => {
    me.avatar = pick(EMOJI.filter(x => x !== me.avatar));
    me.color = pick(Object.keys(COLORS).filter(x => x !== me.color));
    bump();
  });
  $('#create').addEventListener('click', create);
  $('#joinOpen').addEventListener('click', () => openJoin());
  $('#joinX').addEventListener('click', closeJoin);
  $('#join').addEventListener('click', join);
  $('#name').addEventListener('keydown', e => { if(e.key === 'Enter') ($('#joinRow').hidden ? create : join)(); });
  $('#codeIn').addEventListener('keydown', e => { if(e.key === 'Enter') join(); });
  $('#codeIn').addEventListener('input', () => setErr(''));
}

export function enter(room, opts = {}){
  if(!wired) wire();
  paintLook();
  $('#name').value = me.name;
  if(opts.code) openJoin(opts.code); else closeJoin();
  setErr(opts.error || '');
  startDemo();
}
export function update(){}
export function exit(){ stopDemo(); }
