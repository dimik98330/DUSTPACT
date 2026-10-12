import{test}from'node:test';import assert from'node:assert/strict';import{createServer}from'node:http';import type{AddressInfo}from'node:net';
import{generateKeyPairSigner,getSignatureFromTransaction,signTransactionWithSigners,signatureBytes,getTransactionDecoder,getBase64Encoder,blockhash,type TransactionSigner,type Signature}from'@solana/kit';
import{V2Transport}from'../src/transport';import{PROGRAM_V2,SYSTEM}from'../src/constants';import{sha256,hex}from'../src/codec';import type{FeeSponsorV2}from'../src/fees';
class Client extends V2Transport{send(){return this.sendTyped(SYSTEM,[{programAddress:PROGRAM_V2,accounts:[{address:SYSTEM,role:1},{address:this.signer.address,role:2}],data:Uint8Array.of(1,2,3)}]);}}
async function fixture(mode:'normal'|'lost-grant'|'reorder'|'bad-grant'|'wallet-modified'|'send-ack'='normal'){
 const actor=await generateKeyPairSigner(),payer=await generateKeyPairSigner();let actorCalls=0,sends=0,submitted:Signature|undefined,grant=false;const sequence:string[]=[],events:any[]=[],calls:any[]=[];
 const server=createServer(async(req,res)=>{let data='';for await(const c of req)data+=c;const q=JSON.parse(data);calls.push(q);let result:any=null;
  if(q.method==='getGenesisHash')result=SYSTEM;
  if(q.method==='getLatestBlockhash')result={context:{slot:10},value:{blockhash:SYSTEM,lastValidBlockHeight:200}};
  if(q.method==='isBlockhashValid')result={context:{slot:9},value:true};
  if(q.method==='simulateTransaction')result={context:{slot:10},value:{err:null,logs:[],unitsConsumed:1000}};
  if(q.method==='getFeeForMessage')result={context:{slot:10},value:10000};
  if(q.method==='getBlockHeight')result=10;
  if(q.method==='getSignatureStatuses')result={context:{slot:10},value:[submitted?{slot:10,confirmationStatus:'finalized',confirmations:null,err:null}:null]};
  if(q.method==='sendTransaction'){sends++;const tx=getTransactionDecoder().decode(getBase64Encoder().encode(q.params[0]));submitted=getSignatureFromTransaction(tx);if(mode==='send-ack'){req.socket.destroy();return;}result=submitted;}
  res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({jsonrpc:'2.0',id:q.id,result}));
 });await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const provider:FeeSponsorV2={feePayer:payer.address,genesis:SYSTEM,quote:async()=>({id:'quote',feePayer:payer.address,genesis:SYSTEM,blockhash:blockhash(SYSTEM),lastValidBlockHeight:1n}),grant:async(_q,tx)=>{sequence.push('grant');if(mode==='lost-grant')throw Error('grant ACK lost');grant=true;const[s]=await payer.signTransactions([tx as any]);const signature=Uint8Array.from(s[payer.address]!);if(mode==='bad-grant')signature[0]^=1;return{feePayer:payer.address,signature,messageHash:hex(await sha256(Uint8Array.from(tx.messageBytes))),feeLamports:10000n};}};
 const signer:TransactionSigner=mode==='reorder'||mode==='wallet-modified'?{address:actor.address,modifyAndSignTransactions:async txs=>{actorCalls++;sequence.push('actor');assert.equal(grant,true);const signed=await Promise.all(txs.map(tx=>signTransactionWithSigners([actor],tx)));return signed.map(tx=>mode==='reorder'?{...tx,signatures:{[actor.address]:tx.signatures[actor.address],[payer.address]:tx.signatures[payer.address]}}:{...tx,messageBytes:Uint8Array.from(tx.messageBytes,(b,i)=>i===5?b^1:b) as any});}}:{...actor,signTransactions:async(...args:Parameters<typeof actor.signTransactions>)=>{actorCalls++;sequence.push('actor');assert.equal(grant,true);return actor.signTransactions(...args);}};
 const client=new Client(signer,`http://127.0.0.1:${(server.address()as AddressInfo).port}`,{feeSponsor:provider});client.onTransaction=e=>events.push(e);
 return{client,actor,payer,events,sequence,calls,actorCalls:()=>actorCalls,sends:()=>sends,close:()=>new Promise<void>(r=>{client.cancelPendingSignatures();server.close(()=>r());server.closeAllConnections();})};
}
test('Grant precedes actor; wallet partial dictionary merges, sponsor first signature and trusted expiry are retained',async()=>{
 const f=await fixture();try{const signature=await f.client.send();assert.equal(f.actorCalls(),1);assert.equal(f.sends(),1);assert.deepEqual(f.sequence,['grant','actor']);const e=f.events.find(e=>e.stage==='submitted');assert.equal(e.signature,signature);assert.equal(e.feePayer,f.payer.address);assert.equal(e.sponsored,true);const req=f.calls.filter(q=>q.method==='getLatestBlockhash').at(-1);assert.equal(req.params[0].minContextSlot,9);}finally{await f.close();}
});
for(const mode of['lost-grant','bad-grant']as const)test(`${mode}: no actor signature, submission, journal or implicit self-pay`,async()=>{const f=await fixture(mode);try{await assert.rejects(f.client.send());assert.equal(f.actorCalls(),0);assert.equal(f.sends(),0);assert.equal((await f.client.pending(SYSTEM)).length,0);}finally{await f.close();}});
test('Valid same-message wallet map reorder is normalized to the frozen fee-first header',async()=>{const f=await fixture('reorder');try{const signature=await f.client.send();assert.equal(f.sends(),1);assert.equal(f.events.find(e=>e.stage==='submitted').signature,signature);}finally{await f.close();}});
test('Modifying wallet changed bytes cannot publish fee-paid action',async()=>{const f=await fixture('wallet-modified');try{await assert.rejects(f.client.send());assert.equal(f.sends(),0);}finally{await f.close();}});
test('Actual native-send ACK loss reconciles same known fee signature without second actor signing',async()=>{const f=await fixture('send-ack');try{const sig=await f.client.send();assert.ok(sig);assert.equal(f.actorCalls(),1);assert.equal(f.sends(),1);assert.equal((await f.client.pending(SYSTEM)).length,0);assert.ok(f.events.some(e=>e.stage==='unknown_transport'));}finally{await f.close();}});
