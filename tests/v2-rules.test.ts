import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createV2State, v2Input, loadV2Kernel, resolveV2, advanceV2State, applyV2Barter, reservesV2, type V2Move, type V2Deal } from '../packages/engine/src/v2';
await loadV2Kernel(new Uint8Array(await readFile('apps/web/public/engine/rules-v2.wasm')).buffer);
const jointWell:V2Deal={active:true,kind:2,maker:0,taker:2,provider:2,action:3,delivery:0,job:255,gives:[[2,0,0],[0,1,0]]};
for(const count of [4,5,6])for(const bypass of [false,true])test(`V2 canonical Wasm complete campaign N=${count}, bridge ${bypass?'detour':'repair'}`,async()=>{
 let s=createV2State(count);const descriptions:unknown[]=[];
 for(let stage=0;stage<6;stage++){
  const moves:V2Move[]=s.players.map(()=>({action:2,route:0,delivery:0}));
  if(stage===1&&!bypass)for(let i=1;i<=Math.ceil(count/2);i++)moves[i].action=3;
  if(stage===1&&bypass)moves.forEach(m=>m.route=1);
  if(stage===2){moves[0].action=count===4?2:1;moves[1].action=1;moves[count===4?3:4].action=4;if(count===6&&!bypass)moves[5].action=4;if(count===6&&bypass)moves.forEach(m=>m.route=1);}
  if(stage===3){moves.forEach(m=>m.action=1);moves[2].action=4;moves[3].action=4;}
  if(stage===4){moves[2].action=3;moves[3].action=3;}
  if(stage===5)moves.forEach((m,i)=>{m.delivery=Math.min(5,s.players[i].resources[2]);if(count===6&&bypass)m.route=1;});
  const r=await resolveV2(v2Input(s,moves,stage===0?[jointWell]:[]));
  descriptions.push({stage,hull:r.hull,objective:r.objective,progress:r.progress,goal:r.goal});
  assert.ok(r.hull>0,JSON.stringify(descriptions));s=advanceV2State(s,r);
 }
 assert.equal(s.arrived,true,JSON.stringify(descriptions));assert.equal(s.history.length,6);
 assert.equal(!!(s.flags&2),!bypass);assert.ok(s.players.reduce((sum,p)=>sum+p.delivered,0)>0);
 assert.ok(s.history[2].inputs.some(b=>b[0]>0&&b[1]>0),'cargo extraction consumes real inputs');
});
for(const action of [0,1,2,3,4])test(`V2 one repeated action ${action} cannot replace the campaign`,async()=>{
 for(const count of [4,5,6]){let s=createV2State(count);for(let stage=0;stage<6&&!s.finished;stage++){const r=await resolveV2(v2Input(s,s.players.map(()=>({action,route:0,delivery:0}))));s=advanceV2State(s,r);}assert.equal(s.arrived,false);}
});
test('V2 Barter executes immediately in Rust; retained deal is not transferred again',async()=>{
 const s=createV2State();const totals=(p:typeof s.players)=>[0,1,2].map(j=>p.reduce((v,p)=>v+p.resources[j],0));
 const d:V2Deal={active:true,kind:0,maker:0,taker:1,provider:0,action:0,delivery:0,job:255,gives:[[1,0,0],[0,1,0]]};
 const players=await applyV2Barter(s.players,0,1,d.gives);assert.deepEqual(totals(players),totals(s.players));assert.deepEqual(players[0].resources,[2,1,0]);
 const r=await resolveV2({...v2Input(s,s.players.map(()=>({action:2,route:0,delivery:0})),[d]),players});
 assert.deepEqual(r.players[0].resources,[4,1,0]);
});
test('V2 funded joint well reserves exact inputs, survives missing reveal and retains additive receipt',async()=>{
 const s=createV2State();assert.deepEqual(await reservesV2(0,jointWell),[[2,0,0],[0,1,0]]);
 const r=await resolveV2(v2Input(s,s.players.map(()=>({action:2,route:0,delivery:0})),[jointWell],4));
 assert.deepEqual(r.inputs[0],[2,0,0]);assert.deepEqual(r.outputs[0],[7,0,0]);
 assert.deepEqual(r.inputs[2],[0,1,0]);assert.equal(r.actions[2],3);assert.equal(r.players[2].forfeited,true);assert.equal(r.work[0].executed,true);
});
test('V2 ordinary output overflow has a truthful rejected receipt and cannot block resolution',async()=>{
 const s=createV2State();s.players[0].resources[0]=200;
 const r=await resolveV2(v2Input(s,s.players.map(()=>({action:2,route:0,delivery:0}))));
 assert.equal(r.actions[0],0);assert.equal(r.rejected[0],4);assert.equal(r.players[0].resources[0],199);
});
test('V2 unsupported or incorrect production recipe is rejected by the same kernel',async()=>{
 await assert.rejects(()=>reservesV2(1,jointWell));
 await assert.rejects(()=>reservesV2(0,{...jointWell,gives:[[1,0,0],[0,1,0]]}));
});
