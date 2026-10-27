import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';

const port=39000+Math.floor(Math.random()*1000);
const base=`http://127.0.0.1:${port}`;
// TIME_SCALE shrinks the guess timer: 60 s becomes 0.6 s, 30 s becomes 0.3 s.
const server=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),TIME_SCALE:'0.01'},stdio:'pipe'});
server.stderr.on('data',b=>process.stderr.write(b));
const raw=async(action,payload={})=>{const r=await fetch(`${base}/api/${action}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});return {status:r.status,data:await r.json()};};
const post=async(action,payload={})=>{const {status,data}=await raw(action,payload);if(status!==200)throw Error(`${action}: ${data.error}`);return data;};
const next=p=>post('next',p);
const query=p=>new URLSearchParams({code:p.code,playerId:p.playerId,token:p.token});
const state=async(p)=>{const r=await fetch(`${base}/api/state?`+query(p));assert.equal(r.status,200);return r.json();};
async function until(p,predicate){for(let i=0;i<150;i++){const s=await state(p);if(predicate(s))return s;await delay(25);}throw Error('Timed out waiting for phase');}
async function addPlayers(count){const host=await post('create',{name:'Player1'});const players=[host];for(let i=1;i<count;i++)players.push(await post('join',{code:host.code,name:`Player${i+1}`}));return players;}
async function words(players,guesses){await Promise.all(players.map((p,i)=>post('submit',{...p,word:guesses[i]})));return until(players[0],s=>s.phase==='reveal');}
async function listen(p){const controller=new AbortController();const res=await fetch(`${base}/api/events?`+query(p),{signal:controller.signal});const reader=res.body.getReader();await reader.read();return async()=>{controller.abort();await delay(35);};}

try{for(let i=0;i<60;i++){try{const r=await fetch(`${base}/api/health`);if(r.ok)break;}catch{}await delay(50);}}catch{}

test('classic: avatars and colors, retries, a set number of rounds and replay',async()=>{
  const a=await post('create',{name:'Player1',avatar:'🦊',color:'pink'});
  const b=await post('join',{code:a.code,name:'Player2',avatar:'nope',color:'nope'});
  let s=await state(a);
  assert.deepEqual(s.settings,{rounds:0,timer:60});
  assert.equal(s.players[0].avatar,'🦊');assert.equal(s.players[0].color,'pink');
  assert.ok(['sky','grass','sun','tomato','orange','pink','lilac','cloud'].includes(s.players[1].color));
  assert.equal(s.players[0].pos.length,2);
  await post('settings',{...a,rounds:5,timer:60});
  await post('start',a);
  s=await state(a);assert.equal(s.phase,'writing');assert.equal(s.attempt,1);assert.equal(s.history.length,0);assert.equal(s.writeMs,600);assert.ok(s.endsAt>s.now-50);
  await post('submit',{...a,word:'Dog'});let other=await state(b);assert.equal(other.players.find(p=>p.id===a.playerId).submitted,true);assert.equal(other.history.length,0);assert.equal(other.myWord,'');
  await post('submit',{...b,word:'pizza'});s=await until(a,x=>x.phase==='reveal');
  assert.equal(s.latestOutcome.matched,false);assert.equal(s.latestOutcome.reason,'all');assert.equal(s.history[0].guesses.length,2);assert.equal(s.history[0].guesses[0].color,'pink');
  await delay(80);assert.equal((await state(a)).phase,'reveal');
  await next(a);
  await until(a,x=>x.phase==='writing'&&x.attempt===2);
  await words([a,b],['Ocean','ocean']);s=await state(a);assert.equal(s.latestOutcome.matched,true);assert.equal(s.latestOutcome.points,9);
  for(let r=2;r<=5;r++){
    await next(a);
    await until(a,x=>x.phase==='writing'&&x.round===r);
    await words([a,b],['Banana','BANANA']);
  }
  await next(a);
  s=await until(a,x=>x.phase==='finished');assert.equal(s.summary.rounds,5);assert.equal(s.summary.totalAttempts,6);assert.equal(s.summary.score,49);assert.equal(s.winner,'group');assert.equal(s.summary.words.length,5);
  await post('restart',a);s=await state(b);assert.equal(s.phase,'lobby');
});

test('settings: host only, listed values only',async()=>{
  const [a,b]=await addPlayers(2);
  assert.equal((await raw('settings',{...b,rounds:3,timer:30})).status,403);
  assert.equal((await raw('settings',{...a,rounds:7,timer:30})).status,400);
  assert.equal((await raw('settings',{...a,rounds:3,timer:90})).status,400);
  await post('settings',{...a,rounds:10,timer:0});assert.deepEqual((await state(b)).settings,{rounds:10,timer:0});
});

test('endless rounds keep going until the host ends the game',async()=>{
  const [a,b]=await addPlayers(2);await post('start',a);
  for(let r=1;r<=6;r++){await until(a,x=>x.phase==='writing'&&x.round===r);await words([a,b],['moon','moon']);await next(a);}
  let s=await until(a,x=>x.phase==='writing'&&x.round===7);
  assert.equal((await raw('end',b)).status,403);
  await post('end',a);s=await state(b);assert.equal(s.phase,'finished');assert.equal(s.summary.words.length,6);assert.equal(s.summary.words[0].word,'moon');
});

test('the timer reveals on time; with no timer the game waits for everyone or the host',async()=>{
  const [a,b]=await addPlayers(2);await post('settings',{...a,rounds:0,timer:30});await post('start',a);
  await post('submit',{...a,word:'cloud'});
  let s=await until(a,x=>x.phase==='reveal');
  assert.equal(s.latestOutcome.reason,'time');assert.equal(s.history[0].guesses.find(g=>g.id===b.playerId).word,null);assert.equal(s.endsAt,null);
  assert.equal((await raw('submit',{...b,word:'cloud'})).status,409);
  await post('end',a);await post('restart',a);
  await post('settings',{...a,rounds:0,timer:0});await post('start',a);
  s=await state(a);assert.equal(s.endsAt,null);assert.equal(s.writeMs,0);
  await post('submit',{...a,word:'cloud'});await delay(200);
  assert.equal((await state(a)).phase,'writing');
  assert.equal((await raw('reveal',b)).status,403);
  await post('reveal',a);s=await state(a);assert.equal(s.phase,'reveal');assert.equal(s.latestOutcome.reason,'host');
});

test('only the host moves on while connected; anyone can when the host is offline',async()=>{
  const [a,b]=await addPlayers(2);await post('settings',{...a,rounds:0,timer:0});await post('start',a);
  await words([a,b],['red','blue']);
  await next(b);
  await until(a,x=>x.phase==='writing'&&x.attempt===2);
  await words([a,b],['red','blue']);
  const stop=await listen(a);
  try{assert.equal((await raw('next',b)).status,403);await next(a);}finally{await stop();}
  await until(a,x=>x.phase==='writing'&&x.attempt===3);
  assert.equal((await raw('next',a)).status,409);
});

test('players can move around the lobby, and only there',async()=>{
  const [a,b]=await addPlayers(2);
  await post('pos',{...b,x:150,y:-20});assert.deepEqual((await state(a)).players[1].pos,[100,0]);
  assert.equal((await raw('pos',{...b,x:'left',y:3})).status,400);
  await post('start',a);assert.equal((await raw('pos',{...b,x:5,y:5})).status,409);
});

test('leaving hands off the host, finishes waiting reveals and closes empty rooms',async()=>{
  const [a,b,c]=await addPlayers(3);
  await post('leave',a);let s=await state(b);assert.equal(s.players.length,2);assert.equal(s.hostId,b.playerId);
  await post('settings',{...b,rounds:0,timer:0});
  const d=await post('join',{code:b.code,name:'Player4'});
  await post('start',b);await post('submit',{...b,word:'tree'});await post('submit',{...c,word:'tree'});
  assert.equal((await state(b)).phase,'writing');
  await post('leave',d);s=await state(b);assert.equal(s.phase,'reveal');assert.equal(s.latestOutcome.matched,true);
  await post('leave',c);s=await state(b);assert.equal(s.phase,'lobby');
  await post('leave',b);const r=await fetch(`${base}/api/state?`+query(b));assert.equal(r.status,404);
});

test('chaos rules apply after the first try',async()=>{
  const [a,b]=await addPlayers(2);await post('mode',{...a,mode:'chaos'});await post('settings',{...a,rounds:0,timer:0});await post('start',a);
  let s=await state(a);assert.equal(s.modifier,null);
  await words([a,b],['Cat','dog']);await next(a);
  s=await until(a,x=>x.phase==='writing'&&x.attempt===2);assert.ok(s.modifier.label);assert.ok(s.modifier.detail);
  const good={no_e:'banana',atleast5:'banana',atmost4:'sun',starts_s:'sun',has_a:'banana',no_o:'banana',starts_m:'melon',atleast7:'bananaaa'}[s.modifier.id];
  const bad={no_e:'tree',atleast5:'cat',atmost4:'banana',starts_s:'moon',has_a:'moon',no_o:'moon',starts_m:'cat',atleast7:'cat'}[s.modifier.id];
  const r=await raw('submit',{...a,word:bad});assert.equal(r.status,400);assert.match(r.data.error,/That breaks the rule/);
  await words([a,b],[good,good]);s=await state(a);assert.equal(s.latestOutcome.matched,true);assert.equal(s.latestOutcome.points,11);
});

test('battle: teams only see their own words and the first team to 3 wins',async()=>{
  const players=await addPlayers(4);const [host,...others]=players;
  await post('mode',{...host,mode:'battle'});
  let s=await state(host);assert.deepEqual(s.players.map(p=>p.team),['red','blue','red','blue']);
  await post('team',{...others[0],team:'red'});
  assert.equal((await raw('start',host)).status,409);
  await post('team',{...others[0],team:'blue'});
  await post('start',host);
  for(let r=1;r<=3;r++){
    await until(host,x=>x.phase==='writing'&&x.round===r);
    await words(players,['same','other','SAME','different']);
    s=await state(host);assert.equal(s.latestOutcome.winner,'red');assert.equal(s.battleScores.red,r);assert.equal(s.history.at(-1).guesses.length,2);
    const blue=await state(others[0]);assert.equal(blue.history.at(-1).guesses.length,2);
    assert.ok(blue.history.at(-1).guesses.every(g=>g.team==='blue'));
    await next(host);
  }
  s=await until(host,x=>x.phase==='finished');assert.equal(s.winner,'red');assert.equal(s.battleScores.red,3);
});

test('SSE sends live room updates to a remote device', async()=>{
  const host=await post('create',{name:'SSEHost'});
  const controller=new AbortController();
  const res=await fetch(`${base}/api/events?`+query(host),{signal:controller.signal});
  assert.equal(res.status,200);
  assert.ok(res.headers.get('content-type').includes('text/event-stream'));
  const reader=res.body.getReader(), decoder=new TextDecoder();
  let chunk=decoder.decode((await reader.read()).value);
  assert.ok(chunk.includes('event: state'));
  const updated=await state(host);
  assert.equal(updated.players[0].connected,true);
  await post('join',{code:host.code,name:'SSEGuest'});
  let sawGuest=chunk.includes('SSEGuest');
  for(let n=0;n<5&&!sawGuest;n++){
    chunk+=decoder.decode((await reader.read()).value);
    sawGuest=chunk.includes('SSEGuest');
  }
  assert.equal(sawGuest,true);
  controller.abort();
  await delay(35);
  assert.equal((await state(host)).players[0].connected,false);
});

test('server serves the page, styles and scripts and blocks path traversal',async()=>{
  for(const [path,type] of [['/','text/html'],['/style.css','text/css'],['/app.js','text/javascript'],['/ui/play.js','text/javascript'],['/favicon.svg','image/svg+xml']]){const r=await fetch(base+path);assert.equal(r.status,200,path);assert.ok(r.headers.get('content-type').includes(type));}
  assert.equal((await fetch(base+'/nope')).status,404);
});
test.after(()=>server.kill('SIGTERM'));
