import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {decodeGameV3} from '../packages/solana-v3/src/decode';
import {projectObserverScene} from '../apps/web/src/v2/projection-v3';
import {pactCityPreview,cityOwnCargo} from '../apps/web/src/v2/city-preview';
import {actionContent,invalidMove} from '../apps/web/src/v2/content';
import {cityPlanning} from '../packages/engine/src/v3-design';
import {designState} from '../apps/web/src/v2/gameplay';
import {cityAssignments,chooseV3AgentMove} from '../packages/engine/src/v3-bots';
import type {Pact,GameView} from '../apps/web/src/v2/model';
const native=await decodeGameV3(await readFile('tests/fixtures/native/v3/program/replay/work-before.bin'));
const original=projectObserverScene(native,'test','local',i=>`seat${i}`,true);
function proposal():Pact{return {maker:0,taker:3,provider:3,kind:3,action:5,delivery:2,gives:[[0,0,1],[0,0,0]],nonce:0,stage:5,status:'open'};}
test('city price warning: actual pre-city stocks can pass gates, but paying 1 cargo leaves them short',()=>{
 const g=structuredClone(original),p=proposal();assert.equal(cityPlanning(designState(g)).normal.cargoShortfall,0);
 const preview=pactCityPreview(g,p)!;assert.equal(preview.normal.cargoShortfall,1);assert.equal(preview.emergency.cargoShortfall,0);assert.equal(preview.emergency.actionShortfall,0);
 assert.deepEqual(g,original);assert.equal(preview.pledgedTotal,2);
});
test('preview agrees before proposal, after maker reserve, and after acceptance; never double reserves',()=>{
 const p=proposal(),before=pactCityPreview(original,p),open=structuredClone(original);open.offers=[p];open.seats[0].reserved[2]=1;
 assert.deepEqual(pactCityPreview(open,p),before);
 const accepted=structuredClone(open);accepted.offers[0].status='accepted';accepted.seats[3].reserved[2]=2;accepted.seats[3].bound=5;
 assert.deepEqual(pactCityPreview(accepted,p),before);
});
test('owned voluntary extra is separate from deferred price and cannot be spent from incoming cargo',()=>{
 const g=structuredClone(original);g.seat=3;g.offers=[{...proposal(),status:'accepted'}];g.seats[0].reserved[2]=1;g.seats[3].reserved[2]=2;g.seats[3].bound=5;
 assert.deepEqual(cityOwnCargo(g,{action:5,route:1,delivery:0}),{pledged:2,total:2,remaining:1});
 assert.ok(invalidMove(g,{action:5,route:1,delivery:1}));
});
test('settled barter is never applied a second time to personal cargo forecast',()=>{
 const g=structuredClone(original);g.seats[0].resources[2]=3;g.offers=[{...proposal(),kind:0,action:0,delivery:0,provider:0,gives:[[1,0,0],[0,0,1]],status:'accepted'}];
 assert.deepEqual(cityOwnCargo(g,{action:5,route:0,delivery:3}),{pledged:0,total:3,remaining:0});
 assert.equal(cityOwnCargo(g,{action:6,route:0,delivery:0}).remaining,4);
});
test('city actions are distinct and available only under protocol3',()=>{
 for(const action of [0,1,5,6])assert.equal(actionContent(5,action,0,3).available,true);
 for(const action of [2,3,4])assert.equal(actionContent(5,action,0,3).available,false);
 for(const action of [5,6])assert.equal(actionContent(5,action,0,2).available,false);
});
test('capacity can use a third guard to survive a low-hull emergency route',()=>{
 const g=structuredClone(original);g.hull=3;g.seats.forEach((s,i)=>{s.resources=[2,0,i===0?4:0];});
 assert.equal(cityPlanning(designState(g)).emergency.possibleFromStocks,true);
});
test('NPC allocation respects a trader cap and pledged-only policy, without assuming human action',()=>{
 const g=structuredClone(original);g.offers=[{...proposal(),delivery:1,gives:[[1,0,0],[0,0,0]],status:'accepted'}];g.seats[0].reserved[0]=1;g.seats[3].reserved[2]=1;g.seats[3].bound=5;
 const s={...designState(g),npcMask:14},p=cityAssignments(s);assert.equal(p.capacity[3],1);assert.equal(p.route,1);assert.equal(chooseV3AgentMove(s,3,5,'trader').delivery,0);
 const unbound={...s,deals:[],players:structuredClone(s.players)};unbound.players[3].reserved[2]=0;
 assert.equal(cityAssignments(unbound).capacity[3],1);assert.ok(chooseV3AgentMove(unbound,3,undefined,'trader').delivery<=1);
});
