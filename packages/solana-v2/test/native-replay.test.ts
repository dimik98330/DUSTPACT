import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {decodeGameV2} from '../src/decode';
import {loadV2Kernel,createV2State,resolveV2,applyV2Barter,type V2Deal} from '../../engine/src/v2';

for(const count of [4,5,6])test(`Rust SBF N${count} six-stage receipts reproduce through the browser Wasm kernel`,async()=>{
 await loadV2Kernel(new Uint8Array(await readFile(new URL('../../../apps/web/public/engine/rules-v2.wasm',import.meta.url))));
 const g=await decodeGameV2(new Uint8Array(await readFile(new URL(`../../../tests/fixtures/native/v2/program/replay/v2-native-n${count}.bin`,import.meta.url))));
 let state=createV2State(count);
 for(let stage=0;stage<6;stage++){
  const h=g.history[stage],deals:V2Deal[]=h.deals.slice(0,h.dealCount).map(d=>({active:true,kind:d.kind,maker:d.maker,taker:d.taker,provider:d.provider,action:d.action,delivery:d.delivery,job:d.jobSlot,gives:structuredClone(d.gives)}));
  for(const d of deals.filter(d=>d.kind===0))state.players=await applyV2Barter(state.players,d.maker,d.taker,d.gives);
  const result=await resolveV2({count,stage,hull:state.hull,flags:state.flags,players:state.players,moves:h.actions.slice(0,count).map((action,i)=>({action,route:h.routes[i],delivery:h.deliveries[i]})),missing:h.missing,deals});
  assert.equal(result.hull,h.hull,`stage ${stage} hull`);assert.equal(result.flags,h.flags);assert.equal(result.route,h.route);assert.equal(result.threat,h.threat);assert.equal(result.guard,h.guard);assert.equal(result.objective,h.objective);
  assert.deepEqual(result.inputs,h.inputs.slice(0,count));assert.deepEqual(result.outputs,h.outputs.slice(0,count));assert.deepEqual(result.rejected,h.rejected.slice(0,count));assert.deepEqual(result.actions,h.actions.slice(0,count));assert.deepEqual(result.deliveries,h.deliveries.slice(0,count));
  assert.deepEqual(result.players.map(p=>p.resources),h.resources.slice(0,count));assert.deepEqual(result.players.map(p=>p.support),h.support.slice(0,count));assert.deepEqual(result.players.map(p=>p.delivered),h.delivered.slice(0,count));assert.equal(result.players.reduce((mask,p,i)=>mask|(p.forfeited?1<<i:0),0),h.forfeited);
  state={...state,players:result.players,hull:result.hull,flags:result.flags};if(stage===5){assert.equal(result.arrived,g.arrived);assert.deepEqual(result.scores,g.scores.slice(0,count));}
 }
});

test('Untrusted complete history cannot substitute masks, routes, resource bounds, deal count or revision',async()=>{
 const source=new Uint8Array(await readFile(new URL('../../../tests/fixtures/native/v2/program/replay/v2-native-n4.bin',import.meta.url)));
 // Canonical Anchor/Borsh layout of the public native fixture: six fixed 411-byte summaries.
 const history=1421,summaryBytes=411;
 for(const [offset,value] of [[history+2,2],[history+31,128],[history+110,201],[history+285,4],[history+summaryBytes+403,0]] as const){const bad=source.slice();bad[offset]=value;if(offset===history+summaryBytes+403)bad.fill(0,offset,offset+8);await assert.rejects(decodeGameV2(bad));}
});
