import assert from 'node:assert/strict';import {test}from'node:test';
import {createV2State}from'../packages/engine/src/v2';
import {advisoryWorkboard,v2Rejection,v2BridgeOpen,v2ProductionSlots}from'../packages/engine/src/v2-design';
import{chooseV2AgentMove,v2AgentOffers,v2AgentAccepts}from'../packages/engine/src/v2-bots';
import {v2RepairSeats}from'../packages/engine/src/v2-bots';
test('well advice identifies a complementary provider and explains an actual split with opportunity cost',()=>{
 const s=createV2State();const a=advisoryWorkboard(s);const builder=a.partners.find(p=>p.seat===2)!;
 assert.deepEqual(a.missing,[0,1,0]);assert.ok(builder.suppliesMissing[1]>0);
 const project=builder.suggestions.find(s=>s.kind===2)!;assert.deepEqual(project.gives,[[2,0,0],[0,1,0]]);assert.equal(project.provider,2);
 assert.match(project.reason[1],/4 water/);assert.match(project.opportunityCost[1],/gives up another action/);assert.equal(a.authority,'advisory-only');
 const barter=builder.suggestions.find(s=>s.kind===0)!;assert.match(barter.reason[1],/own action/);assert.match(barter.opportunityCost[1],/does not bind/);
});
test('bridge and well flags cannot silently exchange extraction capacity',()=>{
 for(const flags of[0,1,2,3]){const s=createV2State();s.stage=2;s.flags=flags;const a=advisoryWorkboard(s);assert.equal(v2BridgeOpen(flags),!!(flags&2));assert.equal(v2ProductionSlots(flags),flags&2?2:1);assert.equal(a.threshold,flags&2?2:1);}
});
test('only accepted formal work counts as guaranteed; unused promises do not',()=>{
 const s=createV2State();s.stage=1;const offered=v2AgentOffers(s,2,0,'builder')[0];const noPact=advisoryWorkboard({...s,offers:[{...offered,status:1}]});assert.equal(noPact.guaranteed,0);
 const withPact=advisoryWorkboard({...s,deals:[offered]});assert.equal(withPact.guaranteed,1);assert.equal(withPact.remaining,1);
});
test('explanation scope rejects fake seats; busy partner never advertised as available',()=>{
 const s=createV2State();assert.throws(()=>advisoryWorkboard(s,9));const players=s.players.map((p,i)=>({...p,seal:i!==2,reserved:[0,i===2?1:0,0]}));
 const p=advisoryWorkboard({...s,players}).partners.find(p=>p.seat===2)!;assert.equal(p.available,false);assert.match(p.unavailableReason![1],/occupied/);assert.deepEqual(p.free,[0,1,0]);
});
test('rejection meaning agrees with native code categories',()=>{
 assert.match(v2Rejection(1)[1],/unavailable/);assert.match(v2Rejection(2)[1],/lacked/);assert.match(v2Rejection(3)[1],/slots/);assert.match(v2Rejection(4)[1],/cap/);
});
test('different public NPC interests produce distinct offers and prices without private move input',()=>{
 const s=createV2State();const builder=v2AgentOffers(s,2,0,'builder')[0],supplier=v2AgentOffers(s,1,0,'supplier')[0];
 assert.equal(builder.kind,2);assert.equal(supplier.kind,0);assert.notDeepEqual(builder.gives,supplier.gives);
 s.stage=3;s.players[0].resources[0]=3;const a=v2AgentOffers(s,1,0,'supplier')[0],b=v2AgentOffers(s,3,0,'trader')[0];assert.equal(a.gives[1][0],1);assert.equal(b.gives[1][0],2);
 assert.equal(v2AgentAccepts({...b,maker:0,taker:3,provider:3,gives:[[1,0,0],[0,0,0]]},s.players[3],'trader',s),false,'trader refuses low guard payment');
});
test('low hull changes agent priority; trader delivery preserves a personal interest',()=>{
 const s=createV2State();s.stage=3;for(const p of s.players)p.resources=[5,2,3];
 const healthy=chooseV2AgentMove(s,2,undefined,'builder');s.hull=2;const critical=chooseV2AgentMove(s,2,undefined,'builder');assert.notEqual(healthy.action,critical.action);assert.equal(critical.action,3);
 s.stage=5;s.hull=10;const trader=chooseV2AgentMove(s,3,undefined,'trader'),builder=chooseV2AgentMove(s,2,undefined,'builder');assert.ok(trader.delivery<builder.delivery);assert.ok(trader.delivery>0);
});
test('public repair allocation keeps a tool for extraction instead of every NPC repairing the bridge',()=>{
 const s=createV2State();s.stage=1;for(const p of s.players)p.resources[0]=5;
 assert.deepEqual(v2RepairSeats(s),[2]);
 const plans=s.players.map((_,i)=>chooseV2AgentMove(s,i));assert.equal(plans[3].action,2);assert.equal(plans.filter(p=>p.action===3).length,1);
 const contract={active:true,kind:1,maker:0,taker:2,provider:2,action:3,delivery:0,job:255,gives:[[1,0,0],[0,0,0]]} as const;
 const complete={...s,deals:[{...contract,gives:[[1,0,0],[0,0,0]]} as any,{...contract,provider:1} as any]};
 assert.ok(!v2AgentOffers(complete,3,0,'trader').some(p=>p.kind===1&&p.action===3));
});
