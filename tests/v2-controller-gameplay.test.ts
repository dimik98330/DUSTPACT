import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { address, generateKeyPairSigner } from "@solana/kit";
import { createV2State, advanceV2State, loadV2Kernel, resolveV2, v2Input, type V2Deal } from "../packages/engine/src/v2";
import { v2BridgeOpen, v2Rejection } from "../packages/engine/src/v2-design";
import { createPracticeController } from "../apps/web/src/v2/practice";
import { OnlineController, projectReceipt } from "../apps/web/src/v2/online";
import { receiptKey } from "../apps/web/src/v2/model";
import { stageContent } from "../apps/web/src/v2/content";
import { matchAddress, prepareMove, PROGRAM_V2, RULES_HASH, CONTENT_HASH, type GameV2, type Summary, type V2Client, type Mission } from "../packages/solana-v2/src/index";

await loadV2Kernel(new Uint8Array(await readFile("apps/web/public/engine/rules-v2.wasm")).buffer);
const emptyBundle=()=>[0,0,0] as [number,number,number];
const offers=()=>Array.from({length:6},()=>({status:0,kind:0,maker:0,taker:0,provider:0,action:0,delivery:0,nonce:0,stage:0,gives:[emptyBundle(),emptyBundle()] as [[number,number,number],[number,number,number]],reserve:[emptyBundle(),emptyBundle()] as [[number,number,number],[number,number,number]],jobSlot:255}));
const emptySummary=():Summary=>({complete:false,hull:0,route:0,threat:0,guard:0,objective:false,flags:0,actions:Array(6).fill(0),routes:Array(6).fill(0),deliveries:Array(6).fill(0),missing:0,rejected:Array(6).fill(0),inputs:Array.from({length:6},emptyBundle),outputs:Array.from({length:6},emptyBundle),resources:Array.from({length:6},emptyBundle),support:Array(6).fill(0),delivered:Array(6).fill(0),forfeited:0,deals:offers().slice(0,3),dealCount:0,jobs:Array.from({length:3},()=>({slot:255,provider:255,nonce:0,executed:false,owner:address("11111111111111111111111111111111")})),revision:0n});
async function fixture(){
  const owners=await Promise.all(Array.from({length:6},()=>generateKeyPairSigner()));
  const nonce=crypto.getRandomValues(new Uint8Array(16)),[match,bump]=await matchAddress(owners[0].address,nonce),s=createV2State();
  const g:GameV2={creator:owners[0].address,nonce,bump,rulesHash:Uint8Array.from(RULES_HASH),contentHash:Uint8Array.from(CONTENT_HASH),count:4,phase:1,stage:0,hull:12,deadline:190n,revision:1n,roster:3,npcMask:0,eligibleMask:0,mission:address("11111111111111111111111111111111"),missionRoster:3,flags:0,seats:owners.map((owner,i)=>({owner:owner.address,session:address("11111111111111111111111111111111"),expires:0n,epoch:0,quota:0,actionNonce:0n,offerNonce:0,ready:true,planningReady:false,resources:s.players[i]?.resources??emptyBundle(),reserved:emptyBundle(),support:0,delivered:0,forfeited:false,seal:true,bound:255,offerCount:0})),offers:offers(),deals:offers().slice(0,3),dealCount:0,commitments:Array.from({length:6},()=>new Uint8Array(32)),committed:0,revealed:0,actions:Array(6).fill(0),routes:Array(6).fill(0),deliveries:Array(6).fill(0),history:Array.from({length:6},emptySummary),scores:Array(6).fill(0),arrived:false};
  return {g,match,owner:owners[0]};
}
const memoryStorage=()=>{const map=new Map<string,string>();return {getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>map.set(k,v),removeItem:(k:string)=>map.delete(k),clear:()=>map.clear(),key:(i:number)=>[...map.keys()][i]??null,get length(){return map.size;}};};
async function unitController(){
  const f=await fixture();let signed=0;
  // Transport spy: these tests exercise controller review only, not native RPC or wallets.
  const owner={signer:f.owner,chainNow:()=>100,seat:()=>0,read:async()=>structuredClone(f.g),readFinalized:async()=>structuredClone(f.g),readVault:async()=>null,readVaultFinalized:async()=>null,commit:async()=>{signed++;},cancelPendingSignatures:()=>{}} as unknown as V2Client;
  const c=new OnlineController(owner,f.match,"local",[],{}),internal=c as any;
  internal.game=f.g;internal.genesis="local-unit-genesis";internal.pump=async()=>{};internal.publish();
  Object.defineProperty(globalThis,"localStorage",{configurable:true,value:memoryStorage()});
  return {...f,c,internal,signed:()=>signed};
}
function envelope(f:Awaited<ReturnType<typeof unitController>>,p:Awaited<ReturnType<typeof prepareMove>>){return JSON.stringify({version:2,program:PROGRAM_V2,genesis:"local-unit-genesis",match:f.match,seat:0,owner:p.owner,stage:p.stage,action:p.action,route:p.route,delivery:p.delivery,salt:Array.from(p.salt),commitment:Array.from(p.commitment)});}

