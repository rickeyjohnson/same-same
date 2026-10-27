import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 3000);
const WRITE_MS = Number(process.env.WRITE_MS || 20000);
const REVEAL_MS = Number(process.env.REVEAL_MS || 6500);
const MAX_BODY = 16_384;
const rooms = new Map();
const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const avatars = ['😎','🦊','🐸','🦋','🐱','👽','🤖','🐼','🦄','🐙','🦖','🪩'];
const chaosRules = [
  {id:'no_e', label:'NO E ALLOWED', detail:'Your word cannot contain the letter E.'},
  {id:'atleast5', label:'LONG STORY SHORT', detail:'Your word must have at least 5 letters.'},
  {id:'atmost4', label:'KEEP IT SHORT', detail:'Your word must have 4 letters or fewer.'},
  {id:'starts_s', label:'S CLUB', detail:'Your word must start with S.'},
  {id:'has_a', label:'A-GAME', detail:'Your word must contain A.'},
  {id:'no_o', label:'NO O ZONE', detail:'Your word cannot contain the letter O.'},
  {id:'starts_m', label:'M ENERGY', detail:'Your word must start with M.'},
  {id:'atleast7', label:'BIG WORD ENERGY', detail:'Your word must have at least 7 letters.'}
];
function id(bytes=9) { return crypto.randomBytes(bytes).toString('base64url'); }
function code() { let s; do { s=Array.from({length:6},()=>chars[crypto.randomInt(chars.length)]).join(''); } while(rooms.has(s)); return s; }
function error(status,message) { const e = new Error(message); e.status=status; throw e; }
function cleanName(name){ if(typeof name !== 'string') error(400,'Enter a name.'); const s=name.trim().replace(/\s+/g,' '); if(s.length<1||s.length>18||/[<>\u0000-\u001f]/.test(s)) error(400,'Name must be 1–18 characters.'); return s; }
function cleanWord(word) { if(typeof word!=='string') error(400,'Enter a word.'); const s=word.trim().normalize('NFC'); if([...s].length<1||[...s].length>20||!/^\p{L}+(?:-\p{L}+)*$/u.test(s)) error(400,'Use one word (1–20 letters, hyphens OK).'); return s; }
function checkModifier(word,rule) { if(!rule) return true; const w=word.toLocaleLowerCase('en'); const n=[...w].filter(x=>/\p{L}/u.test(x)).length; return ({no_e:!w.includes('e'),atleast5:n>=5,atmost4:n<=4,starts_s:w.startsWith('s'),has_a:w.includes('a'),no_o:!w.includes('o'),starts_m:w.startsWith('m'),atleast7:n>=7})[rule.id]; }
function normalize(word){ return word.trim().normalize('NFC').toLocaleLowerCase('en'); }
function getRoom(c){ const room=rooms.get(String(c||'').toUpperCase()); if(!room) error(404,'Room not found. Double-check the code.'); return room; }
function playerAuth(room,b){ const p=room.players.find(p=>p.id===b.playerId&&p.token===b.token); if(!p) error(401,'Session expired. Rejoin the room.'); return p; }
function requireHost(room,p){if(room.hostId!==p.id) error(403,'Only the host can do that.');}
function getTeamPlayers(room,t){return room.players.filter(p=>p.team===t);}
function readableHistory(room,p){ return room.history.map(a=>({
  attempt:a.attempt, modifier:a.modifier, at:a.at, matched:a.matched,
  guesses:a.guesses.filter(g=>room.mode!=='battle'||g.team===p.team||room.phase==='finished'),
  winner:a.winner||null
})); }
function view(room,p){ return {
  code:room.code, me:p.id, hostId:room.hostId, mode:room.mode, phase:room.phase,
  round:room.round, attempt:room.attempt, totalRounds:5, endsAt:room.endsAt,
  modifier:room.modifier, scores:room.scores, battleScores:room.battleScores,
  winner:room.winner, summary:room.summary, history:readableHistory(room,p),
  players:room.players.map(q=>({id:q.id,name:q.name,avatar:q.avatar,team:q.team,connected:q.connections.size>0,submitted:!!q.submission,isHost:q.id===room.hostId})),
  selfSubmitted:!!p.submission, myWord:p.submission?.word||'',
  latestOutcome:room.latestOutcome,
  minPlayers:room.mode==='battle'?4:2
}; }
function emit(room){ for(const p of room.players){ const message=`event: state\ndata: ${JSON.stringify(view(room,p))}\n\n`; for(const response of p.connections){try{response.write(message);}catch{p.connections.delete(response);}} } }
function cancel(room){if(room.timer) clearTimeout(room.timer); room.timer=null;}
function chooseModifier(room){ if(room.mode!=='chaos'||room.attempt===1)return null; const prev=room.lastModifierId; const pool=chaosRules.filter(r=>r.id!==prev); const rule=pool[crypto.randomInt(pool.length)]; room.lastModifierId=rule.id; return rule; }
function writing(room){ cancel(room); room.phase='writing'; room.latestOutcome=null; room.modifier=chooseModifier(room); room.endsAt=Date.now()+WRITE_MS;
  for(const p of room.players) p.submission=null;
  emit(room); room.timer=setTimeout(()=>reveal(room),WRITE_MS); }
