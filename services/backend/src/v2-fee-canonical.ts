/** Reconstructs fee-authorized messages. No caller account list or wallet signature is trusted. */
import {createNoopSigner,createTransactionMessage,setTransactionMessageFeePayerSigner,setTransactionMessageLifetimeUsingBlockhash,appendTransactionMessageInstructions,compileTransaction,getTransactionDecoder,getTransactionEncoder,getCompiledTransactionMessageDecoder,assertIsTransactionWithinSizeLimit,pipe,type Address,type Instruction,type Blockhash} from '@solana/kit';
import {PROGRAM_V2,VAULT_PROGRAM,TOKEN,ATA_PROGRAM,SYSTEM,USDC_MINT} from '../../../packages/solana-v2/src/constants';
import {matchAddress,missionAddress,tokenAddress} from '../../../packages/solana-v2/src/addressing';
import {Reader,discriminator,equalBytes} from '../../../packages/solana-v2/src/codec';
import {reviewConfig,reviewOffer,prepareMove} from '../../../packages/solana-v2/src/consent';
import type {GameV2,Mission,Auth as GameAuth} from '../../../packages/solana-v2/src/types';
import {decodeBase64,requireThat} from './security';
export type FeeQuoteV2={id:string;genesis:string;feePayer:Address;owner:Address;actor:Address;match:Address;blockhash:Blockhash;lastValidBlockHeight:bigint};
export type FeeStateV2={game:GameV2|null;mission:Mission|null;chainNow:bigint};
const gameNames=['create_match','join_match','leave_lobby','configure_mission','set_ready','start_match','authorize_session','revoke_session','create_offer','cancel_offer','accept_offer','accept_sponsored','set_plan_ready','commit_move','reveal_move','advance_phase','resolve_stage'] as const;
const vaultNames=['fund','claim','refund'] as const;
const tags=new Map<string,Promise<Uint8Array>>();
const tag=(name:string)=>{let t=tags.get(name);if(!t){t=discriminator('global',name);tags.set(name,t);}return t;};
export async function sponsoredNameV2(program:Address,data:Uint8Array){
 const names=program===PROGRAM_V2?gameNames:program===VAULT_PROGRAM?vaultNames:[];
 for(const name of names)if(equalBytes(data.slice(0,8),await tag(name)))return name;
 throw Error('V2_FEE_UNSUPPORTED_INSTRUCTION');
}
const auth=(r:Reader):GameAuth=>({seat:r.u8(),owner:r.address(),nonce:r.u64(),epoch:r.u32(),stage:r.u8()});
function actorScope(q:FeeQuoteV2,g:GameV2,a?:GameAuth,ownerOnly=false){
 requireThat(!g.seats.slice(0,g.count).some(s=>s.owner===q.feePayer||s.session===q.feePayer),403,'FEE_PAYER_HAS_GAME_AUTHORITY');
 const seat=a?.seat??g.seats.slice(0,g.count).findIndex(s=>s.owner===q.actor||s.session===q.actor),s=g.seats[seat];
 requireThat(seat>=0&&seat<g.count&&s&&q.owner===s.owner&&!(g.npcMask&(1<<seat)),403,'FEE_ACTOR_REJECTED');
 requireThat(q.actor===s.owner||!ownerOnly&&q.actor===s.session&&s.quota>0,403,'FEE_ACTOR_REJECTED');
 if(a)requireThat(a.owner===s.owner&&a.nonce===s.actionNonce&&a.epoch===s.epoch&&a.stage===g.stage,409,'FEE_STALE_INTENT');
 return {seat,s};
}
async function canonicalPrimary(q:FeeQuoteV2,state:FeeStateV2,program:Address,data:Uint8Array){
 const name=await sponsoredNameV2(program,data),r=new Reader(data);r.raw(8);const g=state.game;
 let accounts:Instruction['accounts']=[{address:q.match,role:1},{address:q.actor,role:2}],a:GameAuth|undefined;
 const phase=(value:number,deadline=true)=>{requireThat(g&&g.phase===value,409,'FEE_PHASE_CLOSED');if(deadline&&value>=1&&value<=3)requireThat(g.deadline>state.chainNow,409,'FEE_PHASE_CLOSED');};
 if(g){
  requireThat(!g.seats.slice(0,g.count).some(s=>s.owner===q.feePayer||s.session===q.feePayer),403,'FEE_PAYER_HAS_GAME_AUTHORITY');
  // Applies to Vault owner calls too; authenticated outsiders remain eligible for permissionless settlement.
  requireThat(!g.seats.slice(0,g.count).some((s,i)=>(g.npcMask&(1<<i))&&(s.owner===q.owner||s.owner===q.actor||s.session===q.owner||s.session===q.actor)),403,'FEE_ACTOR_REJECTED');
 }
 if(name==='create_match'){
  const nonce=r.raw(16),[match]=await matchAddress(q.actor,nonce);requireThat(!g&&q.owner===q.actor&&q.match===match,409,'FEE_CREATE_CONTEXT');accounts=[{address:q.match,role:1},{address:q.actor,role:3},{address:SYSTEM,role:0}];
 }else if(name==='join_match'){
  phase(0);requireThat(g!.count<6&&q.actor===q.owner&&!g!.seats.slice(0,g!.count).some(s=>s.owner===q.actor||s.session===q.actor),409,'FEE_JOIN_CONTEXT');
 }else if(name==='configure_mission'||name==='start_match'){
  phase(0);actorScope(q,g!,undefined,true);requireThat(q.actor===g!.creator,403,'FEE_CREATOR_ONLY');
  if(name==='configure_mission'){const mask=r.u8();r.bool();requireThat(mask<(1<<g!.count),400,'FEE_NPC_MASK');}
 }else if(name==='advance_phase'||name==='resolve_stage'){
  requireThat(g,409,'FEE_MATCH_MISSING');const member=actorScope(q,g);if(q.actor!==member.s.owner)requireThat(member.s.expires>state.chainNow,403,'FEE_SESSION_EXPIRED');
  const stage=r.u8();requireThat(stage===g.stage,409,'FEE_STALE_INTENT');if(name==='advance_phase'){const p=r.u8();requireThat(p===g.phase&&p>=1&&p<=3,409,'FEE_PHASE_CLOSED');}else phase(4,false);
 }else if(program===VAULT_PROGRAM){
  requireThat(g,409,'FEE_MATCH_MISSING');const[mission]=await missionAddress(q.match),[escrow]=await tokenAddress(mission);
  if(name==='fund'){
   phase(0);requireThat(q.actor===q.owner&&!g.seats.some(s=>s.session===q.actor&&s.owner!==q.actor),403,'FEE_FUND_OWNER_ONLY');
   const[source]=await tokenAddress(q.actor);accounts=[{address:mission,role:1},{address:q.match,role:0},{address:q.actor,role:3},{address:USDC_MINT,role:0},{address:source,role:1},{address:escrow,role:1},{address:TOKEN,role:0},{address:SYSTEM,role:0}];
  }else{
   const slot=r.u8(),m=state.mission;requireThat(slot<2&&m,409,'FEE_MISSION_MISSING');
   // Permissionless settlement may be paid for by an authenticated wallet outside the party.
   if(q.actor!==q.owner){const member=actorScope(q,g);requireThat(member.s.expires>state.chainNow,403,'FEE_SESSION_EXPIRED');}
   const recipient=name==='claim'?m.slots[slot].owner:m.sponsor;requireThat(recipient!==SYSTEM,409,'FEE_RECIPIENT_MISSING');const[destination]=await tokenAddress(recipient);
   accounts=[{address:mission,role:1},{address:q.match,role:0},{address:USDC_MINT,role:0},{address:escrow,role:1},{address:destination,role:1},{address:TOKEN,role:0},{address:q.actor,role:2}];
  }
 }else{
  requireThat(g,409,'FEE_MATCH_MISSING');a=auth(r);const member=actorScope(q,g,a,['leave_lobby','authorize_session','revoke_session'].includes(name));
  if(q.actor!==member.s.owner)requireThat(member.s.expires>state.chainNow,403,'FEE_SESSION_EXPIRED');
  if(name==='set_ready'){
   phase(0);const roster=r.u32(),hash=r.raw(32),review=await reviewConfig(q.match,g);requireThat(roster===g.roster&&equalBytes(hash,review.hash),409,'FEE_CONFIGURATION_CHANGED');
  }else if(name==='leave_lobby')phase(0);
  else if(name==='authorize_session'){const key=r.address();r.i64();requireThat(key!==q.feePayer,403,'FEE_PAYER_HAS_GAME_AUTHORITY');}
  else if(name==='revoke_session'){}
  else if(name==='set_plan_ready'){phase(1);r.bool();}
  else if(name==='commit_move'){phase(2);r.raw(32);requireThat(!(g.committed&(1<<a.seat)),409,'FEE_ALREADY_COMMITTED');}
  else if(name==='reveal_move'){
   phase(3);const action=r.u8(),route=r.u8(),delivery=r.u16(),salt=r.raw(32),move=await prepareMove(q.match,g,a.seat,{action,route,delivery},salt);
   requireThat(g.committed&(1<<a.seat)&&!(g.revealed&(1<<a.seat))&&equalBytes(move.commitment,g.commitments[a.seat]),409,'FEE_REVEAL_CONTEXT');
  }else if(name==='create_offer'){
   phase(1);r.u8();r.u8();r.u8();r.u8();r.u16();const nonce=r.u32();for(let i=0;i<6;i++)r.u16();r.u8();const hash=r.raw(32);
   requireThat(nonce===member.s.offerNonce&&equalBytes(hash,(await reviewConfig(q.match,g)).hash),409,'FEE_OFFER_CONTEXT');
  }else if(name==='cancel_offer'){phase(1);const nonce=r.u32();requireThat(g.offers[a.seat].status===1&&g.offers[a.seat].nonce===nonce,409,'FEE_OFFER_CONTEXT');}
  else if(name==='accept_offer'||name==='accept_sponsored'){
   phase(1);const maker=r.u8(),nonce=r.u32(),hash=r.raw(32),review=await reviewOffer(q.match,g,maker);
   requireThat(review.taker===a.seat&&review.nonce===nonce&&equalBytes(review.hash,hash)&&(name==='accept_sponsored'?review.jobSlot!==255:review.jobSlot===255),409,'FEE_ACCEPT_CONTEXT');
   if(name==='accept_sponsored'){const[mission]=await missionAddress(q.match);requireThat(g.mission===mission,409,'FEE_MISSION_CONTEXT');accounts=[...accounts,{address:mission,role:1},{address:VAULT_PROGRAM,role:0}];}
  }else throw Error('V2_FEE_UNSUPPORTED_INSTRUCTION');
 }
 requireThat(r.position===data.length,400,'FEE_TRAILING_DATA');
 return {name,ix:{programAddress:program,accounts,data:Uint8Array.from(data)} as Instruction};
}
export async function rebuildSponsoredV2(wire:string,q:FeeQuoteV2,state:FeeStateV2){
 requireThat(q.actor!==q.feePayer,403,'FEE_ACTOR_REJECTED');const bytes=decodeBase64(wire,1232),decoded=getTransactionDecoder().decode(bytes),message=getCompiledTransactionMessageDecoder().decode(decoded.messageBytes);
 requireThat(message.version===0&&!message.addressTableLookups?.length&&message.header.numSignerAccounts===2&&message.staticAccounts[0]===q.feePayer&&message.staticAccounts[1]===q.actor,400,'FEE_MESSAGE_HEADER');
 requireThat(Object.keys(decoded.signatures).length===2&&Object.values(decoded.signatures).every(s=>s===null),400,'FEE_SIGNED_INPUT_REJECTED');
 requireThat(message.instructions.length>=1&&message.instructions.length<=2,400,'FEE_INSTRUCTION_COUNT');
 const primary=message.instructions.at(-1)!,program=message.staticAccounts[primary.programAddressIndex],data=Uint8Array.from(primary.data??[]);
 const rebuilt=await canonicalPrimary(q,state,program,data);const instructions=[rebuilt.ix];
 if(message.instructions.length===2){
  requireThat(program===VAULT_PROGRAM,400,'FEE_EXTRA_INSTRUCTION');const[mission]=await missionAddress(q.match);
  const recipient=rebuilt.name==='fund'?mission:rebuilt.name==='claim'?state.mission!.slots[data[8]].owner:state.mission!.sponsor;
  const[ata]=await tokenAddress(recipient);instructions.unshift({programAddress:ATA_PROGRAM,data:Uint8Array.of(1),accounts:[{address:q.actor,role:3},{address:ata,role:1},{address:recipient,role:0},{address:USDC_MINT,role:0},{address:SYSTEM,role:0},{address:TOKEN,role:0}]});
 }
 const canonical=compileTransaction(pipe(createTransactionMessage({version:0}),m=>setTransactionMessageFeePayerSigner(createNoopSigner(q.feePayer),m),m=>setTransactionMessageLifetimeUsingBlockhash({blockhash:q.blockhash,lastValidBlockHeight:q.lastValidBlockHeight},m),m=>appendTransactionMessageInstructions(instructions,m)));
 requireThat(equalBytes(canonical.messageBytes,decoded.messageBytes),400,'FEE_NONCANONICAL_MESSAGE');
 requireThat(equalBytes(getTransactionEncoder().encode(canonical),bytes),400,'FEE_NONCANONICAL_WIRE');
 assertIsTransactionWithinSizeLimit(canonical);
 return {transaction:canonical,instructions,name:rebuilt.name};
}
