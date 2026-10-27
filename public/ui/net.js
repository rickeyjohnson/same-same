const KEY = 'same-same-sessions';
export let session = null;
let offset = 0;
let source = null;

// The server sends its clock with every state, so timers line up on every device.
export const serverNow = () => Date.now() + offset;
export const syncClock = now => { if(Number.isFinite(now)) offset = now - Date.now(); };

const saved = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } };
const store = all => { try { localStorage.setItem(KEY, JSON.stringify(all)); } catch {} };
export const savedFor = code => saved()[code] || null;
export function activeSession(){ const all = saved(); return all._active ? all[all._active] || null : null; }

export function remember(s){
  session = s;
  const all = saved(); all[s.code] = s; all._active = s.code; store(all);
  history.replaceState(null, '', `/?room=${s.code}`);
}
export function forget(){
  if(session){ const all = saved(); delete all[session.code]; if(all._active === session.code) delete all._active; store(all); }
  session = null;
  history.replaceState(null, '', '/');
}

export async function api(action, body = {}){
  const r = await fetch(`/api/${action}`, {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({...session, ...body})});
  const data = await r.json().catch(() => ({}));
  if(!r.ok) throw new Error(data.error || 'Something went wrong. Try again.');
  return data;
}

export async function connect(onState, onLost){
  const q = new URLSearchParams({code:session.code, playerId:session.playerId, token:session.token});
  const r = await fetch('/api/state?' + q);
  if(!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'That room is gone.');
  onState(await r.json());
  source?.close();
  source = new EventSource('/api/events?' + q);
  source.addEventListener('state', ev => onState(JSON.parse(ev.data)));
  source.onerror = () => onLost?.();
}
export function disconnect(){ source?.close(); source = null; }
