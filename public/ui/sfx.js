import {load, save} from './util.js';

let ac = null;
let muted = load('same-same-muted', false);

const SPK_ON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>';
const SPK_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 9l5 6M22 9l-5 6"/></svg>';

// Browsers only allow audio after a tap, so app.js calls this on the first pointerdown.
export function unlock(){
  if(!ac){ try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch {} }
  if(ac?.state === 'suspended') ac.resume();
}

function tone(freq, dur = .12, type = 'sine', vol = .14, when = 0){
  if(muted || !ac) return;
  const t = ac.currentTime + when, o = ac.createOscillator(), g = ac.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + .01); g.gain.exponentialRampToValueAtTime(.001, t + dur);
  o.connect(g).connect(ac.destination); o.start(t); o.stop(t + dur + .03);
}

export const SFX = {
  pop:  () => tone(660, .1, 'triangle', .12),
  join: () => { tone(700, .07, 'sine', .1); tone(1050, .09, 'sine', .08, .06); },
  lock: () => { tone(520, .07, 'square', .05); tone(780, .09, 'square', .045, .06); },
  tick: n => tone(392 * Math.pow(1.122, n), .2, 'triangle', .16),
  buzz: () => { tone(150, .38, 'sawtooth', .08); tone(112, .42, 'sawtooth', .06, .05); },
  soft: () => tone(180, .2, 'sawtooth', .05),
  warn: () => { tone(880, .12, 'square', .06); tone(880, .12, 'square', .06, .18); },
  win:  () => [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, .28, 'triangle', .13, i * .085))
};

export function paintMute(){
  document.querySelectorAll('.mute').forEach(b => { b.innerHTML = muted ? SPK_OFF : SPK_ON; b.setAttribute('aria-label', muted ? 'Unmute' : 'Mute'); });
}
export function toggleMute(){ muted = !muted; save('same-same-muted', muted); paintMute(); }
