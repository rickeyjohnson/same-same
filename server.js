import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 3000);
const TIME_SCALE = Number(process.env.TIME_SCALE || 1); // tests use 0.01 so a 60 s timer lasts 0.6 s
const MAX_BODY = 16_384;
const MAX_PLAYERS = 8;
const BATTLE_TARGET = 3;
const ROUND_OPTIONS = [0, 3, 5, 10];   // 0 = endless
const TIMER_OPTIONS = [0, 30, 45, 60]; // seconds; 0 = no timer, 60 is the max
const COLORS = ['sky','grass','sun','tomato','orange','pink','lilac','cloud'];
const rooms = new Map();
const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const avatars = ['😎','🦊','🐸','🦋','🐱','👽','🤖','🐼','🦄','🐙','🦖','🪩'];
const chaosRules = [
  {id:'no_e',     label:'No E',          detail:"Your word can't have an E"},
  {id:'atleast5', label:'5+ letters',    detail:'At least 5 letters'},
  {id:'atmost4',  label:'4 letters max', detail:'4 letters or fewer'},
  {id:'starts_s', label:'Starts with S', detail:'Your word starts with S'},
  {id:'has_a',    label:'Needs an A',    detail:'Your word has an A in it'},
  {id:'no_o',     label:'No O',          detail:"Your word can't have an O"},
  {id:'starts_m', label:'Starts with M', detail:'Your word starts with M'},
  {id:'atleast7', label:'7+ letters',    detail:'At least 7 letters'}
];
const pick = list => list[crypto.randomInt(list.length)];
// Lobby starting spots (x%, y%), so new players don't land on top of each other.
const SPOTS = [[50,50],[22,26],[78,24],[26,74],[76,72],[50,18],[12,50],[88,50]];
const startPos = i => { const [x,y]=SPOTS[i%SPOTS.length]; return [x+crypto.randomInt(9)-4, y+crypto.randomInt(9)-4]; };
function id(bytes=9) { return crypto.randomBytes(bytes).toString('base64url'); }
function code() { let s; do { s=Array.from({length:6},()=>chars[crypto.randomInt(chars.length)]).join(''); } while(rooms.has(s)); return s; }
function error(status,message) { const e = new Error(message); e.status=status; throw e; }
function cleanName(name){ if(typeof name !== 'string' || !name.trim()) error(400,'Enter a name.'); const s=name.trim().replace(/\s+/g,' '); if(s.length>18||/[<>\u0000-\u001f]/.test(s)) error(400,'Names are 1 to 18 characters.'); return s; }
function cleanWord(word) { if(typeof word!=='string') error(400,'Use one word with letters only.'); const s=word.trim().normalize('NFC'); if([...s].length<1||[...s].length>20||!/^\p{L}+(?:-\p{L}+)*$/u.test(s)) error(400,'Use one word with letters only.'); return s; }
function checkModifier(word,rule) { if(!rule) return true; const w=word.toLocaleLowerCase('en'); const n=[...w].filter(x=>/\p{L}/u.test(x)).length; return ({no_e:!w.includes('e'),atleast5:n>=5,atmost4:n<=4,starts_s:w.startsWith('s'),has_a:w.includes('a'),no_o:!w.includes('o'),starts_m:w.startsWith('m'),atleast7:n>=7})[rule.id]; }
function normalize(word){ return word.trim().normalize('NFC').toLocaleLowerCase('en'); }
function getRoom(c){ const room=rooms.get(String(c||'').toUpperCase()); if(!room) error(404,"That room doesn't exist. Check the code."); return room; }
function playerAuth(room,b){ const p=room.players.find(p=>p.id===b.playerId&&p.token===b.token); if(!p) error(401,'Your session ended. Join the room again.'); return p; }
function requireHost(room,p){if(room.hostId!==p.id) error(403,'Only the host can do that.');}
function getTeamPlayers(room,t){return room.players.filter(p=>p.team===t);}
// Words already revealed this round can't be said again. In Battle a team only knows its own words.
function usedWords(room,p){return new Set(room.history.flatMap(a=>a.guesses).filter(g=>g.word&&(room.mode!=='battle'||g.team===p.team)).map(g=>normalize(g.word)));}
function newPlayer(b,team,index){
  return {id:id(), token:id(24), name:cleanName(b.name),
    avatar: avatars.includes(b.avatar) ? b.avatar : pick(avatars),
    color: COLORS.includes(b.color) ? b.color : pick(COLORS),
    team, pos:startPos(index),
    connections:new Set(), submission:null};
}
function readableHistory(room,p){ return room.history.map(a=>({
  attempt:a.attempt, modifier:a.modifier, at:a.at, matched:a.matched, reason:a.reason,
  guesses:a.guesses.filter(g=>room.mode!=='battle'||g.team===p.team||room.phase==='finished'),
  winner:a.winner||null
})); }
function view(room,p){ return {
  code:room.code, me:p.id, hostId:room.hostId, mode:room.mode, phase:room.phase,
  settings:room.settings, round:room.round, attempt:room.attempt,
  endsAt:room.endsAt, writeMs:room.writeMs, now:Date.now(),
  modifier:room.modifier, scores:room.scores, battleScores:room.battleScores,
  winner:room.winner, summary:room.summary, history:readableHistory(room,p),
  players:room.players.map(q=>({id:q.id,name:q.name,avatar:q.avatar,color:q.color,team:q.team,pos:q.pos,connected:q.connections.size>0,submitted:!!q.submission,isHost:q.id===room.hostId})),
  selfSubmitted:!!p.submission, myWord:p.submission?.word||'',
  latestOutcome:room.latestOutcome,
  minPlayers:room.mode==='battle'?4:2
}; }
function emit(room){ for(const p of room.players){ const message=`event: state\ndata: ${JSON.stringify(view(room,p))}\n\n`; for(const response of p.connections){try{response.write(message);}catch{p.connections.delete(response);}} } }
function cancel(room){if(room.timer) clearTimeout(room.timer); room.timer=null;}
function chooseModifier(room){ if(room.mode!=='chaos'||room.attempt===1)return null; const prev=room.lastModifierId; const pool=chaosRules.filter(r=>r.id!==prev); const rule=pool[crypto.randomInt(pool.length)]; room.lastModifierId=rule.id; return rule; }
function writing(room){
  cancel(room); room.phase='writing'; room.latestOutcome=null; room.modifier=chooseModifier(room);
  for(const p of room.players) p.submission=null;
  const ms=room.settings.timer*1000*TIME_SCALE;
  room.writeMs=ms;
  room.endsAt=ms?Date.now()+ms:null;
  if(ms) room.timer=setTimeout(()=>reveal(room,'time'),ms);
  emit(room);
}
function newRound(room){room.attempt=1; room.history=[]; room.lastModifierId=null; writing(room);}
function resetScores(room){room.round=1;room.attempt=1;room.scores={group:0};room.battleScores={red:0,blue:0};room.completed=0;room.bestAttempt=Infinity;room.totalAttempts=0;room.wins=[];room.summary=null;room.winner=null;}
function finish(room){cancel(room);room.phase='finished';room.endsAt=null;room.modifier=null;
  const {red,blue}=room.battleScores;
  room.winner=room.mode==='battle'?(red>blue?'red':blue>red?'blue':'tie'):'group';
  room.summary={rounds:room.completed, best:room.bestAttempt===Infinity?null:room.bestAttempt, totalAttempts:room.totalAttempts, score:room.scores.group, battleScores:room.battleScores, words:room.wins}; emit(room);
}
function reveal(room,reason='all'){if(room.phase!=='writing')return; cancel(room);room.phase='reveal';room.endsAt=null;
  const guesses=room.players.map(p=>({id:p.id,name:p.name,avatar:p.avatar,color:p.color,team:p.team,word:p.submission?.word||null,submittedAt:p.submission?.at||null}));
  let matched=false,winner=null,winningWord=null;
  if(room.mode==='battle'){
    const groups={red:guesses.filter(g=>g.team==='red'),blue:guesses.filter(g=>g.team==='blue')};
    const completed=Object.entries(groups).filter(([,team])=>team.length>=2&&team.every(g=>g.word&&normalize(g.word)===normalize(team[0].word)));
    if(completed.length){
      winner=completed.length===1?completed[0][0]:completed.sort((a,b)=>Math.max(...a[1].map(g=>g.submittedAt))-Math.max(...b[1].map(g=>g.submittedAt)))[0][0];
      matched=true; winningWord=groups[winner][0].word; room.battleScores[winner]+=1;
    }
  } else if(guesses.length>=2&&guesses.every(g=>g.word&&normalize(g.word)===normalize(guesses[0].word))) {
    matched=true; winningWord=guesses[0].word;
  }
  const points=matched&&room.mode!=='battle'?Math.max(11-room.attempt,1)+(room.mode==='chaos'&&room.attempt>1?2:0):0;
  room.scores.group+=points;
  room.totalAttempts++;
  room.history.push({attempt:room.attempt,at:Date.now(),modifier:room.modifier,guesses,matched,winner,reason});
  room.latestOutcome={matched,winner,winningWord,points,reason};
  if(matched){room.completed++;room.bestAttempt=Math.min(room.bestAttempt,room.attempt);room.wins.push({round:room.round,attempt:room.attempt,word:winningWord,winner});}
  emit(room);
}
function gameOver(room){
  if(room.mode==='battle'&&Math.max(room.battleScores.red,room.battleScores.blue)>=BATTLE_TARGET) return true;
  return room.settings.rounds>0&&room.round>=room.settings.rounds;
}
function advance(room){
  if(room.phase!=='reveal') error(409,'Nothing to move on from yet.');
  if(room.latestOutcome?.matched){ if(gameOver(room)) return finish(room); room.round++; newRound(room); }
  else { room.attempt++; writing(room); }
}
// Called after someone leaves or is removed in the middle of a game.
function afterRosterChange(room){
  if(!['writing','reveal'].includes(room.phase)) return;
  if(room.players.length<2){ cancel(room); room.phase='lobby'; room.endsAt=null; room.latestOutcome=null; return; }
  if(room.phase==='writing'&&room.players.every(q=>q.submission)) reveal(room,'all');
}
function safeJson(res,status,obj){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(obj));}
async function readJson(req){let body='';for await(const chunk of req){body+=chunk;if(body.length>MAX_BODY) error(413,'Request too large.');}try{return JSON.parse(body||'{}');}catch{error(400,'Invalid JSON.');}}
function playerDetails(room,p){return {code:room.code,playerId:p.id,token:p.token};}
async function action(req,res,url){const b=await readJson(req); const a=url.pathname.split('/').pop();
  if(a==='create'){
    const p=newPlayer(b,'red',0);const c=code();
    const room={code:c,hostId:p.id,players:[p],mode:'classic',phase:'lobby',settings:{rounds:0,timer:60},history:[],timer:null,endsAt:null,writeMs:0,modifier:null,lastModifierId:null,latestOutcome:null,lastActive:Date.now()};
    resetScores(room);rooms.set(c,room);return safeJson(res,200,playerDetails(room,p));
  }
  if(a==='join'){
    const room=getRoom(b.code);if(room.phase!=='lobby')error(409,'That game already started.');
    if(room.players.length>=MAX_PLAYERS)error(409,'That room is full.');
    const name=cleanName(b.name);if(room.players.some(p=>p.name.toLowerCase()===name.toLowerCase()))error(409,'Someone in the room already has that name.');
    const red=getTeamPlayers(room,'red').length,blue=getTeamPlayers(room,'blue').length;
    const p=newPlayer({...b,name},red<=blue?'red':'blue',room.players.length);
    room.players.push(p);room.lastActive=Date.now();emit(room);return safeJson(res,200,playerDetails(room,p));
  }
  const room=getRoom(b.code);const p=playerAuth(room,b);room.lastActive=Date.now();
  if(a==='mode'){
    requireHost(room,p);if(room.phase!=='lobby')error(409,'Change the mode in the lobby.');
    if(!['classic','battle','chaos'].includes(b.mode))error(400,'Pick Classic, Battle or Chaos.');room.mode=b.mode;emit(room);
  }else if(a==='settings'){
    requireHost(room,p);if(room.phase!=='lobby')error(409,'Change settings in the lobby.');
    const rounds=Number(b.rounds),timer=Number(b.timer);
    if(!ROUND_OPTIONS.includes(rounds)||!TIMER_OPTIONS.includes(timer))error(400,'Pick one of the listed options.');
    room.settings={rounds,timer};emit(room);
  }else if(a==='pos'){
    if(room.phase!=='lobby')error(409,'You can only move around in the lobby.');
    const x=Number(b.x),y=Number(b.y);if(!Number.isFinite(x)||!Number.isFinite(y))error(400,'Bad position.');
    p.pos=[Math.round(Math.min(100,Math.max(0,x))),Math.round(Math.min(100,Math.max(0,y)))];emit(room);
  }else if(a==='team'){
    if(room.phase!=='lobby')error(409,'Teams are locked once the game starts.');if(!['red','blue'].includes(b.team))error(400,'Pick red or blue.');p.team=b.team;emit(room);
  }else if(a==='start'){
    requireHost(room,p);if(room.phase!=='lobby')error(409,'That game already started.');
    if(room.mode==='battle'){
      if(room.players.length<4||getTeamPlayers(room,'red').length<2||getTeamPlayers(room,'blue').length<2)error(409,'Battle needs 4 players, 2 on each team.');
    }else if(room.players.length<2)error(409,'You need at least 2 players.');
    resetScores(room);newRound(room);
  }else if(a==='submit'){
    if(room.phase!=='writing')error(409,'Words are locked right now.');if(p.submission)error(409,'You already locked in.');
    if(room.endsAt&&Date.now()>=room.endsAt){reveal(room,'time');error(409,"Time's up!");}
    const word=cleanWord(b.word);
    if(!checkModifier(word,room.modifier))error(400,`That breaks the rule: ${room.modifier.label}.`);
    if(usedWords(room,p).has(normalize(word)))error(400,'Someone already said that this round. Try a new word.');
    p.submission={word,at:Date.now()};
    if(room.players.every(q=>q.submission))reveal(room,'all');else emit(room);
  }else if(a==='reveal'){
    requireHost(room,p);if(room.phase!=='writing')error(409,'Nothing to reveal yet.');reveal(room,'host');
  }else if(a==='next'){
    const host=room.players.find(q=>q.id===room.hostId);
    if(p.id!==room.hostId&&host?.connections.size)error(403,'Only the host can do that.');
    advance(room);
  }else if(a==='end'){
    requireHost(room,p);if(!['writing','reveal'].includes(room.phase))error(409,'There is no game to end.');finish(room);
  }else if(a==='remove'){
    requireHost(room,p);const target=room.players.find(q=>q.id===b.targetId);
    if(!target||target.id===p.id)error(400,"That player isn't in the room.");
    if(target.connections.size>0)error(409,'You can only remove players who are offline.');
    room.players=room.players.filter(q=>q!==target);
    afterRosterChange(room);emit(room);
  }else if(a==='leave'){
    for(const r of p.connections){try{r.end();}catch{}}
    p.connections.clear();
    room.players=room.players.filter(q=>q!==p);
    if(!room.players.length){cancel(room);rooms.delete(room.code);return safeJson(res,200,{ok:true});}
    if(room.hostId===p.id)room.hostId=(room.players.find(q=>q.connections.size)||room.players[0]).id;
    afterRosterChange(room);emit(room);
  }else if(a==='restart'){
    requireHost(room,p);if(room.phase!=='finished')error(409,'Finish the game first.');
    room.phase='lobby';room.round=1;room.attempt=1;room.history=[];room.latestOutcome=null;room.endsAt=null;room.modifier=null;room.winner=null;room.summary=null;room.wins=[];emit(room);
  }else error(404,'Unknown action.');
  return safeJson(res,200,{ok:true});
}
function sendFile(res,url){let pathname=decodeURIComponent(url.pathname);if(pathname==='/')pathname='/index.html';
  const full=path.resolve(PUBLIC,'.'+pathname);if(!full.startsWith(PUBLIC+path.sep))return safeJson(res,403,{error:'Forbidden'});
  const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.ico':'image/x-icon'};
  if(!types[path.extname(full)])return safeJson(res,404,{error:'Not found'});
  fs.readFile(full,(err,buf)=>{if(err)return safeJson(res,404,{error:'Not found'});res.writeHead(200,{'content-type':types[path.extname(full)],'cache-control':'no-cache','x-content-type-options':'nosniff'});res.end(buf);});
}
const server=http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://localhost');
    if(req.method==='GET'&&url.pathname==='/api/health')return safeJson(res,200,{ok:true,rooms:rooms.size});
    if(req.method==='GET'&&url.pathname==='/api/state'){
      const room=getRoom(url.searchParams.get('code')); const p=playerAuth(room,Object.fromEntries(url.searchParams));return safeJson(res,200,view(room,p));
    }
    if(req.method==='GET'&&url.pathname==='/api/events'){
      const room=getRoom(url.searchParams.get('code'));const p=playerAuth(room,Object.fromEntries(url.searchParams));
      res.writeHead(200,{'content-type':'text/event-stream; charset=utf-8','cache-control':'no-cache, no-transform','connection':'keep-alive','x-accel-buffering':'no'});
      res.write(': connected\n\n');p.connections.add(res);room.lastActive=Date.now();emit(room);
      const heartbeat=setInterval(()=>{try{res.write(': ping\n\n');}catch{}},18000);
      res.on('close',()=>{clearInterval(heartbeat);p.connections.delete(res);emit(room);});return;
    }
    if(req.method==='POST'&&url.pathname.startsWith('/api/'))return await action(req,res,url);
    if(req.method==='GET'||req.method==='HEAD')return sendFile(res,url);
    return safeJson(res,405,{error:'Method not allowed'});
  }catch(e){if(!res.headersSent)safeJson(res,e.status||500,{error:e.status?e.message:'Server error'});else res.end();}
});
// Prune abandoned rooms every hour so memory use stays bounded.
setInterval(()=>{for(const [c,r] of rooms){if(Date.now()-r.lastActive>3*60*60*1000){cancel(r);rooms.delete(c);}}},60*60*1000).unref();
server.listen(PORT,'0.0.0.0',()=>console.log(`SAME SAME running at http://localhost:${PORT}`));