test("one initial builder proposal reserves only its maker; other partners remain negotiable",async()=>{
  const c=await createPracticeController(),g=c.snapshot(),open=g.offers.filter(p=>p.status==="open");
  assert.equal(open.length,1);assert.equal(open[0].maker,2);assert.equal(open[0].kind,2);
  assert.deepEqual(g.seats[2].reserved,[0,1,0]);assert.equal(g.seats[2].seal,false);
  for(const seat of [0,1,3]){assert.equal(g.seats[seat].seal,true);assert.deepEqual(g.seats[seat].reserved,[0,0,0]);}c.dispose();
});
test("acceptance excludes the already-held maker reservation and retains exact contract inputs",async()=>{
  const c=await createPracticeController(),p=c.snapshot().offers[0];assert.equal((await c.accept(p)).ok,true);
  const g=c.snapshot();assert.deepEqual(g.seats[0].reserved,[2,0,0]);assert.deepEqual(g.seats[2].reserved,[0,1,0]);assert.equal(g.seats[2].bound,3);
  assert.equal((await c.planReady({action:2,route:0,delivery:0})).ok,true);const r=c.snapshot().history[0];
  assert.equal(c.snapshot().bridgeOpen,false,"well flag is not the bridge flag");assert.deepEqual(r.inputs?.[0],[2,0,0]);assert.equal(r.outputs?.[0][0],7);assert.equal(r.outputs?.[2][0],4);assert.equal(r.pacts?.[0].kind,2);assert.equal(r.work?.[0].executed,true);c.dispose();
});
test("accepting a human pact does not invent expiry of an unrelated open proposal",async()=>{
  const c=await createPracticeController(),internal=c as any,p=c.snapshot().offers[0];
  await internal.addOpen({active:true,kind:0,maker:3,taker:1,provider:3,action:0,delivery:0,job:255,gives:[[0,1,0],[1,0,0]]});
  assert.equal((await c.accept(p)).ok,true);const unrelated=c.snapshot().offers.find(p=>p.maker===3)!;
  assert.equal(unrelated.status,"open");assert.equal(c.snapshot().seats[3].seal,false);assert.deepEqual(c.snapshot().seats[3].reserved,[0,1,0]);c.dispose();
});
test("cancelling an open proposal releases the exact maker reservation",async()=>{
  const c=await createPracticeController();await (c as any).addOpen({active:true,kind:0,maker:0,taker:1,provider:0,action:0,delivery:0,job:255,gives:[[1,0,0],[0,1,0]]});
  assert.deepEqual(c.snapshot().seats[0].reserved,[1,0,0]);assert.equal((await c.cancel()).ok,true);assert.equal(c.snapshot().seats[0].seal,true);assert.deepEqual(c.snapshot().seats[0].reserved,[0,0,0]);c.dispose();
});
test("missing-input and unavailable-action receipts retain the canonical reason",async()=>{
  const a=await createPracticeController();await a.planReady({action:3,route:0,delivery:0});assert.match(a.snapshot().history[0].reasons[0],/Не хватило/);assert.doesNotMatch(a.snapshot().history[0].reasons[0],/места добычи/);a.dispose();
  const b=await createPracticeController();await b.planReady({action:4,route:0,delivery:0});assert.match(b.snapshot().history[0].reasons[0],/недоступно/);b.dispose();
  assert.match(v2Rejection(3)[1],/slots/);assert.match(v2Rejection(4)[1],/cap/);
});
test("route descriptors expose actual ambush threat and no fake storm choice",async()=>{
  const c=await createPracticeController(),g=c.snapshot();const storm=stageContent({...g,stage:4}),ambush=stageContent({...g,stage:3});
  assert.equal(storm.routeRelevant,false);assert.match(ambush.alternatives[1][1],/threat 8/);assert.match(ambush.alternatives[1][1],/no additional reward/);
  assert.deepEqual([0,1,2,3].map(v2BridgeOpen),[false,false,true,true]);c.dispose();
});
test("controller rejects a displayed choice different from prepared choice before signing",async()=>{
  const f=await unitController();f.g.phase=2;f.internal.prepared=await prepareMove(f.match,f.g,0,{action:1,route:0,delivery:0});f.internal.preparedStatus="verified";
  const result=await f.c.commit({action:2,route:0,delivery:0});assert.equal(result.ok,false);assert.match(result.error!,/Displayed choice differs/);assert.equal(f.signed(),0);f.c.dispose();
});
test("restoring a verified Guard copy shows Guard, never a default Forage",async()=>{
  const f=await unitController(),p=await prepareMove(f.match,f.g,0,{action:1,route:0,delivery:0});
  localStorage.setItem(f.internal.moveKey(),envelope(f,p));await f.internal.restoreMove();
  assert.equal(f.c.snapshot().preparedStatus,"verified");assert.deepEqual(f.c.snapshot().preparedChoice,{action:1,route:0,delivery:0});assert.equal(f.signed(),0);f.c.dispose();
});
test("move verification tolerates a new polling object with unchanged canonical bindings",async()=>{
  const f=await unitController(),p=await prepareMove(f.match,f.g,0,{action:1,route:0,delivery:0});
  const pending=f.internal.checkMove(envelope(f,p));f.internal.game=structuredClone(f.g);assert.equal((await pending).action,1);f.c.dispose();
});
test("changed bound work or committed hash rejects a previously valid copy",async()=>{
  const f=await unitController(),p=await prepareMove(f.match,f.g,0,{action:1,route:0,delivery:0});
  const pending=f.internal.checkMove(envelope(f,p));f.internal.game=structuredClone(f.g);f.internal.game.seats[0].bound=3;await assert.rejects(pending,/Context changed/);
  f.internal.game=structuredClone(f.g);f.internal.game.committed=1;f.internal.game.commitments[0]=crypto.getRandomValues(new Uint8Array(32));await assert.rejects(f.internal.checkMove(envelope(f,p)),/does not match/);assert.equal(f.signed(),0);f.c.dispose();
});

