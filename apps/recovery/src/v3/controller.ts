import { address, type Address, type TransactionSigner } from '@solana/kit';
import { V3Client, V3Reader, SYSTEM, PROGRAM_V3, VAULT_PROGRAM, configBytes, prepareMove,
  privateMoveEnvelope, verifyRecoveryBundle, recoveryBundle, recoveryMoveScope, verifyPrivateMoveCopy,
  verifyDeployment, assertObservationContinuity, type V3Observation, type PreparedMove, type Move, type TransactionUpdate, type TrustedReleasePolicy,
} from '../../../../packages/solana-v3/src/index';
import { RecoveryPendingFence } from '../../../../packages/solana-v3/src/recovery-pending';
import { verifyV3History } from '../../../../packages/engine/src/v3-replay';
import type { DirectPendingStorage } from '../../../../packages/solana-client/src/pending';
import { isLoopbackRpc, localRecoveryPolicies } from './policies';

export type RecoveryState={observation:V3Observation|null;finalized:V3Observation|null;prepared:PreparedMove|null;seat:number|null;
 busy:boolean;error:string;transaction?:TransactionUpdate;pendingCount:number;legacyMoveOnly:boolean;
 replay?:Awaited<ReturnType<typeof verifyV3History>>;signingVerified:boolean;signer?:string;url:string;staleMove?:boolean;invalidMove?:boolean;
 status:'loading'|'live'|'stale'|'resync';seenAt?:number;unknownWindow:boolean};
