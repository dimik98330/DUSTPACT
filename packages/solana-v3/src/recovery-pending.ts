import type { Signature } from '@solana/kit';
import type { DirectPendingRecord } from '../../solana-client/src/pending';
type Status={confirmationStatus?:'processed'|'confirmed'|'finalized'|null;slot:bigint;err:unknown};
type PendingRpc={getSignatureStatuses(signatures:Signature[],options:{searchTransactionHistory:true}):{send():Promise<{value:readonly(Status|null)[]}>};getBlockHeight(options:{commitment:'finalized'}):{send():Promise<bigint>}};
/** Imported hints cannot prove expiry. Unknown signatures wait a full recent-blockhash window
 * after import as well; observed confirmation cannot silently regress into permission to retry. */
export class RecoveryPendingFence {
 private records:DirectPendingRecord[];
 private confirmed=new Map<Signature,bigint>();
 private readonly earliestUnknownExpiry:bigint;
 constructor(records:readonly DirectPendingRecord[],freshCanonicalLastValidBlockHeight:bigint){this.records=structuredClone([...records]);this.earliestUnknownExpiry=freshCanonicalLastValidBlockHeight;for(const r of records)if(r.status==='confirmed')this.confirmed.set(r.signature,r.confirmedSlot);}
 list(){return this.records.map(r=>{const slot=this.confirmed.get(r.signature);return slot===undefined?structuredClone(r):{program:r.program,genesis:r.genesis,actor:r.actor,match:r.match,signature:r.signature,intentHash:r.intentHash,lastValidBlockHeight:r.lastValidBlockHeight,feeLamports:r.feeLamports,createdAt:r.createdAt,status:'confirmed' as const,confirmedSlot:slot};});}
 async reconcile(rpc:PendingRpc){
  if(!this.records.length)return {blocked:false,remaining:0};
  const statuses=(await rpc.getSignatureStatuses(this.records.map(r=>r.signature),{searchTransactionHistory:true}).send()).value;
  if(statuses.length!==this.records.length)throw Error('Incomplete recovery signature observation');
  const height=await rpc.getBlockHeight({commitment:'finalized'}).send(),keep:DirectPendingRecord[]=[];
  for(const [i,r]of this.records.entries()){
   const s=statuses[i],confirmed=this.confirmed.get(r.signature);
   if(confirmed!==undefined&&(!s||s.err||s.slot!==confirmed))throw Error('Confirmed recovery signature changed or rolled back; keep the bundle and resync');
   if(s?.confirmationStatus==='finalized')continue;
   if(s?.confirmationStatus==='confirmed'&&!s.err)this.confirmed.set(r.signature,s.slot);
   if(!s&&confirmed===undefined&&height>r.lastValidBlockHeight&&height>this.earliestUnknownExpiry)continue;
   keep.push(r);
  }
  this.records=keep;return {blocked:keep.length>0,remaining:keep.length};
 }
}
