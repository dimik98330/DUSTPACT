import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import type {AddressInfo} from 'node:net';
import {generateKeyPairSigner,address,type TransactionSigner,type Signature} from '@solana/kit';
import {V2Transport,type ClientOptions,type TransactionUpdate} from '../src/transport';
import {PROGRAM_V2,SYSTEM} from '../src/constants';

class FixtureClient extends V2Transport {
  async fixtureSend(){return this.sendTyped(SYSTEM,[{programAddress:PROGRAM_V2,accounts:[{address:SYSTEM,role:1},{address:this.signer.address,role:2}],data:Uint8Array.of(1,2,3)}]);}
}
type Mode='normal'|'rejected-wallet'|'network-change'|'preflight-error'|'program-error'|'rollback';
/** Synthetic RPC transport only; not a deployed program or a real wallet. */
async function rpcFixture(mode:Mode='normal',options:ClientOptions={}) {
  const calls:string[]=[],events:TransactionUpdate[]=[];
  let knownSignature:Signature|undefined,submitted=false,networkChanged=false,height=10,rolledBack=false,statusOverride:unknown;
  const server=createServer(async(req,res)=>{
    const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));
    const request=JSON.parse(Buffer.concat(chunks).toString('utf8')),method=request.method;calls.push(method);
    if(method==='sendTransaction'){
      if(mode==='preflight-error'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({jsonrpc:'2.0',id:request.id,error:{code:-32002,message:'Transaction simulation failed',data:{err:{InstructionError:[0,{Custom:6000}]},logs:[],unitsConsumed:10000}}}));return;}
      submitted=true;
    }
    const status=statusOverride??(submitted&&knownSignature&&!rolledBack?{slot:2,confirmationStatus:mode==='rollback'?'confirmed':'finalized',confirmations:mode==='rollback'?1:null,err:mode==='program-error'?{InstructionError:[0,{Custom:6000}]}:null}:null);
    const result=method==='getGenesisHash'?(networkChanged?address('SysvarC1ock11111111111111111111111111111111'):SYSTEM):
      method==='getLatestBlockhash'?{context:{slot:1},value:{blockhash:SYSTEM,lastValidBlockHeight:1000}}:
      method==='simulateTransaction'?{context:{slot:1},value:{err:null,logs:[],unitsConsumed:10000,accounts:null,returnData:null}}:
      method==='getFeeForMessage'?{context:{slot:1},value:5000}:
      method==='getSignatureStatuses'?{context:{slot:2},value:[status]}:
      method==='getBlockHeight'?height:
      method==='sendTransaction'?knownSignature:null;
    res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({jsonrpc:'2.0',id:request.id,result}));
  });
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}`,native=await generateKeyPairSigner();
  let signatures=0;
  const signer:TransactionSigner={address:native.address,signTransactions:async(tx,config)=>{
    signatures++;if(mode==='rejected-wallet')throw Error('User rejected');if(mode==='network-change')networkChanged=true;return native.signTransactions(tx,config);
  }};
  const client=new FixtureClient(signer,url,options);client.onTransaction=u=>{events.push(u);if(u.signature)knownSignature=u.signature;};
  return {client,calls,events,signatures:()=>signatures,expire:()=>{height=1001;},rollback:()=>{rolledBack=true;},observe:(confirmationStatus:'processed'|'confirmed',err:unknown=null)=>{statusOverride={slot:2,confirmationStatus,confirmations:1,err};},close:()=>new Promise<void>((r,j)=>server.close(e=>e?j(e):r()))};
}
test('Rejected owner signature is reported and cannot become submitted',async()=>{
  const f=await rpcFixture('rejected-wallet');try{await assert.rejects(f.client.fixtureSend(),/User rejected/);assert.equal(f.signatures(),1);assert.equal(f.calls.filter(x=>x==='sendTransaction').length,0);assert.equal((await f.client.pending(SYSTEM)).length,0);assert.equal(f.events.at(-1)?.stage,'rejected');}finally{await f.close();}
});
test('Loopback genesis change while wallet approval waits stops publication',async()=>{
  const f=await rpcFixture('network-change');try{await assert.rejects(f.client.fixtureSend(),/RPC network changed/);assert.equal(f.signatures(),1);assert.equal(f.calls.filter(x=>x==='sendTransaction').length,0);}finally{await f.close();}
});
test('Program error is not success and its finalized rejection can be reconciled',async()=>{
  const f=await rpcFixture('program-error');try{await assert.rejects(f.client.fixtureSend(),/program rejected/);assert.equal(f.signatures(),1);assert.equal(f.events.at(-1)?.stage,'rejected');assert.equal((await f.client.pending(SYSTEM))[0].status,'rejected');const statuses=await f.client.reconcilePending(SYSTEM);assert.equal(statuses[0].stage,'rejected');assert.equal((await f.client.pending(SYSTEM)).length,0);}finally{await f.close();}
});
test('Preflight rejection has separate metadata and is never marked confirmed',async()=>{
  const f=await rpcFixture('preflight-error');try{await assert.rejects(f.client.fixtureSend());assert.equal(f.events.at(-1)?.stage,'rejected');const records=await f.client.pending(SYSTEM);assert.equal(records[0].status,'rejected');assert.equal(records[0].status==='rejected'&&records[0].rejectedReason,'preflight');assert.ok(!f.events.some(e=>e.stage==='confirmed'||e.stage==='finalized'));}finally{await f.close();}
});
test('Confirmed transaction disappearing retains proof and blocks fresh signing',async()=>{
  const f=await rpcFixture('rollback');try{await f.client.fixtureSend();assert.equal((await f.client.pending(SYSTEM))[0].status,'confirmed');f.rollback();await assert.rejects(f.client.reconcilePending(SYSTEM),/rolled back/);await assert.rejects(f.client.fixtureSend(),/rolled back/);assert.equal(f.signatures(),1);assert.equal((await f.client.pending(SYSTEM))[0].status,'confirmed');}finally{await f.close();}
});
test('Durable public metadata hook is awaited before native send',async()=>{
  let enter!:()=>void,release!:()=>void,metadata:Readonly<Record<string,unknown>>|undefined;
  const entered=new Promise<void>(r=>{enter=r;}),released=new Promise<void>(r=>{release=r;});
  const f=await rpcFixture('normal',{beforeSubmit:async record=>{metadata=record;assert.ok(Object.isFrozen(record));enter();await released;}});
  try{const sending=f.client.fixtureSend();await entered;assert.equal(f.calls.filter(x=>x==='sendTransaction').length,0);assert.equal((await f.client.pending(SYSTEM))[0].signature,metadata!.signature);assert.deepEqual(Object.keys(metadata!).sort(),['actor','createdAt','feeLamports','genesis','intentHash','lastValidBlockHeight','match','program','signature','status']);release();await sending;assert.equal(f.calls.filter(x=>x==='sendTransaction').length,1);}finally{release();await f.close();}
});
test('Hook failure is non-submission, no send and no replacement until proved expiry',async()=>{
  const f=await rpcFixture('normal',{beforeSubmit:async()=>{throw Error('Durable lease unavailable');}});
  try{await assert.rejects(f.client.fixtureSend(),/lease unavailable/);assert.equal(f.events.at(-1)?.stage,'not_submitted');assert.equal(f.calls.filter(x=>x==='sendTransaction').length,0);assert.equal((await f.client.pending(SYSTEM))[0].status,'pending');await assert.rejects(f.client.fixtureSend(),/Unknown previous transaction/);assert.equal(f.signatures(),1);f.expire();assert.equal((await f.client.reconcilePending(SYSTEM))[0].stage,'expired');assert.equal(f.events.at(-1)?.stage,'expired');assert.equal((await f.client.pending(SYSTEM)).length,0);}finally{await f.close();}
});
test('Reconciliation publishes confirmed and processed rejection transitions to a previously unknown UI',async()=>{
 for(const expected of ['confirmed','rejected'] as const){const f=await rpcFixture('normal',{beforeSubmit:async()=>{throw Error('Fixture hold');}});
  try{await assert.rejects(f.client.fixtureSend());f.observe(expected==='confirmed'?'confirmed':'processed',expected==='rejected'?{InstructionError:[0,{Custom:6000}]}:null);assert.equal((await f.client.reconcilePending(SYSTEM))[0].stage,expected);assert.equal(f.events.at(-1)?.stage,expected);assert.equal(f.events.at(-1)?.signature,(await f.client.pending(SYSTEM))[0].signature);assert.equal(f.events.at(-1)?.feeLamports,5000n);assert.equal(f.signatures(),1);assert.equal(f.calls.filter(x=>x==='sendTransaction').length,0);}
  finally{await f.close();}
 }
});
test('Context cancellation while durable hook waits cannot publish approved bytes',async()=>{
  let f:Awaited<ReturnType<typeof rpcFixture>>;f=await rpcFixture('normal',{beforeSubmit:async()=>{f.client.cancelPendingSignatures();}});
  try{await assert.rejects(f.client.fixtureSend());assert.equal(f.calls.filter(x=>x==='sendTransaction').length,0);assert.equal(f.events.at(-1)?.stage,'not_submitted');}finally{await f.close();}
});
