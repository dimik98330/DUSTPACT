import {test} from 'node:test';import assert from 'node:assert/strict';import{readFile}from'node:fs/promises';
import {address} from '@solana/kit';
import {decodeGameV2} from '../packages/solana-v2/src/decode';
import type {V2Observation} from '../packages/solana-v2/src/reader';
import {ObserverController} from '../apps/web/src/v2/observer';
import {projectObserverScene,visibleMove} from '../apps/web/src/v2/projection';
import {expeditionLink} from '../apps/web/src/v2/links';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {I18nProvider} from '../packages/ui/src/i18n';
import ObserverScreen from '../apps/web/src/v2/ObserverScreen';
import {decodeMission} from '../packages/solana-v2/src/decode';
const match=address('6jiWwvbzo8MPG4pH4jHeHq7dL4bu6RpcXp21wEAdrfCK');
async function observation():Promise<V2Observation>{return{game:await decodeGameV2(new Uint8Array(await readFile(new URL('../tests/fixtures/native/v2/vault-sdk/fixtures/paid-game.bin',import.meta.url)))),mission:null,missionActive:false,escrowAmount:null,genesis:'fixture',slot:100n,chainNow:1000n,commitment:'finalized'};}
const proof={valid:true,checkedStages:6,scope:'synthetic test proof'};
test('Current intent masks defaults and unrevealed routes; a bound obligation is not a revealed plan',async()=>{
 const {game}=await observation();game.revealed=0;game.seats[0].bound=255;game.actions[0]=4;game.routes[0]=1;game.deliveries[0]=5;
 assert.deepEqual(visibleMove(game,0),{type:'hidden'});game.seats[0].bound=3;assert.deepEqual(visibleMove(game,0),{type:'bound',action:3});
 game.revealed=1;assert.deepEqual(visibleMove(game,0),{type:'revealed',action:4,route:1,delivery:5});
 const scene=projectObserverScene(game,match,'local',i=>`Player ${i+1}`,true);assert.equal(scene.seats[0].name,'Player 1');assert.equal(scene.preparedChoice,undefined);assert.equal(scene.sessionActive,false);
});
test('Observer retains stale last state but clears proof; cancelled/lobby never get a campaign proof',async()=>{
 const o=await observation();let fail=false,disposed=false,replays=0;
 const c=new ObserverController(match,{read:async()=>{if(fail)throw Error('RPC disconnected');return structuredClone(o);},dispose:()=>{disposed=true;}},async()=>{replays++;return proof;});
 await c.refresh();assert.equal(c.snapshot().status,'live');assert.equal(c.snapshot().replay?.checkedStages,6);
 fail=true;await c.refresh();assert.equal(c.snapshot().status,'stale');assert.equal(c.snapshot().observation?.slot,100n);assert.equal(c.snapshot().replay,undefined);
 fail=false;o.game.phase=6;await c.refresh();assert.equal(c.snapshot().replay,undefined);assert.equal(replays,1);
 o.game.phase=0;await c.refresh();assert.equal(c.snapshot().replay,undefined);c.dispose();assert.equal(disposed,true);assert.equal(c.snapshot().observation,undefined);
});
test('Context changes ignore late snapshots/proofs and confirmed does not carry finalized proof',async()=>{
 const o=await observation();let release!:(o:V2Observation)=>void,calls=0;
 const c=new ObserverController(match,{read:async(_m,commitment='confirmed')=>{if(++calls===1)return new Promise<V2Observation>(r=>{release=r;});return{...o,commitment};},dispose:()=>{}},async()=>proof);
 const pending=c.refresh(),switching=c.setCommitment('confirmed');release(o);await pending;await switching;
 assert.equal(c.snapshot().commitment,'confirmed');assert.equal(c.snapshot().observation?.commitment,'confirmed');assert.equal(c.snapshot().replay,undefined);
 let resolveProof!:(p:typeof proof)=>void;
 const old=new ObserverController(match,{read:async()=>o,dispose:()=>{}},()=>new Promise(r=>{resolveProof=r;}));
 const task=old.refresh();await new Promise(r=>setImmediate(r));old.dispose();resolveProof(proof);await task;assert.equal(old.snapshot().status,'closed');assert.equal(old.snapshot().observation,undefined);c.dispose();
});
test('Public links drop session/secret/RPC parameters and separate spectator from seat join',()=>{
 const watch=new URL(expeditionLink('https://user:credential@game.example/play?rpc=credential&match=old&session=secret#move',match,'local',true));
 assert.deepEqual([...watch.searchParams.keys()],['version','cluster','watch']);assert.equal(watch.searchParams.has('match'),false);assert.equal(watch.hash,'');assert.equal(watch.username,'');assert.equal(watch.password,'');
 const join=new URL(expeditionLink(watch.href,match,'devnet'));assert.equal(join.searchParams.get('match'),match);assert.equal(join.searchParams.has('watch'),false);
});
test('Native retained paid/refunded fixture renders sponsor refund without inventing unused-job provider',async()=>{
 const o=await observation();o.mission=await decodeMission(new Uint8Array(await readFile(new URL('../tests/fixtures/native/v2/vault-sdk/fixtures/paid-and-refunded-mission.bin',import.meta.url))));o.escrowAmount=0n;
 const c=new ObserverController(match,{read:async()=>o,dispose:()=>{}},async()=>proof);await c.refresh();
 const html=renderToStaticMarkup(createElement(I18nProvider,{initialLanguage:'en',children:createElement(ObserverScreen,{controller:c,network:'local'})}));
 const start=html.indexOf('<strong>#2 · 10 TEST USDC'),refund=html.slice(start,html.indexOf('</article>',start));
 assert.ok(start>0);assert.match(refund,/Refund to sponsor/);assert.ok(refund.includes(o.mission.sponsor));
 assert.doesNotMatch(refund,/Former provider|Provider|11111111111111111111111111111111/);c.dispose();
});
test('Native open offer explains already-reserved maker input rather than an unreserved promise',async()=>{
 const o=await observation();o.game=await decodeGameV2(new Uint8Array(await readFile(new URL('../tests/fixtures/native/v2/vault-sdk/fixtures/open-paid-offer-game.bin',import.meta.url))));
 const c=new ObserverController(match,{read:async()=>o,dispose:()=>{}});await c.refresh();
 const html=renderToStaticMarkup(createElement(I18nProvider,{initialLanguage:'en',children:createElement(ObserverScreen,{controller:c,network:'local'})}));
 assert.match(html,/maker inputs reserved; counterparty has not accepted/);assert.doesNotMatch(html,/no reservation yet/);c.dispose();
});
