import {createSolanaRpcFromTransport,createDefaultRpcTransport,pipe,createTransactionMessage,setTransactionMessageFeePayerSigner,setTransactionMessageLifetimeUsingBlockhash,appendTransactionMessageInstructions,compileTransaction,signTransactionMessageWithSigners,getBase64EncodedWireTransaction,getSignatureFromTransaction,getPublicKeyFromAddress,verifySignature,getBase64Decoder,getBase64Encoder,isSolanaError,SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE,type Address,type Instruction,type TransactionSigner,type Signature,type TransactionMessageBytesBase64,lamports}from '@solana/kit';
import {fetchSysvarClock}from '@solana/sysvars';
import {DirectPendingJournal,type DirectPendingRecord,type DirectPendingStorage}from '../../solana-client/src/pending';
import {verifyDeployment,snapshotReleasePolicy,type TrustedReleasePolicy}from './release';
import{PROGRAM_V3,VAULT_PROGRAM,ATA_PROGRAM,LOCAL_RPC_V3}from './constants';
import{equalBytes,sha256,hex}from './codec';
import{V3SimulationError}from './errors';
import {accountBytesV3}from'./accounts';
import {createNoopSigner,signTransactionWithSigners,isTransactionPartialSigner,isTransactionModifyingSigner,signatureBytes,type Transaction}from'@solana/kit';
import {V3_MAX_SPONSORED_FEE,type FeeSponsorV3,type FeeQuoteV3,type FeeRequestScopeV3}from'./fees';
export type TransactionUpdate={stage:'preparing_fee'|'fee_unavailable'|'simulating'|'awaiting_signature'|'submitted'|'confirmed'|'finalized'|'rejected'|'expired'|'not_submitted'|'unknown_transport';signature?:Signature;feeLamports?:bigint;feePayer?:Address;sponsored?:boolean;error?:string};
export type ClientOptions={feeSponsor?:FeeSponsorV3;releasePolicies?:readonly TrustedReleasePolicy[];pendingStorage?:DirectPendingStorage;beforeSubmit?:(record:Readonly<DirectPendingRecord>)=>Promise<void>};
export type TransactionCosts=Readonly<{signature:Signature;commitment:'confirmed'|'finalized';slot:bigint;feePayer:Address;feeLamports:bigint;feePayerChangeLamports:bigint;createdAccountLamports:bigint;executed:boolean}>;
const pause=(ms:number)=>new Promise(r=>setTimeout(r,ms));
/** Internal typed-instruction transport. No secret/wire is persisted or logged. */
export class V3Transport {
 readonly rpc;readonly signer:TransactionSigner;readonly url:string;
 readonly deploymentPolicies?:readonly TrustedReleasePolicy[];
 onTransaction?:(event:TransactionUpdate)=>void;
 private context=new AbortController();private genesis?:string;private journals=new Map<Address,DirectPendingJournal>();private minSlot?:bigint;private minFinalizedSlot?:bigint;private busy=false;
 private clockOffset=0;private clockAt=0;
 private fees?:FeeSponsorV3;
 constructor(signer:TransactionSigner,url=LOCAL_RPC_V3,private options:ClientOptions={}){
  this.options={...options};
  this.setFeeSponsor(options.feeSponsor);
  const u=new URL(url);if(u.username||u.password||u.hash||!['http:','https:'].includes(u.protocol)||u.protocol==='http:'&&!['127.0.0.1','localhost','[::1]'].includes(u.hostname))throw Error('Use HTTPS or loopback RPC without credentials');
  this.signer=signer;this.url=url;this.deploymentPolicies=options.releasePolicies?.map(snapshotReleasePolicy);
  if(this.deploymentPolicies&&(this.deploymentPolicies.length!==2||!this.deploymentPolicies.some(p=>p.program===PROGRAM_V3)||!this.deploymentPolicies.some(p=>p.program===VAULT_PROGRAM)||this.deploymentPolicies[0].genesisHash!==this.deploymentPolicies[1].genesisHash))throw Error('Game and Vault release policies must name one network');
  const native=createDefaultRpcTransport({url});this.rpc=createSolanaRpcFromTransport(c=>native({...c,signal:AbortSignal.any([this.context.signal,AbortSignal.timeout(8000),...(c.signal?[c.signal]:[])])}));
 }
 cancelPendingSignatures(){this.context.abort();}
 get feeSponsor(){return this.fees;}
 setFeeSponsor(provider?:FeeSponsorV3){if(this.busy)throw Error('Finish the reviewed transaction before changing fee support');this.fees=provider?Object.freeze({feePayer:provider.feePayer,genesis:provider.genesis,quote:provider.quote.bind(provider),grant:provider.grant.bind(provider)}):undefined;}
 chainNow(){return Math.floor((Date.now()+this.clockOffset)/1000);}
 protected async syncClock(slot:bigint){if(Date.now()-this.clockAt<1000)return;const clock=await fetchSysvarClock(this.rpc,{commitment:'confirmed',minContextSlot:slot});this.context.signal.throwIfAborted();this.clockOffset=Number(clock.unixTimestamp)*1000-Date.now();this.clockAt=Date.now();}
 protected noteSlot(slot:bigint){if(this.minSlot===undefined||slot>this.minSlot)this.minSlot=slot;}
 protected noteFinalizedSlot(slot:bigint){if(this.minFinalizedSlot===undefined||slot>this.minFinalizedSlot)this.minFinalizedSlot=slot;this.noteSlot(slot);}
 protected get minimumSlot(){return this.minSlot;}
 protected get minimumFinalizedSlot(){return this.minFinalizedSlot;}
 protected async validateBeforeTransport(_match:Address,_instructions:readonly Instruction[]){}
 private async verifyRelease(){this.context.signal.throwIfAborted();if(!this.deploymentPolicies){if(!['127.0.0.1','localhost','[::1]'].includes(new URL(this.url).hostname))throw Error('Public signing requires explicit reviewed Game and Vault release policies');return;}for(const p of this.deploymentPolicies)await verifyDeployment(this.rpc,p,{abortSignal:this.context.signal});this.context.signal.throwIfAborted();}
 private async journal(program:Address){const now=await this.rpc.getGenesisHash().send();if(this.genesis&&this.genesis!==now)throw Error('RPC network changed; pending context is preserved');this.genesis=now;let journal=this.journals.get(program);if(!journal){journal=new DirectPendingJournal({program,actor:this.signer.address,genesis:now,storage:this.options.pendingStorage});this.journals.set(program,journal);}return journal;}
 async pending(match:Address){const result:DirectPendingRecord[]=[];for(const program of [PROGRAM_V3,VAULT_PROGRAM])result.push(...(await this.journal(program)).list().filter(r=>r.match===match));return result;}
 /** Observed network fee and new account deposits are separate from TEST-USDC amounts.
  * `createdAccountLamports` is an observed deposit, not an asserted refundable-rent promise.
  * A null result is missing RPC history, never proof that the action cost zero.
  */
 async readTransactionCosts(signature:Signature,commitment:'confirmed'|'finalized'='finalized'):Promise<TransactionCosts|null>{
  const tx=await this.rpc.getTransaction(signature,{encoding:'json',commitment,maxSupportedTransactionVersion:0}).send();if(!tx||!tx.meta)return null;
  const keys=[...tx.transaction.message.accountKeys,...(tx.meta.loadedAddresses?.writable??[]),...(tx.meta.loadedAddresses?.readonly??[])],pre=tx.meta.preBalances,post=tx.meta.postBalances;
  if(tx.transaction.signatures[0]!==signature||!keys.length||pre.length!==keys.length||post.length!==keys.length||typeof tx.meta.fee!=='bigint'||tx.meta.fee<0n||typeof tx.slot!=='bigint'||pre.some(v=>typeof v!=='bigint'||v<0n)||post.some(v=>typeof v!=='bigint'||v<0n))throw Error('Invalid observed transaction cost metadata');
  const deposits=pre.reduce((sum,before,i)=>sum+(i!==0&&before===0n&&post[i]>0n?post[i]:0n),0n);
  return Object.freeze({signature,commitment,slot:tx.slot,feePayer:keys[0],feeLamports:tx.meta.fee,feePayerChangeLamports:post[0]-pre[0],createdAccountLamports:deposits,executed:tx.meta.err===null});
 }
 async reconcilePending(match:Address){
  const result:{signature:Signature;stage:string}[]=[];
  for(const program of [PROGRAM_V3,VAULT_PROGRAM]){const journal=await this.journal(program);for(const r of journal.list().filter(r=>r.match===match)){
   const status=(await this.rpc.getSignatureStatuses([r.signature],{searchTransactionHistory:true}).send()).value[0];
   if(status?.confirmationStatus==='finalized'){
    if(status.err&&r.status==='confirmed')throw Error('Previously confirmed transaction contradicted finalized result; resync required');
    journal.clear(match,r.signature,{status:'finalized'});if(!status.err)this.noteFinalizedSlot(status.slot);
    const stage=status.err?'rejected':'finalized';this.onTransaction?.({stage,signature:r.signature,feeLamports:r.feeLamports});result.push({signature:r.signature,stage});continue;
   }
   if(r.status==='confirmed'){
    if(!status||status.err||status.confirmationStatus!=='confirmed'||status.slot!==r.confirmedSlot)throw Error(`Confirmed state rolled back or changed: ${r.signature}`);this.onTransaction?.({stage:'confirmed',signature:r.signature,feeLamports:r.feeLamports});result.push({signature:r.signature,stage:'confirmed'});continue;
   }
   if(status?.confirmationStatus==='confirmed'&&!status.err){journal.markConfirmed(match,r.signature,status.slot);this.noteSlot(status.slot);this.onTransaction?.({stage:'confirmed',signature:r.signature,feeLamports:r.feeLamports});result.push({signature:r.signature,stage:'confirmed'});continue;}
   if(status?.err){if(r.status==='pending')journal.markRejected(match,r.signature,{reason:'program_error',slot:status.slot});this.onTransaction?.({stage:'rejected',signature:r.signature,feeLamports:r.feeLamports});result.push({signature:r.signature,stage:'rejected'});continue;}
   const height=await this.rpc.getBlockHeight({commitment:'finalized'}).send();
   if(height>r.lastValidBlockHeight){journal.clear(match,r.signature,{status:'expired',blockHeight:height});this.onTransaction?.({stage:'expired',signature:r.signature,feeLamports:r.feeLamports});result.push({signature:r.signature,stage:'expired'});}else {this.onTransaction?.({stage:'unknown_transport',signature:r.signature,feeLamports:r.feeLamports});result.push({signature:r.signature,stage:'unknown_transport'});}
  }}return result;
 }
 protected async sendTyped(match:Address,instructions:readonly Instruction[]){
  if(this.busy)throw Error('Another reviewed action is awaiting a signature');this.busy=true;const payment={feePayer:this.fees?.feePayer??this.signer.address,sponsored:!!this.fees};const notify=(event:TransactionUpdate)=>this.onTransaction?.({...payment,...event});
  try{
   const ix:Instruction[]=instructions.map(i=>({...i,data:i.data?Uint8Array.from(i.data):undefined,accounts:i.accounts?.map(a=>{
    const{signer:ignored,...meta}=a as typeof a&{signer?:TransactionSigner};if(a.role&2){if(a.address!==this.signer.address)throw Error('Unexpected signer in V3 action');return {...meta,signer:this.signer};}return meta;
   })}));
   if(ix.length<1||ix.length>3||ix.some(i=>!([PROGRAM_V3,VAULT_PROGRAM,ATA_PROGRAM] as Address[]).includes(i.programAddress)))throw Error('Only typed V3 actions are permitted');
   const primary=ix.find(i=>i.programAddress!==ATA_PROGRAM);if(!primary)throw Error('Missing V3 action');
   await this.verifyRelease();await this.reconcilePending(match);
   const journal=await this.journal(primary.programAddress);if((await this.pending(match)).some(r=>r.status==='pending'||r.status==='rejected'&&r.rejectedReason==='program_error'))throw Error('Unknown previous transaction; reconcile without resigning');
   const sponsor=this.fees;let quote:FeeQuoteV3|undefined;const scope:FeeRequestScopeV3={match,actor:this.signer.address,program:primary.programAddress,genesis:this.genesis!,abortSignal:this.context.signal};
   let lifetime=(await this.rpc.getLatestBlockhash({commitment:'confirmed'}).send()).value;
   if(sponsor){
    notify({stage:'preparing_fee',feePayer:sponsor.feePayer,sponsored:true});
    await this.validateBeforeTransport(match,ix);this.context.signal.throwIfAborted();
    if(sponsor.genesis!==this.genesis||sponsor.feePayer===this.signer.address)throw Error('Fee support has a different network or actor');
    try{quote=await sponsor.quote(scope);}catch(e){notify({stage:'fee_unavailable',sponsored:true,error:'Fee support unavailable. Choose self-pay explicitly; no actor signature requested.'});throw e;}
    if(quote.genesis!==this.genesis||quote.feePayer!==sponsor.feePayer)throw Error('Fee quote changed network or payer');
    const valid=await this.rpc.isBlockhashValid(quote.blockhash,{commitment:'confirmed'}).send();if(!valid.value)throw Error('Fee quote blockhash expired');
    // Our own newer bank supplies a conservative expiry bound, not an untrusted small service height.
    const trusted=await this.rpc.getLatestBlockhash({commitment:'confirmed',minContextSlot:valid.context.slot}).send();
    lifetime={blockhash:quote.blockhash,lastValidBlockHeight:trusted.value.lastValidBlockHeight};
   }
   notify({stage:'simulating',...(sponsor?{feePayer:sponsor.feePayer,sponsored:true}:{})});
   const message=pipe(createTransactionMessage({version:0}),m=>setTransactionMessageFeePayerSigner(sponsor?createNoopSigner(sponsor.feePayer):this.signer,m),m=>setTransactionMessageLifetimeUsingBlockhash(lifetime,m),m=>appendTransactionMessageInstructions(ix,m));
   const unsigned=compileTransaction(message),frozen=Uint8Array.from(unsigned.messageBytes);
   await this.validateBeforeTransport(match,ix);
   const sim=await this.rpc.simulateTransaction(getBase64EncodedWireTransaction(unsigned),{encoding:'base64',sigVerify:false,commitment:'confirmed',...(this.minSlot?{minContextSlot:this.minSlot}:{})}).send();
   if(sim.value.err){const error=new V3SimulationError(sim.value.err,ix,sim.value.logs);notify({stage:'rejected',error:error.message});throw error;}
   const fee=(await this.rpc.getFeeForMessage(getBase64Decoder().decode(unsigned.messageBytes) as TransactionMessageBytesBase64,{commitment:'confirmed'}).send()).value;
   if(fee===null)throw Error('Blockhash expired before signing');this.context.signal.throwIfAborted();
   let sponsoredSignature:Uint8Array|undefined;
   if(sponsor&&quote){
    if(fee>V3_MAX_SPONSORED_FEE)throw Error('Sponsored fee exceeds the reviewed limit');
    await this.validateBeforeTransport(match,ix);await this.journal(primary.programAddress);this.context.signal.throwIfAborted();
    let grant;try{grant=await sponsor.grant(quote,{...unsigned,messageBytes:Uint8Array.from(unsigned.messageBytes) as unknown as typeof unsigned.messageBytes,signatures:{...unsigned.signatures}},scope);}catch(e){notify({stage:'fee_unavailable',feePayer:sponsor.feePayer,sponsored:true,error:'Fee grant unavailable. No actor signature requested; choose self-pay explicitly.'});throw e;}
    if(grant.feePayer!==sponsor.feePayer||grant.feeLamports!==fee||grant.messageHash!==hex(await sha256(frozen))||grant.signature.length!==64||!await verifySignature(await getPublicKeyFromAddress(sponsor.feePayer),signatureBytes(grant.signature),frozen))throw Error('Invalid fee grant signature or message');
    sponsoredSignature=Uint8Array.from(grant.signature);await this.verifyRelease();await this.journal(primary.programAddress);await this.validateBeforeTransport(match,ix);this.context.signal.throwIfAborted();
   }
   notify({stage:'awaiting_signature',feeLamports:fee,...(sponsor?{feePayer:sponsor.feePayer,sponsored:true}:{})});
   let signed;
   try{
    if(sponsor&&sponsoredSignature){
     if(!isTransactionPartialSigner(this.signer)&&!isTransactionModifyingSigner(this.signer))throw Error('Wallet cannot sign a sponsored transaction');
     const partial={...unsigned,signatures:{[sponsor.feePayer]:signatureBytes(sponsoredSignature),[this.signer.address]:null}};
     signed=await signTransactionWithSigners([this.signer],partial,{abortSignal:this.context.signal});
     if(Object.keys(signed.signatures).length!==2||!signed.signatures[sponsor.feePayer]||!equalBytes(signed.signatures[sponsor.feePayer]!,sponsoredSignature)||!await verifySignature(await getPublicKeyFromAddress(sponsor.feePayer),signed.signatures[sponsor.feePayer]!,signed.messageBytes))throw Error('Wallet removed or altered the fee signature');
     // Wire encoder and first-signature lookup use map insertion order. Keep frozen header order.
     signed={...signed,signatures:{[sponsor.feePayer]:signed.signatures[sponsor.feePayer],[this.signer.address]:signed.signatures[this.signer.address]}};
    }else signed=await signTransactionMessageWithSigners(message);
   }catch(e){notify({stage:'rejected',feeLamports:fee,error:'Wallet rejected or could not sign the reviewed action'});throw e;}
   if(!equalBytes(signed.messageBytes,frozen)||!signed.signatures[this.signer.address]||!await verifySignature(await getPublicKeyFromAddress(this.signer.address),signed.signatures[this.signer.address]!,signed.messageBytes))throw Error('Wallet altered the message or returned an invalid signature');
   this.context.signal.throwIfAborted();await this.verifyRelease();await this.journal(primary.programAddress);await this.validateBeforeTransport(match,ix);this.context.signal.throwIfAborted();
   const signature=getSignatureFromTransaction(signed),intentHash=hex(await sha256(frozen));
   const record=journal.remember({program:primary.programAddress,genesis:this.genesis!,actor:this.signer.address,match,signature,intentHash,lastValidBlockHeight:lifetime.lastValidBlockHeight,feeLamports:fee,createdAt:Date.now()});
   // A durable backend lease may persist these public fields before publication.
   // Hook failures are local non-submission, not invented RPC preflight rejection.
   // Preserve the journal until proved expiry: a new signature must not silently replace it.
   try{if(this.options.beforeSubmit)await this.options.beforeSubmit(Object.freeze({...record}));this.context.signal.throwIfAborted();await this.verifyRelease();await this.journal(primary.programAddress);await this.validateBeforeTransport(match,ix);this.context.signal.throwIfAborted();}
   catch(e){notify({stage:'not_submitted',signature,feeLamports:fee,error:'Signed action was not published; reconcile the saved signature before signing again'});throw e;}
   notify({stage:'submitted',signature,feeLamports:fee});
   try{const ack=await this.rpc.sendTransaction(getBase64EncodedWireTransaction(signed),{encoding:'base64',skipPreflight:false,preflightCommitment:'confirmed'}).send();if(ack!==signature)notify({stage:'unknown_transport',signature,feeLamports:fee});}
   catch(e){if(isSolanaError(e,SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE)){journal.markRejected(match,signature,{reason:'preflight'});notify({stage:'rejected',signature,feeLamports:fee});throw e;}notify({stage:'unknown_transport',signature,feeLamports:fee});}
   for(let i=0;i<60;i++){
    this.context.signal.throwIfAborted();await pause(500);
    try{const s=(await this.rpc.getSignatureStatuses([signature],{searchTransactionHistory:true}).send()).value[0];if(s?.err){journal.markRejected(match,signature,{reason:'program_error',slot:s.slot});notify({stage:'rejected',signature,feeLamports:fee});throw Error('V3 program rejected transaction');}if(s?.confirmationStatus==='confirmed'||s?.confirmationStatus==='finalized'){this.noteSlot(s.slot);if(s.confirmationStatus==='finalized'){this.noteFinalizedSlot(s.slot);journal.clear(match,signature,{status:'finalized'});}else journal.markConfirmed(match,signature,s.slot);notify({stage:s.confirmationStatus,signature,feeLamports:fee});return signature;}}
    catch(e){if(journal.list().find(r=>r.signature===record.signature)?.status==='rejected')throw e;}
   }
   notify({stage:'unknown_transport',signature,feeLamports:fee});throw Error(`Confirmation unknown; do not sign again: ${signature}`);
  }catch(e){this.context.signal.throwIfAborted();throw e;}finally{this.busy=false;}
 }
 async fundLocal(){if(!['127.0.0.1','localhost'].includes(new URL(this.url).hostname))throw Error('Local fixture funding is loopback-only');const signature=await this.rpc.requestAirdrop(this.signer.address,lamports(2_000_000_000n),{commitment:'confirmed'}).send();for(let i=0;i<40;i++){const s=(await this.rpc.getSignatureStatuses([signature]).send()).value[0];if(s?.err)throw Error('Local faucet rejected fixture');if(s?.confirmationStatus==='confirmed'||s?.confirmationStatus==='finalized')return;await pause(250);}throw Error('Local fixture faucet confirmation unknown');}
 protected accountData(value:unknown,owner:Address,bytes?:number){return accountBytesV3(value,owner,bytes);}
}
