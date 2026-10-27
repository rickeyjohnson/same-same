import {$, ctl, toast} from './ui/util.js';
import * as net from './ui/net.js';
import {unlock, paintMute, toggleMute} from './ui/sfx.js';
import {openHow, closeSheets, initSheets} from './ui/sheets.js';
import * as home from './ui/home.js';
import * as lobby from './ui/lobby.js';
import * as play from './ui/play.js';
import * as end from './ui/end.js';

const screens = {home, lobby, play, end};
let current = null, room = null, lostShown = false;

const screenFor = r => r.phase === 'lobby' ? 'lobby' : r.phase === 'finished' ? 'end' : 'play';

function show(id){
  if(current && current !== id) screens[current].exit?.();
  current = id;
  for(const s of Object.keys(screens)) $('#' + s).hidden = s !== id;
  document.body.dataset.screen = id;
  closeSheets();
}

// Every live update lands here. Screens only re-render what changed.
function onState(next){
  lostShown = false;
  net.syncClock(next.now);
  const prev = room; room = next;
  const s = screenFor(next);
  if(s !== current){ show(s); screens[s].enter(next, prev); }
  else screens[s].update(prev, next);
}
function lost(){ if(!lostShown && room){ lostShown = true; toast('Reconnecting...'); } }

async function join(info){
  net.remember(info);
  try { await net.connect(onState, lost); }
  catch(e){ goHome(e.message, info.code); }
}
function goHome(error, code){
  net.disconnect(); net.forget(); room = null;
  show('home'); home.enter(null, {error, code});
}
async function leave(){
  net.disconnect();
  try { await net.api('leave'); } catch {}
  goHome();
}
Object.assign(ctl, {room:() => room, join, goHome, leave});

document.addEventListener('click', e => {
  if(e.target.closest('.mute')) toggleMute();
  else if(e.target.closest('.how-open')) openHow();
});
document.addEventListener('pointerdown', unlock);
document.addEventListener('keydown', unlock);
initSheets();
paintMute();

// Rejoin a saved room, open the join box for an invite link, or show the home screen.
const code = new URL(location.href).searchParams.get('room')?.trim().toUpperCase() || '';
const saved = code ? net.savedFor(code) : net.activeSession();
show('home');
home.enter(null, saved || !code ? {} : {code});
if(saved) join(saved);
