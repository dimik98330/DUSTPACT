import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSigner, getBase58Decoder, type Signature } from '@solana/kit';
import { RecoveryV2Controller } from '../apps/recovery/src/v2/controller';
import { localRecoveryPolicies } from '../apps/recovery/src/v2/policies';
import { gameFixtureV2, genesisFixtureV2 } from '../services/backend/test/v2-fixtures';
import { PROGRAM_V2, V2Reader, prepareMove, recoveryBundle, verifyRecoveryBundle } from '../packages/solana-v2/src/index';
import { recoveryLink } from '../apps/web/src/v2/links';
const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r;});return {promise,resolve};};
async function setup(){
 const owners=await Promise.all(Array.from({length:4},()=>generateKeyPairSigner())),{game,match}=await gameFixtureV2(owners.map(o=>o.address));game.phase=1;
 const memory=new Map<string,string>(),storage={getItem:(k:string)=>memory.get(k)??null,setItem:(k:string,v:string)=>{memory.set(k,v);},removeItem:(k:string)=>{memory.delete(k);}};
 let status:any=null,height=100n;
 const observation=()=>({game:structuredClone(game),mission:null,missionActive:false,escrowAmount:null,genesis:genesisFixtureV2,slot:20n,chainNow:100n,commitment:'confirmed' as const});
 const reader={url:'http://127.0.0.1:19099',read:async(_:unknown,commitment:any)=>({...observation(),commitment}),dispose:()=>{},rpc:{
  getLatestBlockhash:()=>({send:async()=>({value:{lastValidBlockHeight:250n}})}),getBlockHeight:()=>({send:async()=>height}),getSignatureStatuses:()=>({send:async()=>({value:[status]})})}};
 const make=()=>{const c=new RecoveryV2Controller(match,reader.url,{storage}),i=c as any;i.reader.dispose();i.reader=reader;i.signer=owners[0];i.signerReady=true;i.actor={signer:owners[0],pending:async()=>[],reconcilePending:async()=>[],cancelPendingSignatures:()=>{}};i.publish({signer:owners[0].address});return {c,i};};
 const {c,i}=make();await c.refresh();
 const signature=getBase58Decoder().decode(new Uint8Array(64).fill(17)) as Signature;
 const pending={program:PROGRAM_V2,genesis:genesisFixtureV2,actor:owners[0].address,match,signature,intentHash:'a'.repeat(64),lastValidBlockHeight:90n,feeLamports:5000n,createdAt:1,status:'pending' as const};
 return {c,i,game,match,owners,reader,memory,storage,make,pending,observation,setStatus:(s:any)=>{status=s;},setHeight:(v:bigint)=>{height=v;}};
}
test('a prior-stage private move cannot discard confirmed pending metadata on import or reload',async()=>{
 const f=await setup(),scope={game:structuredClone(f.game),match:f.match,seat:0,genesis:genesisFixtureV2},move=await prepareMove(f.match,f.game,0,{action:2,route:0,delivery:0});
 const json=recoveryBundle(scope,move,[f.pending]);f.game.stage=1;f.game.revision++;
 f.setStatus({confirmationStatus:'confirmed',slot:18n,err:null});await f.c.importCopy(json);
 assert.equal(f.c.snapshot().prepared,null);assert.equal(f.c.snapshot().staleMove,true);assert.equal(f.c.snapshot().pendingCount,1);
 const saved=[...f.memory.values()][0],copy=await verifyRecoveryBundle(saved,{...scope,game:f.game});assert.equal(copy.move,null);assert.equal(copy.pending[0].status,'confirmed');
 const next=f.make();f.setStatus(null);await assert.rejects(next.c.importCopy(saved),/Confirmed recovery signature/);
 assert.equal(next.c.snapshot().status,'stale');assert.equal(next.c.snapshot().signingVerified,false);assert.equal(next.c.snapshot().prepared,null);next.c.dispose();f.c.dispose();
});
test('a later bound action or different canonical commitment rejects the move while retaining the journal',async()=>{
 const f=await setup(),scope={game:structuredClone(f.game),match:f.match,seat:0,genesis:genesisFixtureV2},move=await prepareMove(f.match,f.game,0,{action:2,route:0,delivery:0});
 const json=recoveryBundle(scope,move,[f.pending]);f.game.seats[0].bound=3;
 let copy=await verifyRecoveryBundle(json,{...scope,game:f.game});assert.equal(copy.move,null);assert.equal(copy.invalidMove,true);assert.equal(copy.pending.length,1);
 f.game.seats[0].bound=255;f.game.committed=1;f.game.commitments[0]=new Uint8Array(32).fill(19);
 copy=await verifyRecoveryBundle(json,{...scope,game:f.game});assert.equal(copy.move,null);assert.equal(copy.invalidMove,true);assert.equal(copy.pending.length,1);
 await f.c.importCopy(json);assert.equal(f.c.snapshot().pendingCount,1);assert.equal(f.c.snapshot().invalidMove,true);f.c.dispose();
});
test('prepare never adopts a different wallet context after waiting for a read',async()=>{
 const f=await setup(),gate=deferred(),entered=deferred();let reads=0;
 f.i.refresh=async()=>{if(++reads===1){entered.resolve();await gate.promise;}};
 const draft=f.c.prepare({action:2,route:0,delivery:0}),rejected=assert.rejects(draft,/Recovery context changed/);await entered.promise;
 await f.c.connectSigner(undefined);gate.resolve();await rejected;
 assert.equal(f.c.snapshot().prepared,null);assert.equal(f.c.snapshot().signingVerified,false);assert.equal(f.memory.size,0);f.c.dispose();
});
test('an old RPC switch cannot unlock a newer wallet restore lane',async t=>{
 const f=await setup(),switchGate=deferred(),connectGate=deferred(),switchEntered=deferred(),connectEntered=deferred(),replacement='http://127.0.0.1:19199';
 t.mock.method(V2Reader.prototype,'read',async(_match:unknown,commitment:'confirmed'|'finalized')=>({...f.observation(),commitment}));
 f.i.refresh=async()=>{};
 f.i.checkedPolicies=async(reader:any)=>{if(reader.url===replacement){switchEntered.resolve();await switchGate.promise;}else{connectEntered.resolve();await connectGate.promise;}return localRecoveryPolicies(genesisFixtureV2);};
 const switching=f.c.switchRpc(replacement),rejected=assert.rejects(switching,/Recovery context changed/);await switchEntered.promise;
 const connecting=f.c.connectSigner(f.owners[1]);await connectEntered.promise;switchGate.resolve();await rejected;
 assert.equal(f.c.snapshot().busy,true);assert.equal(f.c.snapshot().signingVerified,false);assert.equal(f.c.snapshot().url,f.reader.url);
 connectGate.resolve();await connecting;assert.equal(f.c.snapshot().busy,false);assert.equal(f.c.snapshot().signingVerified,true);f.c.dispose();
});
test('an async export cannot mix the prior private move with a newly connected wallet',async()=>{
 const f=await setup(),gate=deferred(),entered=deferred();f.i.actor.pending=async()=>{entered.resolve();await gate.promise;return [];};
 const exporting=f.c.exportCopy(),rejected=assert.rejects(exporting,/Recovery context changed/);await entered.promise;await f.c.connectSigner(undefined);gate.resolve();await rejected;f.c.dispose();
});
test('recovery links contain only public references and require an explicit public origin',()=>{
 const url=new URL(recoveryLink('http://127.0.0.1:4175/?salt=private','match-value','local')!);assert.equal(url.port,'4174');assert.equal(url.searchParams.has('salt'),false);assert.equal(url.searchParams.get('match'),'match-value');
 assert.equal(recoveryLink('https://game.example/','match-value','devnet'),null);
 assert.equal(new URL(recoveryLink('https://game.example/','match-value','devnet','https://recovery.example')!).origin,'https://recovery.example');
 for(const origin of ['https://user:password@example.com','http://example.com','https://example.com?key=private'])assert.throws(()=>recoveryLink('https://game.example/','m','devnet',origin));
});
