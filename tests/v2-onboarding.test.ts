import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createV2State, loadV2Kernel } from '../packages/engine/src/v2';
import { advisoryWorkboard, encounterBrief } from '../packages/engine/src/v2-design';
import { createPracticeController } from '../apps/web/src/v2/practice';
import { usefulPartner, tourGate, receiptDelta, pactHeadline } from '../apps/web/src/v2/gameplay';
await loadV2Kernel(new Uint8Array(await readFile('apps/web/public/engine/rules-v2.wasm')).buffer);

test('first lesson follows the addressed maker and waits for actual acceptance, reservation and work',async()=>{
 const c=await createPracticeController();try{
  let g=c.snapshot();assert.equal(usefulPartner(g),2);assert.equal(tourGate('deal',g,2),false);
  assert.equal(tourGate('reserve',g,2),false);assert.equal(tourGate('resolve',g,2),false);
  const p=g.offers[0];assert.equal((await c.accept({...p,nonce:p.nonce+1})).ok,false);
  assert.equal(tourGate('deal',c.snapshot(),2),false,'failed operation cannot unlock learning');
  assert.equal((await c.accept(p)).ok,true);g=c.snapshot();
  assert.equal(tourGate('deal',g,0),true);assert.equal(tourGate('reserve',g,0),true);
  assert.equal(tourGate('action',g,0),false);assert.equal(tourGate('action',g,2),true);
  assert.equal(tourGate('resolve',g,2),false);
  assert.equal((await c.planReady({action:2,route:0,delivery:0})).ok,true);g=c.snapshot();
  assert.equal(g.stage,1);assert.equal(tourGate('resolve',g,2),true);assert.equal(tourGate('receipt',g,2),true);
  assert.equal(g.history[0].inputs![0][0],2);assert.equal(g.history[0].outputs![0][0],7);
  assert.equal(g.seats[0].resources[0],7,'share, gathering and drinking are separate');
  assert.deepEqual(receiptDelta(g,g.history[0]),[4,0,0]);
 }finally{c.dispose();}
});
test('city advice trades for cargo and never claims that a guard contract binds delivery',()=>{
 const s=createV2State();s.stage=5;s.players[0].resources=[5,0,0];s.players[1].resources=[2,1,3];
 const a=advisoryWorkboard(s),p=a.partners.find(p=>p.seat===1)!;
 assert.deepEqual(p.suggestions[0].gives,[[1,0,0],[0,0,1]]);assert.equal(p.suggestions[0].kind,0);
 assert.match(p.suggestions[0].reason[1],/does not promise a gate contribution/);
 assert.ok(!p.suggestions.some(p=>p.kind===1&&p.action===2),'water gathering is not sold as a city objective');
 assert.equal(a.guaranteed,0);assert.equal(encounterBrief(s).commitment.meaning,'delivery-is-not-bound');
});
test('briefing carries forward real bridge capacity and exposes known obligations without predicting secrets',()=>{
 for(const n of [4,5,6]){
  const s=createV2State(n);s.stage=1;const b=encounterBrief(s);assert.equal(b.commitment.required,Math.ceil(n/2));
  assert.equal(b.commitment.bound,0);assert.equal(b.commitment.hiddenPlans,true);
  s.stage=2;s.flags=2;assert.equal(advisoryWorkboard(s).extraction?.slots,2);
  s.flags=0;assert.equal(advisoryWorkboard(s).extraction?.slots,1);
  s.stage=4;assert.match(encounterBrief(s).choices[0][1],new RegExp(`${Math.ceil(n/3)} jobs`));
  assert.equal(encounterBrief(s).authority,'advisory-only');
  assert.equal(encounterBrief({...s,phase:5,arrived:true}).status,'archive');
  assert.match(encounterBrief({...s,phase:5,arrived:true}).situation[1],/caravan arrived/);
 }
});
test('outcome deltas use the actual seat inventory profile rather than assuming every player started with water3',async()=>{
 const c=await createPracticeController();try{
  await c.planReady({action:2,route:1,delivery:0});const g={...c.snapshot(),seat:2},r=g.history[0];
  assert.deepEqual(receiptDelta(g,r),r.resources[2].map((n,i)=>n-[0,2,0][i]));
 }finally{c.dispose();}
});
test('headlines do not misname the provider or omit split recipe inputs',async()=>{
 const c=await createPracticeController();try{
  const g=c.snapshot(),p={...g.offers[0],maker:0,taker:2,provider:0,gives:[[1,1,0],[1,0,0]] as [[number,number,number],[number,number,number]]};
  assert.match(pactHeadline(p,g)[1],/combine supplies/);assert.doesNotMatch(pactHeadline(p,g)[1],/Your 1 water/);
  assert.match(pactHeadline({...p,kind:1,action:3},g)[1],/Accept a repair job/);
 }finally{c.dispose();}
});
test('unrelated executed work cannot stand in for the guided player project',async()=>{
 const c=await createPracticeController();try{
  await c.accept(c.snapshot().offers[0]);await c.planReady({action:2,route:0,delivery:0});
  const g=structuredClone(c.snapshot());g.history[0].work=[{provider:1,action:3,executed:true}];
  assert.equal(tourGate('resolve',g,2),false);
 }finally{c.dispose();}
});