for(const method of ['offer','accept','cancel'] as const)test(`refused ${method} preserves the approved private copy and stops automatic submission`,async()=>{
 const f=await unitController(),p=await prepareMove(f.match,f.g,0,{action:2,route:0,delivery:0});
 f.g.seats[0].planningReady=true;f.internal.prepared=p;f.internal.preparedStatus='verified';f.internal.persistMove(p);f.internal.plannedStage=0;
 const maker=method==='accept'?1:0;
 f.g.offers[maker]={...f.g.offers[maker],status:1,kind:0,maker,taker:maker===0?1:0,provider:maker,stage:0,gives:[[1,0,0],[0,1,0]],reserve:[[1,0,0],[0,1,0]]};
 const client=f.internal.owner;let calls=0;client[method]=async()=>{calls++;throw Error('signature declined');};f.internal.publish();
 const expected=f.c.exportMove(),key=f.internal.moveKey();
 const result=method==='offer'?await f.c.offer({maker:0,taker:1,provider:0,kind:0,action:0,delivery:0,gives:[[1,0,0],[0,1,0]],nonce:0,stage:0}):method==='accept'?await f.c.accept(f.internal.pact(f.g.offers[1])):await f.c.cancel();
 assert.equal(result.ok,false);assert.match(result.error!,/signature declined/);assert.equal(calls,1);
 assert.equal(f.c.exportMove(),expected);assert.equal(localStorage.getItem(key),expected);assert.equal(f.c.snapshot().preparedStatus,'verified');assert.equal(f.c.snapshot().seats[0].ready,true);
 assert.equal(f.internal.plannedStage,-1);assert.equal(f.c.snapshot().automaticPlanApproved,false);f.c.dispose();
});

