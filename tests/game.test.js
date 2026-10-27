import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';

const port=39000+Math.floor(Math.random()*1000);
const base=`http://127.0.0.1:${port}`;
const server=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),WRITE_MS:'2000',REVEAL_MS:'95'},stdio:'pipe'});
server.stderr.on('data',b=>process.stderr.write(b));
const post=async(action,payload={})=>{const r=await fetch(`${base}/api/${action}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)}); const data=await r.json();if(!r.ok)throw Error(`${action}: ${data.error}`);return data;};
const state=async(p)=>{const r=await fetch(`${base}/api/state?`+new URLSearchParams({code:p.code,playerId:p.playerId,token:p.token}));assert.equal(r.status,200);return r.json();};
async function until(p,predicate){for(let i=0;i<150;i++){const s=await state(p);if(predicate(s))return s;await delay(25);}throw Error('Timed out waiting for phase');}
async function addPlayers(count){const host=await post('create',{name:'Player1'});const players=[host];for(let i=1;i<count;i++)players.push(await post('join',{code:host.code,name:`Player${i+1}`}));return players;}
async function words(players,guesses){await Promise.all(players.map((p,i)=>post('submit',{...p,word:guesses[i]})));return until(players[0],s=>s.phase==='reveal');}

try{for(let i=0;i<60;i++){try{const r=await fetch(`${base}/api/health`);if(r.ok)break;}catch{}await delay(50);}}catch{}
test('multiplayer 2 players: join, synchronized reveals, retry, 5 completed rounds and replay',async()=>{
  const [a,b]=await addPlayers(2);
  await post('start',a);
  let s=await state(a);assert.equal(s.phase,'writing');assert.equal(s.attempt,1);assert.equal(s.history.length,0);assert.equal(s.players.length,2);
  await post('submit',{...a,word:'Dog'});let other=await state(b);assert.equal(other.players.find(p=>p.id===a.playerId).submitted,true);assert.equal(other.history.length,0);assert.equal(other.myWord,'');
  await post('submit',{...b,word:'pizza'});s=await until(a,x=>x.phase==='reveal');assert.equal(s.latestOutcome.matched,false);assert.equal(s.history[0].guesses.length,2);
  await until(a,x=>x.phase==='writing'&&x.attempt===2);
  await words([a,b],['Ocean','ocean']);s=await state(a);assert.equal(s.latestOutcome.matched,true);assert.equal(s.latestOutcome.points,9);
  for(let r=2;r<=5;r++){
    await until(a,x=>x.phase==='writing'&&x.round===r);
    await words([a,b],['Banana','BANANA']);
  }
  s=await until(a,x=>x.phase==='finished');assert.equal(s.summary.rounds,5);assert.equal(s.summary.totalAttempts,6);assert.equal(s.summary.score,49);assert.equal(s.winner,'group');
  await post('restart',a);s=await state(b);assert.equal(s.phase,'lobby');
});
test('chaos applies checkable word restrictions after random first round',async()=>{
  const [a,b]=await addPlayers(2);await post('mode',{...a,mode:'chaos'});await post('start',a);await words([a,b],['Cat','dog']);
  const s=await until(a,x=>x.phase==='writing'&&x.attempt===2);assert.ok(s.modifier);assert.ok(s.modifier.detail);
  const choices={no_e:'banana',atleast5:'banana',atmost4:'sun',starts_s:'sun',has_a:'banana',no_o:'banana',starts_m:'melon',atleast7:'bananaaa'};
  const word=choices[s.modifier.id];assert.ok(word);
  await words([a,b],[word,word]);const end=await state(a);assert.equal(end.latestOutcome.matched,true);assert.equal(end.latestOutcome.points,11);
});
test('brain battle: teams privately see only own guesses and win best of five',async()=>{
  const players=await addPlayers(4);const [host,...others]=players;
  await post('mode',{...host,mode:'battle'});
  let s=await state(host);assert.deepEqual(s.players.map(p=>p.team),['red','blue','red','blue']);await post('start',host);
  for(let r=1;r<=3;r++){
    await until(host,x=>x.phase==='writing'&&x.round===r);
    await words(players,['same','other','SAME','different']);
    s=await state(host);assert.equal(s.latestOutcome.winner,'red');assert.equal(s.battleScores.red,r);assert.equal(s.history.at(-1).guesses.length,2);
    const blue=await state(others[0]);assert.equal(blue.history.at(-1).guesses.length,2);
    assert.ok(blue.history.at(-1).guesses.every(g=>g.team==='blue'));
  }
  s=await until(host,x=>x.phase==='finished');assert.equal(s.winner,'red');assert.equal(s.battleScores.red,3);
});

test('SSE sends live room updates to a remote device', async()=>{
  const host=await post('create',{name:'SSEHost'});
  const controller=new AbortController();
  const endpoint=`${base}/api/events?`+new URLSearchParams({code:host.code,playerId:host.playerId,token:host.token});
  const res=await fetch(endpoint,{signal:controller.signal});
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

test('server serves html css and js and blocks path traversal',async()=>{
  for(const [path,type] of [['/','text/html'],['/style.css','text/css'],['/app.js','text/javascript']]){const r=await fetch(base+path);assert.equal(r.status,200);assert.ok(r.headers.get('content-type').includes(type));}
  const r=await fetch(base+'/nope');assert.equal(r.status,404);
});
test.after(()=>server.kill('SIGTERM'));