type Options={policies?:readonly TrustedReleasePolicy[];storage?:DirectPendingStorage};
/** No rooms, chat, indexer, keeper, fee sponsor or primary-origin calls. No generated identities. */
export class RecoveryV3Controller {
 private reader:V3Reader;private actor?:V3Client;private signer?:TransactionSigner;
 private policies?:readonly TrustedReleasePolicy[];private generation=0;private closed=false;
 private listeners=new Set<()=>void>();private fence?:RecoveryPendingFence;
 private unknownWindowExpiry?:bigint;private readFlight?:Promise<void>;private readGeneration=-1;
 private signerReady=false;private ownPending:Awaited<ReturnType<V3Client['pending']>>=[];
 private state:RecoveryState;
 constructor(readonly match:Address,url:string,private options:Options={}){
  this.reader=new V3Reader(url);this.policies=options.policies;this.state={url,observation:null,finalized:null,prepared:null,seat:null,busy:false,error:'',pendingCount:0,legacyMoveOnly:false,signingVerified:false,status:'loading',unknownWindow:false};
 }
 snapshot=()=>this.state;
 subscribe=(f:()=>void)=>{this.listeners.add(f);return()=>this.listeners.delete(f);};
  private publish(update:Partial<RecoveryState>){if(this.closed)return;this.state={...this.state,...update};for(const f of this.listeners)f();}
 private alive(generation=this.generation){if(this.closed||generation!==this.generation)throw Error('Recovery context changed; no different action was signed');}
 private scope(){const o=this.state.observation,seat=this.state.seat;if(!o||seat===null)throw Error('The connected signer has no selected V3 seat');return {game:o.game,seat,match:this.match,genesis:o.genesis};}
 private select(o:V3Observation){if(!this.signer)return null;const matches=o.game.seats.slice(0,o.game.count).flatMap((s,i)=>s.owner===this.signer!.address||s.session===this.signer!.address?[i]:[]);return matches.length===1?matches[0]:null;}
 async refresh(){
  const generation=this.generation;if(this.readFlight&&this.readGeneration===generation)return this.readFlight;
  const prior=this.readFlight,flight=(async()=>{if(prior)await prior.catch(()=>{});this.alive(generation);await this.readSnapshot(generation);})();
  this.readFlight=flight;this.readGeneration=generation;
  try{await flight;}finally{if(this.readFlight===flight)this.readFlight=undefined;}
 }
 private async readSnapshot(generation:number){
  const reader=this.reader;
  try{let observation=await reader.read(this.match,'confirmed'),finalized=await reader.read(this.match,'finalized');this.alive(generation);
   if(this.actor){const changes=await this.actor.reconcilePending(this.match);this.alive(generation);this.ownPending=await this.actor.pending(this.match);this.alive(generation);
    if(changes.length){observation=await reader.read(this.match,'confirmed');finalized=await reader.read(this.match,'finalized');this.alive(generation);}}
   let prepared=this.state.prepared;
   if(prepared&&(prepared.stage!==observation.game.stage||prepared.owner!==observation.game.seats[prepared.seat]?.owner))prepared=null;
   const seat=this.select(observation);if(prepared&&prepared.seat!==seat)prepared=null;if(this.actor&&seat!==null)this.actor.activeSeat=seat;
   if(this.fence)await this.fence.reconcile(reader.rpc);this.alive(generation);
   const pendingCount=this.pendingRecords().length;
   const height=this.unknownWindowExpiry!==undefined?await reader.rpc.getBlockHeight({commitment:'finalized'}).send():null;
   const unknownWindow=height!==null&&this.unknownWindowExpiry!==undefined&&height<=this.unknownWindowExpiry;
   let replay:RecoveryState['replay'];try{replay=await verifyV3History(finalized.game);}catch{/* Own Wasm may still be loading; absence is not a valid replay. */}
   this.alive(generation);this.publish({observation,finalized,seat,prepared,pendingCount,replay,error:'',status:'live',seenAt:Date.now(),unknownWindow,signingVerified:!!this.actor&&this.signerReady});
   if(seat!==null&&this.options.storage&&(prepared||this.fence||this.ownPending.length))this.persist(prepared);
  }catch(e){this.alive(generation);this.publish({error:e instanceof Error?e.message:'Recovery read failed',status:'stale',replay:undefined,signingVerified:false});throw e;}
 }
 private async checkedPolicies(reader:V3Reader,o:V3Observation){
  const policies=this.options.policies??(isLoopbackRpc(reader.url)?localRecoveryPolicies(o.genesis):undefined);
  if(!policies)throw Error('Public signing requires reviewed Game and Vault release policies');
  for(const p of policies)await verifyDeployment(reader.rpc,p);
  if(policies.length!==2||!policies.some(p=>p.program===PROGRAM_V3)||!policies.some(p=>p.program===VAULT_PROGRAM))throw Error('Incomplete deployment policy pair');
  return policies;
 }
 async connectSigner(signer:TransactionSigner|undefined){
  this.actor?.cancelPendingSignatures();this.generation++;const generation=this.generation;this.signer=signer;this.actor=undefined;this.signerReady=false;this.ownPending=[];
  this.fence=undefined;this.unknownWindowExpiry=undefined;this.publish({signer:signer?.address,seat:null,prepared:null,pendingCount:0,legacyMoveOnly:false,staleMove:false,invalidMove:false,transaction:undefined,signingVerified:false,busy:true,status:'loading',unknownWindow:false});
  try{await this.refresh();this.alive(generation);
  if(!signer)return;
  const policies=await this.checkedPolicies(this.reader,this.state.observation!);this.alive(generation);
  this.policies=policies;const actor=new V3Client(signer,this.reader.url,{releasePolicies:policies,pendingStorage:this.options.storage});
  actor.onTransaction=e=>{if(generation===this.generation)this.publish({transaction:e});};this.actor=actor;
  const seat=this.select(this.state.observation!);if(seat!==null)actor.activeSeat=seat;
  this.publish({seat,signingVerified:false});
  if(seat!==null&&this.options.storage){const raw=this.options.storage.getItem(this.storageKey());if(raw)await this.importCopyInternal(raw);}
  await this.refresh();this.alive(generation);this.signerReady=true;this.publish({signingVerified:true});
  }finally{if(generation===this.generation)this.publish({busy:false});}
 }
 async switchRpc(url:string){
  if(this.state.busy)throw Error('Finish the current reviewed operation before switching RPC');
  const generation=this.generation,previous=this.state.observation;if(!previous)throw Error('Read the existing Match before switching RPC');let laneGeneration=generation;
  const candidate=new V3Reader(url,previous.genesis);
  this.publish({busy:true});
  try{const o=await candidate.read(this.match,'confirmed'),f=await candidate.read(this.match,'finalized');
   if(o.slot<previous.slot||this.state.finalized&&f.slot<this.state.finalized.slot)throw Error('Replacement RPC is behind the retained observation');
   assertObservationContinuity(previous.game,o.game);if(this.state.finalized)assertObservationContinuity(this.state.finalized.game,f.game);
   const policies=this.signer?await this.checkedPolicies(candidate,o):this.policies;this.alive(generation);
   this.actor?.cancelPendingSignatures();this.reader.dispose();this.reader=candidate;this.policies=policies;this.generation++;
   const nextGeneration=this.generation;laneGeneration=nextGeneration;this.signerReady=false;this.actor=this.signer?new V3Client(this.signer,url,{releasePolicies:policies,pendingStorage:this.options.storage}):undefined;
   if(this.actor)this.actor.onTransaction=e=>{if(nextGeneration===this.generation)this.publish({transaction:e});};
   this.publish({url,signingVerified:false,error:''});await this.refresh();this.alive(nextGeneration);this.signerReady=!!this.actor;this.publish({signingVerified:this.signerReady});
  }catch(e){if(this.reader!==candidate)candidate.dispose();throw e;}finally{if(laneGeneration===this.generation)this.publish({busy:false});}
 }
 async importCopy(json:string){
  if(this.state.busy)throw Error('Finish the current recovery operation before importing another choice');
  const generation=this.generation;this.publish({busy:true});try{await this.importCopyInternal(json);}finally{if(generation===this.generation)this.publish({busy:false});}
 }
 private async importCopyInternal(json:string){
  const generation=this.generation;await this.refresh();this.alive(generation);const scope=this.scope(),key=recoveryMoveScope(scope);
  const copy=await verifyRecoveryBundle(json,scope);this.alive(generation);
  await this.refresh();this.alive(generation);if(recoveryMoveScope(this.scope())!==key)throw Error('Move context changed during import');
  const fresh=(await this.reader.rpc.getLatestBlockhash({commitment:'finalized'}).send()).value;this.alive(generation);
  this.fence=new RecoveryPendingFence(copy.pending,fresh.lastValidBlockHeight);
  this.unknownWindowExpiry=fresh.lastValidBlockHeight;
  this.publish({prepared:copy.move,pendingCount:copy.pending.length,legacyMoveOnly:copy.legacyMoveOnly,staleMove:copy.staleMove,invalidMove:'invalidMove' in copy&&copy.invalidMove===true});
  this.options.storage?.setItem(this.storageKey(),json);
  await this.refresh();
 }
 async prepare(move:Move){
  if(this.state.busy)throw Error('Another reviewed recovery operation is still running');
  const laneGeneration=this.generation;this.publish({busy:true});try{
  await this.refresh();this.alive(laneGeneration);const generation=laneGeneration,scope=this.scope(),key=recoveryMoveScope(scope);
  if(scope.game.phase!==1&&scope.game.phase!==2||scope.game.committed&(1<<scope.seat))throw Error('This seat is no longer open for a new choice');
  if(this.state.pendingCount)throw Error('Keep the original private choice while a prior signature is unresolved');
  if(scope.game.phase===2&&this.state.prepared)throw Error('A reviewed Commit choice is already retained; do not silently replace it');
  if(scope.game.phase===1&&scope.game.seats[scope.seat].planningReady)throw Error('Withdraw readiness before changing the approved choice');
  const p=await prepareMove(this.match,scope.game,scope.seat,move);this.alive(generation);await this.refresh();
  if(recoveryMoveScope(this.scope())!==key)throw Error('Choice context changed during review');
  this.persist(p);this.publish({prepared:p,staleMove:false,invalidMove:false});
  }finally{if(laneGeneration===this.generation)this.publish({busy:false});}
 }
 private pendingRecords(){const records=[...(this.fence?.list()??[]),...this.ownPending];return records.filter((r,i)=>records.findIndex(n=>n.signature===r.signature)===i);}
 private persist(p:PreparedMove|null){
  const scope=this.scope();if(!this.options.storage)throw Error('Private move storage is unavailable; no signing is enabled');
  const records=this.pendingRecords();this.options.storage.setItem(this.storageKey(),recoveryBundle(scope,p,records,records.find(r=>r.actor!==scope.game.seats[scope.seat].owner)?.actor));
 }
 private storageKey(){const scope=this.scope();return `dustpact-recovery-v3:${scope.genesis}:${this.match}:${scope.game.seats[scope.seat].owner}`;}
 async exportCopy(){const generation=this.generation,scope=this.scope(),key=recoveryMoveScope(scope),move=this.state.prepared,actor=this.actor;const records=[...(this.fence?.list()??[]),...(actor?await actor.pending(this.match):[])];
  this.alive(generation);if(recoveryMoveScope(this.scope())!==key||move!==this.state.prepared)throw Error('Recovery choice changed during export; download the current context');
  const unique=records.filter((r,i)=>records.findIndex(n=>n.signature===r.signature)===i);
  return recoveryBundle(scope,move,unique,unique.find(r=>r.actor!==scope.game.seats[scope.seat].owner)?.actor??(this.signer?.address!==scope.game.seats[scope.seat].owner?this.signer?.address:undefined));
 }
 private async write(action:(actor:V3Client,o:V3Observation)=>Promise<unknown>,allowExactReveal=false){
  if(this.state.busy)throw Error('Another recovery operation is still finishing');const generation=this.generation,actor=this.actor;if(!actor||!this.signerReady)throw Error('Connect and restore a verified wallet before signing');
  this.publish({busy:true,error:''});
  try{await this.refresh();this.alive(generation);if(this.state.pendingCount)throw Error('A previous signature is unresolved; reconcile without signing again');
   if(this.state.unknownWindow&&!allowExactReveal)throw Error('A backup cannot exclude later sends from the primary client; wait for the fresh blockhash window to expire');
   await actor.reconcilePending(this.match);this.alive(generation);await action(actor,this.state.observation!);this.alive(generation);await this.refresh();
  }catch(e){if(generation===this.generation)this.publish({error:e instanceof Error?e.message:'Recovery action failed'});throw e;}finally{if(generation===this.generation)this.publish({busy:false});}
 }
 async ready(ready=true){return this.write(async(actor,o)=>{const scope=this.scope();if(o.game.phase!==1)throw Error('Planning has closed');if(ready){if(!this.state.prepared)throw Error('Review and save a move before approving it');await verifyPrivateMoveCopy(JSON.stringify(privateMoveEnvelope(this.state.prepared,scope.genesis)),scope);}await actor.stageReady(this.match,ready);});}
 async commit(){return this.write(async(actor,o)=>{const scope=this.scope();if(o.game.phase!==2||o.game.committed&(1<<scope.seat))throw Error('Commit is closed or already stored');
  const p=this.state.prepared;if(!p)throw Error('Import or review a private move first');const checked=await verifyPrivateMoveCopy(JSON.stringify(privateMoveEnvelope(p,scope.genesis)),scope);this.persist(checked);await actor.commit(this.match,checked);});}
 async reveal(){return this.write(async(actor,o)=>{const scope=this.scope();if(o.game.phase!==3||o.game.revealed&(1<<scope.seat))throw Error('Reveal is closed or already stored');const p=this.state.prepared;if(!p)throw Error('Import the original private copy; a replacement salt cannot reveal this commitment');
  await actor.reveal(this.match,await verifyPrivateMoveCopy(JSON.stringify(privateMoveEnvelope(p,scope.genesis)),scope));},true);}
 async advance(){return this.write(async(actor,o)=>actor.advance(this.match,{stage:o.game.stage,phase:o.game.phase}));}
 async resolve(){return this.write(async(actor,o)=>actor.resolve(this.match,o.game.stage));}
 async revokeSession(){return this.write(async(actor,o)=>{const scope=this.scope();if(o.game.seats[scope.seat].owner!==actor.signer.address)throw Error('Only the seat owner may revoke its session');await actor.revokeSession(this.match);});}
 async authorizeSession(session:Address,expires:bigint){return this.write(async(actor,o)=>{const scope=this.scope();if(o.game.seats[scope.seat].owner!==actor.signer.address)throw Error('Only the owner may authorize a session');await actor.authorizeSession(this.match,address(session),expires);});}
 async claim(slot:number){return this.write(async(actor,o)=>{const m=o.mission,s=m?.slots[slot],job=o.game.history[1]?.complete?o.game.history[1].jobs.find(j=>j.slot===slot&&j.provider===s?.provider&&j.owner===s?.owner&&j.nonce===s?.nonce):undefined;
  if(!s||s.status!==1||!job?.executed||s.owner===SYSTEM)throw Error('No canonical executed unpaid work receipt for this slot');await actor.claim(this.match,slot);});}
 async refund(slot:number){return this.write(async(actor,o)=>actor.refund(this.match,slot));}
 dispose(){this.closed=true;this.generation++;this.actor?.cancelPendingSignatures();this.reader.dispose();this.listeners.clear();this.state={...this.state,prepared:null};}
}