test('a phase race before a pact request never deletes the matching committed preimage',async()=>{
 const f=await unitController(),p=await prepareMove(f.match,f.g,0,{action:2,route:0,delivery:0});f.internal.prepared=p;f.internal.preparedStatus='verified';f.internal.persistMove(p);f.internal.plannedStage=0;
 let release!:()=>void,called=0;f.internal.pumpFlight=new Promise<void>(r=>{release=r;});f.internal.owner.offer=async()=>{called++;};
 const expected=f.c.exportMove(),result=f.c.offer({maker:0,taker:1,provider:0,kind:0,action:0,delivery:0,gives:[[1,0,0],[0,1,0]],nonce:0,stage:0});
 f.g.phase=3;f.g.committed=1;f.g.commitments[0]=Uint8Array.from(p.commitment);release();
 assert.equal((await result).ok,false);assert.equal(called,0);assert.equal(f.c.exportMove(),expected);assert.equal(localStorage.getItem(f.internal.moveKey()),expected);assert.equal(f.internal.plannedStage,-1);f.c.dispose();
});

test('accepted incompatible work invalidates signing but retains an exportable original backup across reload',async()=>{
 const f=await unitController();f.g.stage=1;const p=await prepareMove(f.match,f.g,0,{action:2,route:0,delivery:0});f.internal.prepared=p;f.internal.preparedStatus='verified';f.internal.persistMove(p);f.internal.plannedStage=1;
 f.g.offers[1]={...f.g.offers[1],status:1,kind:1,maker:1,taker:0,provider:0,stage:1,action:3,gives:[[0,1,0],[0,0,0]],reserve:[[0,1,0],[0,0,0]]};f.internal.publish();const expected=f.c.exportMove();
 f.internal.owner.accept=async()=>{f.g.seats[0].bound=3;f.g.seats[0].planningReady=false;f.g.offers[1].status=2;};
 assert.equal((await f.c.accept(f.internal.pact(f.g.offers[1]))).ok,true);
 assert.equal(f.c.snapshot().preparedStatus,'invalid');assert.equal(f.c.snapshot().preparedChoice,undefined);assert.equal(f.c.exportMove(),expected);assert.equal(localStorage.getItem(f.internal.moveKey()),expected);
 await f.internal.restoreMove();assert.equal(f.c.snapshot().preparedStatus,'invalid');assert.equal(f.c.exportMove(),expected);
 f.g.phase=3;f.g.committed=1;f.g.commitments[0]=Uint8Array.from(p.commitment);
 assert.equal((await f.c.reveal()).ok,false,'bound mismatch is not usable even when old bytes match the commitment');f.c.dispose();
});

test('compatible resubmission reuses the original salt and a refused replacement preserves the prior copy',async()=>{
 const f=await unitController(),p=await prepareMove(f.match,f.g,0,{action:2,route:0,delivery:0});f.internal.prepared=p;f.internal.preparedStatus='verified';f.internal.persistMove(p);
 const oldCopy=f.c.exportMove();f.internal.owner.stageReady=async()=>{};
 assert.equal((await f.c.planReady({action:2,route:0,delivery:0})).ok,true);assert.equal(f.c.exportMove(),oldCopy);
 f.internal.owner.stageReady=async()=>{throw Error('replacement declined');};
 assert.equal((await f.c.planReady({action:1,route:0,delivery:0})).ok,false);assert.equal(localStorage.getItem(f.internal.moveKey()+':previous'),oldCopy);
 // A matching confirmed commitment wins over the newer unsigned draft on reload.
 f.g.phase=3;f.g.committed=1;f.g.commitments[0]=Uint8Array.from(p.commitment);await f.internal.read();await f.internal.restoreMove();
 assert.equal(f.c.snapshot().preparedStatus,'verified');assert.deepEqual(f.c.snapshot().preparedChoice,{action:2,route:0,delivery:0});assert.equal(f.c.exportMove(),oldCopy);f.c.dispose();
});

