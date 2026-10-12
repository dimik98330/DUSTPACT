import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {loadV2Kernel,createV2State,advanceV2State,resolveV2,v2Input,applyV2Barter} from '../packages/engine/src/v2';
import {v2ExtractionBudget,encounterBrief} from '../packages/engine/src/v2-design';
import {createPracticeController} from '../apps/web/src/v2/practice';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import OutcomeCard from '../apps/web/src/v2/OutcomeCard';
import {designState} from '../apps/web/src/v2/gameplay';
await loadV2Kernel(Uint8Array.from(await readFile('apps/web/public/engine/rules-v2.wasm')).buffer);
async function atBridge(){const c=await createPracticeController(4),offer=c.snapshot().offers.find(p=>p.status==='open'&&p.taker===0)!;assert.equal((await c.accept(offer)).ok,true);assert.equal((await c.planReady({action:2,route:0,delivery:0})).ok,true);return c;}
test('Buying bridge work changes the provider action and opens a second extraction slot',async()=>{
 const trust=await atBridge(),bound=await atBridge();
 const order=bound.snapshot().offers.find(p=>p.status==='open'&&p.taker===0)!;assert.equal(order.kind,1);assert.equal(order.provider,1);assert.equal((await bound.accept(order)).ok,true);
 for(const c of[trust,bound])assert.equal((await c.planReady({action:2,route:0,delivery:0})).ok,true);
 assert.equal(trust.snapshot().history[1].actions[1],2,'supplier keeps its tool without an order');
 assert.equal(bound.snapshot().history[1].actions[1],3,'accepted order consumes the tool and binds repair');
 assert.equal(trust.snapshot().bridgeOpen,false);assert.equal(bound.snapshot().bridgeOpen,true);
 assert.equal(bound.snapshot().history[1].work?.some(w=>w.provider===1&&w.action===3&&w.executed),true);
 for(const c of[trust,bound])c.dispose();
});
test('An open bridge does not promise two projects after the guided well has spent a kit',async()=>{
 const c=await atBridge();let g=c.snapshot();assert.match(encounterBrief(designState(g)).situation[1],/leave 1/);
 await c.accept(g.offers.find(p=>p.status==='open'&&p.taker===0)!);await c.planReady({action:2,route:0,delivery:0});g=c.snapshot();
 const budget=v2ExtractionBudget(2,g.seats);assert.equal(budget.slots,2);assert.equal(budget.tools,1);assert.equal(budget.stockedLimit,1);assert.equal(budget.basis,'current-total-stock');assert.match(encounterBrief(designState(g)).situation[1],/at most 1 project/);c.dispose();
});
test('Preserving the well kit lets a repaired bridge support two real extractions after redistribution',async()=>{
 let s=createV2State(4);const forage={action:2,route:1,delivery:0};s=advanceV2State(s,await resolveV2(v2Input(s,Array(4).fill(forage))));
 s=advanceV2State(s,await resolveV2(v2Input(s,[{action:2,route:0,delivery:0},{action:3,route:0,delivery:0},{action:3,route:0,delivery:0},{action:2,route:0,delivery:0}])));
 const budget=v2ExtractionBudget(s.flags,s.players);assert.equal(budget.slots,2);assert.equal(budget.tools,2);assert.equal(budget.stockedLimit,2);
 assert.equal(s.players.filter(p=>p.resources[0]>=1&&p.resources[1]>=1).length,1,'the stock bound does not guarantee input distribution');
 s.players=await applyV2Barter(s.players,0,2,[[1,0,0],[0,1,0]]);
 const r=await resolveV2(v2Input(s,[{action:4,route:0,delivery:0},{action:1,route:0,delivery:0},{action:1,route:0,delivery:0},{action:4,route:0,delivery:0}]));assert.equal(r.players.reduce((n,p)=>n+p.resources[2],0),12);
});
test('Buying a toolkit and doing the work personally is a distinct legal bridge alternative',async()=>{
 const c=await atBridge(),g=c.snapshot();
 assert.equal((await c.offer({maker:0,taker:3,provider:0,kind:0,action:0,delivery:0,gives:[[3,0,0],[0,1,0]],nonce:g.seats[0].offerNonce!,stage:1})).ok,true);
 assert.equal(c.snapshot().seats[0].resources[1],1);assert.equal(c.snapshot().seats[0].bound,null);
 assert.equal((await c.planReady({action:3,route:0,delivery:0})).ok,true);
 const end=c.snapshot();assert.equal(end.bridgeOpen,true);assert.equal(end.history[1].actions[0],3);assert.equal(end.history[1].inputs?.[0][1],1);assert.equal(end.seats[0].support,2);
 const text=renderToStaticMarkup(createElement(OutcomeCard,{game:end,receipt:end.history[1],language:'ru',open:true})).replace(/<[^>]*>/g,'');assert.match(text,/Мой вклад за встречу: \+2/);c.dispose();
});
