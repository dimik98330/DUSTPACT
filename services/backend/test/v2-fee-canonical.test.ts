import {test}from'node:test';import assert from'node:assert/strict';import{readFile}from'node:fs/promises';
import{address,blockhash,createNoopSigner,generateKeyPairSigner,createTransactionMessage,setTransactionMessageFeePayerSigner,setTransactionMessageLifetimeUsingBlockhash,appendTransactionMessageInstructions,compileTransaction,getBase64EncodedWireTransaction,signatureBytes,pipe,type Instruction,type Address}from'@solana/kit';
import{decodeGameV2,decodeMission}from'../../../packages/solana-v2/src/decode';
import{PROGRAM_V2,VAULT_PROGRAM,TOKEN,SYSTEM,USDC_MINT}from'../../../packages/solana-v2/src/constants';
import{Writer,discriminator}from'../../../packages/solana-v2/src/codec';
import{matchAddress,missionAddress,tokenAddress}from'../../../packages/solana-v2/src/addressing';
import{prepareMove}from'../../../packages/solana-v2/src/consent';
import{rebuildSponsoredV2,type FeeQuoteV2,type FeeStateV2}from'../src/v2-fee-canonical';
const fixture=(f:string)=>new URL(`../../../tests/fixtures/native/v2/vault-sdk/fixtures/${f}`,import.meta.url);
async function data(){const g=await decodeGameV2(new Uint8Array(await readFile(fixture('open-paid-offer-game.bin')))),m=await decodeMission(new Uint8Array(await readFile(fixture('paid-mission.bin'))));const match=(await matchAddress(g.creator,g.nonce))[0],payer=await generateKeyPairSigner();return{q:{id:'fixture',genesis:'fixture',feePayer:payer.address,owner:g.seats[0].owner,actor:g.seats[0].owner,match,blockhash:blockhash(SYSTEM),lastValidBlockHeight:100n}as FeeQuoteV2,state:{game:g,mission:m,chainNow:0n}as FeeStateV2};}
const auth=(g:any)=>new Writer().u8(0).address(g.seats[0].owner).u64(g.seats[0].actionNonce).u32(g.seats[0].epoch).u8(g.stage);
const wire=(q:FeeQuoteV2,ix:Instruction[])=>compileTransaction(pipe(createTransactionMessage({version:0}),m=>setTransactionMessageFeePayerSigner(createNoopSigner(q.feePayer),m),m=>setTransactionMessageLifetimeUsingBlockhash({blockhash:q.blockhash,lastValidBlockHeight:q.lastValidBlockHeight},m),m=>appendTransactionMessageInstructions(ix,m)));
async function gameIx(q:FeeQuoteV2,name:string,args:Uint8Array,role:2|3=2):Promise<Instruction>{return{programAddress:PROGRAM_V2,accounts:[{address:q.match,role:1},{address:q.actor,role}],data:new Writer().raw(await discriminator('global',name)).raw(args).bytes()};}
test('Fee rebuild accepts canonical native fixture planning readiness and rejects changed actor privileges/extra programs',async()=>{
 const {q,state}=await data(),ix=await gameIx(q,'set_plan_ready',auth(state.game).bool(true).bytes());
 const actual=await rebuildSponsoredV2(getBase64EncodedWireTransaction(wire(q,[ix])),q,state);assert.equal(actual.name,'set_plan_ready');
 const privileged={...ix,accounts:ix.accounts!.map((a,i)=>i===1?{...a,role:3 as const}:a)};await assert.rejects(rebuildSponsoredV2(getBase64EncodedWireTransaction(wire(q,[privileged])),q,state),/FEE_NONCANONICAL/);
 await assert.rejects(rebuildSponsoredV2(getBase64EncodedWireTransaction(wire(q,[{programAddress:SYSTEM,data:Uint8Array.of(0)},ix])),q,state),/FEE_EXTRA/);
});
test('Nonzero inbound player signature, sponsor-as-session and delegation to sponsor reject',async()=>{
 const {q,state}=await data(),g=state.game!,ix=await gameIx(q,'set_plan_ready',auth(g).bool(true).bytes()),tx=wire(q,[ix]);
 await assert.rejects(rebuildSponsoredV2(getBase64EncodedWireTransaction({...tx,signatures:{...tx.signatures,[q.actor]:signatureBytes(new Uint8Array(64).fill(1))}}),q,state),/SIGNED_INPUT/);
 g.seats[2].session=q.feePayer;await assert.rejects(rebuildSponsoredV2(getBase64EncodedWireTransaction(tx),q,state),/GAME_AUTHORITY/);g.seats[2].session=SYSTEM;
 const delegate=await gameIx(q,'authorize_session',auth(g).address(q.feePayer).i64(1000n).bytes());await assert.rejects(rebuildSponsoredV2(getBase64EncodedWireTransaction(wire(q,[delegate])),q,state),/GAME_AUTHORITY/);
});
test('Reveal must be in its exact window and match the retained salted commitment',async()=>{
 const {q,state}=await data(),g=state.game!;g.phase=3;g.deadline=1000n;g.committed=1;g.revealed=0;const move=await prepareMove(q.match,g,0,{action:2,route:0,delivery:0},new Uint8Array(32).fill(4));g.commitments[0]=move.commitment;
 const ix=await gameIx(q,'reveal_move',auth(g).u8(move.action).u8(move.route).u16(move.delivery).raw(move.salt).bytes()),encoded=getBase64EncodedWireTransaction(wire(q,[ix]));assert.equal((await rebuildSponsoredV2(encoded,q,state)).name,'reveal_move');
 g.phase=2;await assert.rejects(rebuildSponsoredV2(encoded,q,state),/PHASE_CLOSED/);g.phase=3;state.chainNow=1000n;await assert.rejects(rebuildSponsoredV2(encoded,q,state),/PHASE_CLOSED/);state.chainNow=0n;g.commitments[0]=new Uint8Array(32);await assert.rejects(rebuildSponsoredV2(encoded,q,state),/REVEAL_CONTEXT/);
});
test('Fund/claim/refund derive fixed source/recipient from native mission, never caller account list',async()=>{
 const {q,state}=await data(),[mission]=await missionAddress(q.match),[escrow]=await tokenAddress(mission),[source]=await tokenAddress(q.actor);state.game!.phase=0;
 const fund:Instruction={programAddress:VAULT_PROGRAM,data:await discriminator('global','fund'),accounts:[{address:mission,role:1},{address:q.match,role:0},{address:q.actor,role:3},{address:USDC_MINT,role:0},{address:source,role:1},{address:escrow,role:1},{address:TOKEN,role:0},{address:SYSTEM,role:0}]};
 assert.equal((await rebuildSponsoredV2(getBase64EncodedWireTransaction(wire(q,[fund])),q,state)).name,'fund');
 for(const name of ['claim','refund']as const){const recipient=name==='claim'?state.mission!.slots[0].owner:state.mission!.sponsor,[destination]=await tokenAddress(recipient);const ix:Instruction={programAddress:VAULT_PROGRAM,data:new Writer().raw(await discriminator('global',name)).u8(0).bytes(),accounts:[{address:mission,role:1},{address:q.match,role:0},{address:USDC_MINT,role:0},{address:escrow,role:1},{address:destination,role:1},{address:TOKEN,role:0},{address:q.actor,role:2}]};
  assert.equal((await rebuildSponsoredV2(getBase64EncodedWireTransaction(wire(q,[ix])),q,state)).name,name);
  const changed={...ix,accounts:ix.accounts!.map((a,i)=>i===4?{...a,address:q.actor}:a)};await assert.rejects(rebuildSponsoredV2(getBase64EncodedWireTransaction(wire(q,[changed])),q,state),/NONCANONICAL/);
 }
});
test('Creation before membership binds creator nonce/PDA and account rent to actor',async()=>{
 const {q}=await data(),nonce=new Uint8Array(16).fill(5);q.match=(await matchAddress(q.actor,nonce))[0];const ix=await gameIx(q,'create_match',nonce,3);const canonical={...ix,accounts:[...ix.accounts!,{address:SYSTEM,role:0 as const}]};assert.equal((await rebuildSponsoredV2(getBase64EncodedWireTransaction(wire(q,[canonical])),q,{game:null,mission:null,chainNow:0n})).name,'create_match');
 q.owner=(await generateKeyPairSigner()).address;await assert.rejects(rebuildSponsoredV2(getBase64EncodedWireTransaction(wire(q,[canonical])),q,{game:null,mission:null,chainNow:0n}),/CREATE_CONTEXT/);
});
test('NPC fee eligibility applies to owner-signed Vault paths while an outside human can settle',async()=>{
 const {q,state}=await data(),g=state.game!,[mission]=await missionAddress(q.match),[escrow]=await tokenAddress(mission);g.phase=0;g.npcMask=1;
 async function vaultIx(name:'fund'|'claim'|'refund'){
  const recipient=name==='fund'?q.actor:name==='claim'?state.mission!.slots[0].owner:state.mission!.sponsor,[destination]=await tokenAddress(recipient);
  return {programAddress:VAULT_PROGRAM,data:new Writer().raw(await discriminator('global',name)).raw(name==='fund'?new Uint8Array():Uint8Array.of(0)).bytes(),accounts:name==='fund'?[{address:mission,role:1},{address:q.match,role:0},{address:q.actor,role:3},{address:USDC_MINT,role:0},{address:destination,role:1},{address:escrow,role:1},{address:TOKEN,role:0},{address:SYSTEM,role:0}]:[{address:mission,role:1},{address:q.match,role:0},{address:USDC_MINT,role:0},{address:escrow,role:1},{address:destination,role:1},{address:TOKEN,role:0},{address:q.actor,role:2}]}as Instruction;
 }
 for(const name of ['fund','claim','refund']as const){const ix=await vaultIx(name);await assert.rejects(rebuildSponsoredV2(getBase64EncodedWireTransaction(wire(q,[ix])),q,state),/FEE_ACTOR_REJECTED/);}
 const outsider=(await generateKeyPairSigner()).address;q.actor=outsider;q.owner=outsider;
 for(const name of ['fund','claim','refund']as const){const ix=await vaultIx(name);assert.equal((await rebuildSponsoredV2(getBase64EncodedWireTransaction(wire(q,[ix])),q,state)).name,name);}
 // Changing only the actor must not turn a disclosed NPC owner into a fee-eligible human.
 q.owner=g.seats[0].owner;const ix=await vaultIx('claim');await assert.rejects(rebuildSponsoredV2(getBase64EncodedWireTransaction(wire(q,[ix])),q,state),/FEE_ACTOR_REJECTED/);
});