test('a corrupt primary copy cannot silently select a previous uncommitted draft',async()=>{
 const f=await unitController(),p=await prepareMove(f.match,f.g,0,{action:2,route:0,delivery:0});localStorage.setItem(f.internal.moveKey(),'bad json');localStorage.setItem(f.internal.moveKey()+':previous',envelope(f,p));
 await f.internal.restoreMove();assert.equal(f.c.snapshot().preparedStatus,'invalid');assert.equal(f.c.snapshot().preparedChoice,undefined);assert.equal(f.c.exportMove(),envelope(f,p));assert.equal(f.signed(),0);f.c.dispose();
});
test("corrupt stored copy exposes invalid status without revealing or inventing a move",async()=>{
  const f=await unitController();localStorage.setItem(f.internal.moveKey(),"not JSON");await f.internal.restoreMove();assert.equal(f.c.snapshot().preparedStatus,"invalid");assert.equal(f.c.snapshot().preparedChoice,undefined);assert.equal(f.signed(),0);f.c.dispose();
});
test("native receipt projection keeps canonical inputs/outputs/pacts and stable settlement identity",async()=>{
  const f=await fixture(),s=createV2State(),deal:V2Deal={active:true,kind:2,maker:0,taker:2,provider:2,action:3,delivery:0,job:255,gives:[[2,0,0],[0,1,0]]};
  const r=await resolveV2(v2Input(s,s.players.map(()=>({action:2,route:0,delivery:0})),[deal]));
  const h:Summary={...emptySummary(),complete:true,hull:r.hull,route:r.route,threat:r.threat,guard:r.guard,objective:r.objective,flags:r.flags,actions:r.actions,deliveries:r.deliveries,rejected:r.rejected,inputs:r.inputs,outputs:r.outputs,resources:[...r.players.map(p=>p.resources),emptyBundle(),emptyBundle()],support:[...r.players.map(p=>p.support),0,0],delivered:[...r.players.map(p=>p.delivered),0,0],revision:9n,dealCount:1};
  h.deals[0]={...h.deals[0],...deal,status:2,stage:0,nonce:0,jobSlot:255};f.g.history[0]=h;
  const a=projectReceipt(f.g,h,0,i=>`Seat ${i+1}`,structuredClone(h));assert.equal(a.proof,"finalized");assert.deepEqual(a.inputs?.[0],[2,0,0]);assert.equal(a.outputs?.[0][0],7);assert.equal(a.pacts?.[0].provider,2);assert.equal(a.work?.[0].executed,true);assert.equal(a.progress,1);assert.equal(a.goal,1);
  f.g.revision=999n;const b=projectReceipt(f.g,h,0,i=>`Seat ${i+1}`);assert.equal(receiptKey(f.match,a),receiptKey(f.match,b));assert.equal(b.proof,"confirmed");
});
for(const count of [4,5,6])test(`purposeful practice pacts and guarding complete all six encounters N=${count}`,async()=>{
  const c=await createPracticeController(count);
  while(c.snapshot().phase!==5){let g=c.snapshot();const proposal=g.offers.find(p=>p.status==="open"&&p.taker===0);
    if(proposal&&g.stage<4)assert.equal((await c.accept(proposal)).ok,true);
    g=c.snapshot();const move={action:g.stage===3||g.stage===5?1:2,route:0,delivery:g.stage===5?Math.min(5,g.seats[0].resources[2]):0};
    assert.equal((await c.planReady(move)).ok,true);
  }
  const g=c.snapshot();assert.equal(g.arrived,true);assert.equal(g.history.length,6);
  assert.equal(g.history[1].route,count===4?0:1,"a single bought repair cannot promise the whole bridge for larger parties");assert.equal(v2BridgeOpen(g.history[1].flags!),count===4);
  assert.ok(g.history[2].inputs?.some(b=>b[0]>0||b[1]>0));assert.ok(g.history[5].deliveries!.reduce((a,b)=>a+b,0)>0);
  assert.equal(g.history[0].pacts?.[0].kind,2);assert.equal(g.history[3].pacts?.some(p=>p.action===1),true);c.dispose();
});
test("a human operation waits for an agent flight rather than failing as busy",async()=>{
  const f=await unitController();f.g.phase=2;const move={action:1,route:0,delivery:0};f.internal.prepared=await prepareMove(f.match,f.g,0,move);
  let release!:()=>void;f.internal.pumpFlight=new Promise<void>(resolve=>release=resolve);const pending=f.c.commit(move);
  assert.equal(f.signed(),0);assert.equal(f.internal.busy,true);release();assert.equal((await pending).ok,true);assert.equal(f.signed(),1);f.c.dispose();
});
test("a queued operation cannot cross a phase change or closed controller",async()=>{
  const f=await unitController();f.g.phase=2;let release!:()=>void;f.internal.pumpFlight=new Promise<void>(resolve=>release=resolve);const pending=f.c.commit({action:1,route:0,delivery:0});
  f.internal.game=structuredClone(f.g);f.internal.game.phase=3;release();const result=await pending;assert.equal(result.ok,false);assert.match(result.error!,/Game context changed/);assert.equal(f.signed(),0);f.c.dispose();
  const closed=await unitController();closed.g.phase=2;let finish!:()=>void;closed.internal.pumpFlight=new Promise<void>(resolve=>finish=resolve);const queued=closed.c.commit({action:1,route:0,delivery:0});closed.c.dispose();finish();assert.equal((await queued).ok,false);assert.equal(closed.signed(),0);
});
test("unused job refund is exposed immediately after canonical bridge completion",async()=>{
  const f=await unitController(),m:Mission={game:f.match,sponsor:f.owner.address,bump:1,roster:3,rulesHash:f.g.rulesHash,contentHash:f.g.contentHash,eligibleMask:15,fundedAt:100n,slots:Array.from({length:2},()=>({status:0,provider:255,nonce:0,owner:address("11111111111111111111111111111111")}))};
  f.internal.vault=m;assert.equal(f.internal.vaultView().refundable,false);
  f.g.stage=2;f.g.history[1].complete=true;assert.equal(f.internal.vaultView().refundable,true);assert.equal(f.internal.vaultView().slots[0].refundable,true);f.c.dispose();
});
test("accepted payout rights do not expire and earned proof requires finalized job history",async()=>{
  const f=await unitController(),owner=f.g.seats[2].owner,m:Mission={game:f.match,sponsor:f.owner.address,bump:1,roster:3,rulesHash:f.g.rulesHash,contentHash:f.g.contentHash,eligibleMask:15,fundedAt:100n,slots:[{status:1,provider:2,nonce:77,owner},{status:0,provider:255,nonce:0,owner:address("11111111111111111111111111111111")}]};
  f.g.stage=2;f.g.history[1].complete=true;f.g.history[1].jobs[0]={slot:0,provider:2,nonce:77,owner,executed:true};f.internal.owner.chainNow=()=>100000;f.internal.vault=m;f.internal.finalVault=structuredClone(m);
  let slot=f.internal.vaultView().slots[0];assert.equal(slot.status,"earned");assert.equal(slot.refundable,false);assert.equal(slot.proof,"confirmed");assert.equal(slot.recipient,owner);
  f.internal.final=structuredClone(f.g);slot=f.internal.vaultView().slots[0];assert.equal(slot.proof,"finalized");
  f.g.history[1].jobs[0].executed=false;slot=f.internal.vaultView().slots[0];assert.equal(slot.status,"reserved");assert.equal(slot.refundable,true,"only an explicit unperformed receipt permits reserved refund");f.c.dispose();
});
test("coordinated unsealed human plans remain a legal complete campaign",async()=>{
  let s=createV2State(4);
  for(let stage=0;stage<6;stage++){
    const moves=s.players.map(()=>({action:2,route:stage===0?1:0,delivery:0}));
    if(stage===1){moves[1].action=3;moves[2].action=3;}
    if(stage===2){moves[0].action=1;moves[1].action=1;moves[3].action=4;}
    if(stage===3){moves[0].action=1;moves[1].action=1;moves[2].action=4;moves[3].action=4;}
    if(stage===4){moves[2].action=3;moves[3].action=3;}
    if(stage===5)moves[3].delivery=Math.min(5,s.players[3].resources[2]);
    const r=await resolveV2(v2Input(s,moves,[]));assert.ok(r.hull>0);s=advanceV2State(s,r);
  }
  assert.equal(s.arrived,true);assert.equal(s.history.length,6);assert.equal(s.players.reduce((sum,p)=>sum+p.delivered,0),4);
});