function newRound(room){room.attempt=1; room.history=[]; room.lastModifierId=null; writing(room);}
function finish(room){cancel(room);room.phase='finished';room.endsAt=null;room.modifier=null;
  room.winner=room.mode==='battle'?(room.battleScores.red>room.battleScores.blue?'red':'blue'):'group';
  room.summary={rounds:room.completed, best:room.bestAttempt===Infinity?null:room.bestAttempt, totalAttempts:room.totalAttempts, score:room.scores.group, battleScores:room.battleScores}; emit(room);
}
function reveal(room){if(room.phase!=='writing')return; cancel(room);room.phase='reveal';room.endsAt=Date.now()+REVEAL_MS;
  const guesses=room.players.map(p=>({id:p.id,name:p.name,avatar:p.avatar,team:p.team,word:p.submission?.word||null,submittedAt:p.submission?.at||null}));
  let matched=false,winner=null,winningWord=null;
  if(room.mode==='battle'){
    const groups={red:guesses.filter(g=>g.team==='red'),blue:guesses.filter(g=>g.team==='blue')};
    const completed=Object.entries(groups).filter(([,team])=>team.length>=2&&team.every(g=>g.word&&normalize(g.word)===normalize(team[0].word)));
    if(completed.length){
      winner=completed.length===1?completed[0][0]:completed.sort((a,b)=>Math.max(...a[1].map(g=>g.submittedAt))-Math.max(...b[1].map(g=>g.submittedAt)))[0][0];
      matched=true; winningWord=groups[winner][0].word; room.battleScores[winner]+=1;
    }
  } else if(guesses.length>=2&&guesses.every(g=>g.word&&normalize(g.word)===normalize(guesses[0].word))) {
    matched=true; winningWord=guesses[0].word; const pts=Math.max(11-room.attempt,1)+(room.mode==='chaos'&&room.attempt>1?2:0);
    room.scores.group+=pts;
  }
  room.totalAttempts++;
  const record={attempt:room.attempt,at:Date.now(),modifier:room.modifier,guesses,matched,winner};
  room.history.push(record);
  room.latestOutcome={matched,winner,winningWord,points:matched&&room.mode!=='battle'?Math.max(11-room.attempt,1)+(room.mode==='chaos'&&room.attempt>1?2:0):0};
  if(matched){room.completed++;room.bestAttempt=Math.min(room.bestAttempt,room.attempt);}
  emit(room);
  room.timer=setTimeout(()=>{
    if(room.phase!=='reveal')return;
    if(matched){
      if((room.mode==='battle'&&(room.battleScores.red>=3||room.battleScores.blue>=3||room.round>=5)) || (room.mode!=='battle'&&room.round>=5)) finish(room);
      else {room.round++;newRound(room);}
    } else {room.attempt++;writing(room);}
  },REVEAL_MS);
}
function safeJson(res,status,obj){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(obj));}
async function readJson(req){let body='';for await(const chunk of req){body+=chunk;if(body.length>MAX_BODY) error(413,'Request too large.');}try{return JSON.parse(body||'{}');}catch{error(400,'Invalid JSON.');}}
function playerDetails(room,p){return {code:room.code,playerId:p.id,token:p.token};}
async function action(req,res,url){const b=await readJson(req); const a=url.pathname.split('/').pop();
  if(a==='create'){
    const name=cleanName(b.name); const c=code();const p={id:id(),token:id(24),name,avatar:avatars.includes(b.avatar)?b.avatar:avatars[crypto.randomInt(avatars.length)],team:'red',connections:new Set(),submission:null};
    const room={code:c,hostId:p.id,players:[p],mode:'classic',phase:'lobby',round:1,attempt:1,history:[],timer:null,endsAt:null,modifier:null,lastModifierId:null,scores:{group:0},battleScores:{red:0,blue:0},completed:0,bestAttempt:Infinity,totalAttempts:0,latestOutcome:null,winner:null,summary:null,lastActive:Date.now()};
    rooms.set(c,room);return safeJson(res,200,playerDetails(room,p));
  }
  if(a==='join'){
    const room=getRoom(b.code);if(room.phase!=='lobby')error(409,'This game already started. Join the next one.');
    if(room.players.length>=8)error(409,'That room is full (8 players max).');
    const name=cleanName(b.name);if(room.players.some(p=>p.name.toLowerCase()===name.toLowerCase()))error(409,'That name is taken in this room.');
    const red=getTeamPlayers(room,'red').length,blue=getTeamPlayers(room,'blue').length;
    const p={id:id(),token:id(24),name,avatar:avatars.includes(b.avatar)?b.avatar:avatars[crypto.randomInt(avatars.length)],team:red<=blue?'red':'blue',connections:new Set(),submission:null};
    room.players.push(p);room.lastActive=Date.now();emit(room);return safeJson(res,200,playerDetails(room,p));
  }
  const room=getRoom(b.code);const p=playerAuth(room,b);room.lastActive=Date.now();
  if(a==='mode'){
    requireHost(room,p);if(room.phase!=='lobby')error(409,'Modes can only change in the lobby.');
    if(!['classic','battle','chaos'].includes(b.mode))error(400,'Invalid game mode.');room.mode=b.mode;emit(room);
  }else if(a==='team'){
    if(room.phase!=='lobby')error(409,'Teams are locked after starting.');if(!['red','blue'].includes(b.team))error(400,'Invalid team.');p.team=b.team;emit(room);
  }else if(a==='start'){
    requireHost(room,p);if(room.phase!=='lobby')error(409,'Game already started.');
    if(room.players.length<(room.mode==='battle'?4:2))error(409,`Need ${room.mode==='battle'?4:2} players to start.`);
    if(room.mode==='battle'&&(getTeamPlayers(room,'red').length<2||getTeamPlayers(room,'blue').length<2))error(409,'Brain Battle needs at least 2 players on each team.');
    room.round=1;room.scores={group:0};room.battleScores={red:0,blue:0};room.completed=0;room.bestAttempt=Infinity;room.totalAttempts=0;room.summary=null;room.winner=null;newRound(room);
  }else if(a==='submit'){
    if(room.phase!=='writing')error(409,'Not accepting words right now.');if(p.submission)error(409,'Already locked in.');
    if(Date.now()>=room.endsAt){reveal(room);error(409,'Time is up!');}
    const word=cleanWord(b.word);
    if(!checkModifier(word,room.modifier))error(400,`Word doesn't follow the rule: ${room.modifier.detail}`);
    p.submission={word,at:Date.now()};
    if(room.players.every(q=>q.submission))reveal(room);else emit(room);
  }else if(a==='remove'){
    requireHost(room,p);const target=room.players.find(q=>q.id===b.targetId);
    if(!target||target.id===p.id)error(400,'Invalid player.');
    if(target.connections.size>0)error(409,'You can only remove a disconnected player.');
    room.players=room.players.filter(q=>q!==target);
    if(room.phase==='writing'){
      if(room.players.length<2) {cancel(room);room.phase='lobby';room.endsAt=null;}
      else if(room.players.every(q=>q.submission))reveal(room);
    } emit(room);
  }else if(a==='restart'){
    requireHost(room,p);if(room.phase!=='finished')error(409,'Finish the current game first.');
    room.phase='lobby';room.round=1;room.attempt=1;room.history=[];room.latestOutcome=null;room.endsAt=null;room.modifier=null;room.winner=null;room.summary=null;emit(room);
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
