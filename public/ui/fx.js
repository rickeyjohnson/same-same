import {$, pick} from './util.js';

const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function burst(x, y, colors, n = 46){
  if(calm()) return;
  const fx = $('#fx');
  for(let i = 0; i < n; i++){
    const el = document.createElement('i'), a = Math.random() * Math.PI * 2, d = 110 + Math.random() * 230;
    el.className = 'cf';
    el.style.cssText = `left:${x}px;top:${y}px;background:${pick(colors)};--x:${Math.cos(a) * d}px;--y:${Math.sin(a) * d * .8 - 70}px;--r:${Math.random() * 900 - 450}deg;animation-duration:${1.4 + Math.random() * .8}s`;
    fx.appendChild(el);
    setTimeout(() => el.remove(), 2400);
  }
}

// Falls from the top for `ms`, and stops early once the end screen is gone.
export function rain(ms, colors){
  if(calm()) return;
  const fx = $('#fx'), end = Date.now() + ms;
  (function drop(){
    if(Date.now() > end || document.body.dataset.screen !== 'end') return;
    for(let i = 0; i < 4; i++){
      const el = document.createElement('i'), t = 2.2 + Math.random() * 1.6;
      el.className = 'cf fall';
      el.style.cssText = `left:${Math.random() * 100}vw;top:-20px;background:${pick(colors)};--x:${Math.random() * 160 - 80}px;--r:${Math.random() * 1000 - 500}deg;--t:${t}s`;
      fx.appendChild(el);
      setTimeout(() => el.remove(), t * 1000 + 100);
    }
    setTimeout(drop, 110);
  })();
}
