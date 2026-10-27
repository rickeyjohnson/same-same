import {$, esc, av, colorsOf, TEAM, ctl, toast} from './util.js';
import {api} from './net.js';
import {SFX} from './sfx.js';
import {rain} from './fx.js';

let wired = false, lastButtons = '';

function countUp(el, to){
  const t0 = performance.now();
  (function step(t){ const k = Math.min(1, (t - t0) / 900); el.textContent = Math.round(to * k); if(k < 1) requestAnimationFrame(step); })(t0);
}
function paintButtons(r){
  const host = r.players.find(p => p.id === r.hostId);
  const html = r.me === r.hostId
    ? '<button type="button" class="btn go" id="again">Play again</button><button type="button" class="btn ghost" id="endLeave">Leave</button>'
    : `<p class="note">Waiting for ${esc(host?.name || 'the host')}</p><button type="button" class="btn ghost" id="endLeave">Leave</button>`;
  if(html !== lastButtons){ $('#endBtns').innerHTML = html; lastButtons = html; }
}
function wire(){
  wired = true;
  $('#endBtns').addEventListener('click', async e => {
    const b = e.target.closest('button'); if(!b) return;
    if(b.id === 'endLeave') return ctl.leave();
    if(b.id === 'again'){ b.disabled = true; try { await api('restart'); } catch(err){ toast(err.message); b.disabled = false; } }
  });
}

export function enter(r){
  if(!wired) wire();
  lastButtons = '';
  const s = r.summary || {}, battle = r.mode === 'battle', title = $('#endTitle'), big = $('#endBig');
  title.className = 'end-title shout';
  if(battle){
    title.textContent = r.winner === 'tie' ? 'Tie game' : `${TEAM[r.winner]?.name} team wins!`;
    if(TEAM[r.winner]) title.classList.add(r.winner);
    big.className = 'big teams';
    big.innerHTML = `<div class="tr"><b>${s.battleScores?.red ?? 0}</b><span>Red</span></div><div class="tb"><b>${s.battleScores?.blue ?? 0}</b><span>Blue</span></div>`;
  } else {
    if(s.rounds){ title.innerHTML = '<span>SAME</span><span>SAME</span>'; title.classList.add('stack'); }
    else title.textContent = 'Good game';
    big.className = 'big';
    big.innerHTML = '<b id="endScore">0</b><span>points together</span>';
    countUp($('#endScore'), s.score || 0);
  }
  $('#stRounds').textContent = s.rounds || 0;
  $('#stTries').textContent = s.totalAttempts || 0;
  $('#stBest').textContent = s.best ? `try ${s.best}` : '-';
  $('#trail').innerHTML = (s.words || []).map((w, i) => `<div class="tw" style="animation-delay:${300 + i * 120}ms"><span class="pill ${battle ? w.winner : 'ok'}">${esc(String(w.word).toLocaleLowerCase('en'))}</span><span>${w.attempt === 1 ? '1 try' : `${w.attempt} tries`}</span></div>`).join('');
  $('#crew').innerHTML = r.players.map((p, i) => `<span class="cw" style="animation-delay:${i * .12}s">${av(p, p.id === r.me ? 'me' : '')}</span>`).join('');
  paintButtons(r);
  SFX.win();
  rain(3200, battle && TEAM[r.winner] ? [TEAM[r.winner].hex, '#FFD23F', '#FFFFFF'] : colorsOf(r.players));
}
export function update(prev, next){ paintButtons(next); }
export function exit(){}
