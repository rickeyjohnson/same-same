export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const pick = list => list[Math.random() * list.length | 0];
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const restart = (el, cls) => { if(!el) return; el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); };

export const EMOJI = ['😎','🦊','🐸','🦋','🐱','👽','🤖','🐼','🦄','🐙','🦖','🪩'];
export const COLORS = {sky:'#5BC8F5', grass:'#7ED957', sun:'#FFD23F', tomato:'#FF5A4E', orange:'#FF9F43', pink:'#FF7EB6', lilac:'#A98BFF', cloud:'#EEF2FF'};
export const TEAM = {red:{name:'Red', hex:'#FF5A4E'}, blue:{name:'Blue', hex:'#5BC8F5'}};
export const ROUNDS = [0, 3, 5, 10];
export const TIMERS = [0, 30, 45, 60];
export const roundsLabel = r => r ? `${r} rounds` : 'Endless';
export const timerLabel = t => t ? (t === 60 ? '1 min' : `${t} sec`) : 'Off';
export const MODE_HINTS = {
  classic:'Everyone tries to say the same word',
  chaos:'Same game, plus a letter rule after the first try',
  battle:'Two teams race to sync. First to 3 wins.'
};
export const WORD_RE = /^\p{L}+(?:-\p{L}+)*$/u;

// Same checks as checkModifier in server.js, so players get instant feedback.
export function ruleOk(word, rule){
  if(!rule) return true;
  const w = word.toLocaleLowerCase('en'), n = [...w].filter(ch => /\p{L}/u.test(ch)).length;
  return ({no_e:!w.includes('e'), atleast5:n >= 5, atmost4:n <= 4, starts_s:w.startsWith('s'), has_a:w.includes('a'), no_o:!w.includes('o'), starts_m:w.startsWith('m'), atleast7:n >= 7})[rule.id] ?? true;
}

export function av(p, cls = ''){
  return `<div class="av ${cls}" style="--c:${COLORS[p.color] || COLORS.sky}">${esc(p.avatar)}</div>`;
}
export const colorsOf = players => [...new Set(players.map(p => COLORS[p.color] || COLORS.sky).concat(['#FFD23F', '#FFFFFF', '#7ED957', '#5BC8F5']))];

export const CHECK = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5l3.2 3L13 4.5"/></svg>';

let toastTimer;
export function toast(message){
  const t = $('#toast');
  t.textContent = message; t.classList.add('on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 2400);
}

// app.js fills these in, so screens can ask for navigation without importing app.js.
export const ctl = {room:() => null, join:async () => {}, goHome:() => {}, leave:async () => {}};

export function load(key, fallback){ try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
export function save(key, value){ try { localStorage.setItem(key, JSON.stringify(value)); } catch {} }
