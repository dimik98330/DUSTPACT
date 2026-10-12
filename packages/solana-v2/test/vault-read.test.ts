import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import type {AddressInfo} from 'node:net';
import {address,generateKeyPairSigner,getBase58Decoder,type Address,type Signature} from '@solana/kit';
import {V2Client,decodeGameV2,decodeMission,reviewConfig,reviewOffer,missionAddress,tokenAddress,VAULT_PROGRAM,TOKEN,SYSTEM} from '../src/index';
import {hex,Writer} from '../src/codec';

const fixtureUrl=(file:string)=>new URL(`../../../tests/fixtures/native/v2/vault-sdk/fixtures/${file}`,import.meta.url);
async function fixture(name:string){const metadata=JSON.parse(await readFile(fixtureUrl(`${name}.json`),'utf8'));return{metadata,game:new Uint8Array(await readFile(fixtureUrl(`${name}-game.bin`))),mission:new Uint8Array(await readFile(fixtureUrl(`${name}-mission.bin`))),sponsor:new Uint8Array(await readFile(fixtureUrl(`${name}-sponsor-token.bin`)))};}

test('Native SBF accepted work receipt and mission remain payable after missing reveal and campaign failure',async()=>{
 const f=await fixture('paid'),g=await decodeGameV2(f.game),m=await decodeMission(f.mission);
 assert.equal(g.phase,5);assert.equal(g.arrived,false);assert.equal(g.seats[2].forfeited,true);assert.equal(g.history[1].jobs[0].executed,true);assert.equal(g.history[1].jobs[0].owner,f.metadata.provider);
 assert.equal(m.game,f.metadata.game);assert.equal(m.sponsor,f.metadata.sponsor);assert.equal(m.slots[0].status,2);assert.equal(m.slots[0].owner,f.metadata.provider);assert.equal(m.slots[1].status,0);assert.equal((await missionAddress(m.game))[0],f.metadata.mission);
 assert.equal(hex((await reviewConfig(m.game,g)).hash),f.metadata.configHash);assert.equal(f.metadata.providerBalance,10_000_000);assert.equal(f.metadata.escrowBalance,10_000_000);
});
test('Native SBF paid plus unused refund leaves precise slot receipts and zero escrow',async()=>{
 const f=await fixture('paid-and-refunded'),m=await decodeMission(f.mission);
 assert.deepEqual(m.slots.map(s=>s.status),[2,3]);assert.equal(f.metadata.sponsorBalance,90_000_000);assert.equal(f.metadata.providerBalance,10_000_000);assert.equal(f.metadata.escrowBalance,0);
});
test('SDK hashes an actual Rust native paid proposal exactly, including reserved provider inputs',async()=>{
 const f=await fixture('open-paid-offer'),g=await decodeGameV2(f.game),review=await reviewOffer(address(f.metadata.game),g,0);
 assert.equal(hex(review.hash),f.metadata.openTermsHash);assert.equal(hex((await reviewConfig(address(f.metadata.game),g)).hash),f.metadata.configHash);
 assert.equal(review.jobSlot,0);assert.equal(review.provider,2);assert.deepEqual(review.offer.reserve,[[1,0,0],[0,1,0]]);
});
test('Mission decoder rejects discriminator, trailing data, invalid state and fake paid ownership',async()=>{
 const f=await fixture('paid');for(const change of [(b:Uint8Array)=>{b[0]^=1;},(b:Uint8Array)=>{b[150]=9;},(b:Uint8Array)=>{b.fill(0,156,188);},(b:Uint8Array)=>{b[141]=0;}]){const b=f.mission.slice();change(b);await assert.rejects(decodeMission(b));}
 await assert.rejects(decodeMission(f.mission.slice(0,-1)));await assert.rejects(decodeMission(Uint8Array.from([...f.mission,0])));
});

async function readFixture(){
 const f=await fixture('paid'),game=address(f.metadata.game),mission=address(f.metadata.mission),owner=address(f.metadata.sponsor),token=(await tokenAddress(owner))[0],calls:{method:string;params:unknown[]}[]=[];
 let mode:'valid'|'wrong-owner'|'wrong-mint'|'delegate'|'missing'='valid',costMode:'valid'|'missing'|'wrong-signature'='valid',confirmedSlot=12,finalizedSlot=12;
 const signature=getBase58Decoder().decode(new Uint8Array(64).fill(13)) as Signature;
 const server=createServer(async(req,res)=>{const chunks:Buffer[]=[];for await(const c of req)chunks.push(Buffer.from(c));const r=JSON.parse(Buffer.concat(chunks).toString()),params=r.params??[];calls.push({method:r.method,params});
  let result:unknown=null;
  if(r.method==='getAccountInfo'){
   const isMission=params[0]===mission,isGame=params[0]===game,isClock=params[0]===address('SysvarC1ock11111111111111111111111111111111'),bytes=isMission?f.mission.slice():isGame?f.game.slice():isClock?new Writer().u64(100n).i64(1000n).u64(0n).u64(0n).i64(1000n).bytes():f.sponsor.slice();if(!isMission&&mode==='wrong-mint')bytes.fill(0,0,32);if(!isMission&&mode==='delegate')bytes[72]=1;
   result={context:{slot:params[1]?.commitment==='confirmed'?confirmedSlot:finalizedSlot},value:!isMission&&mode==='missing'?null:{owner:mode==='wrong-owner'?SYSTEM:isMission?VAULT_PROGRAM:isGame?address('7Fs272UohH4jF53fwsdVk3E9t4KuDptdn6DcFyxbuARd'):isClock?address('Sysvar1111111111111111111111111111111111111'):TOKEN,data:[Buffer.from(bytes).toString('base64'),'base64'],executable:false,lamports:10_000_000,rentEpoch:0}};
  }
  if(r.method==='getTransaction'&&costMode!=='missing')result={slot:12,version:0,blockTime:null,transaction:{signatures:[costMode==='wrong-signature'?getBase58Decoder().decode(new Uint8Array(64).fill(14)):signature],message:{header:{numRequiredSignatures:1,numReadonlySignedAccounts:0,numReadonlyUnsignedAccounts:0},accountKeys:[owner,token],recentBlockhash:SYSTEM,instructions:[],addressTableLookups:[]}},meta:{err:null,fee:5000,preBalances:[10_000_000,0],postBalances:[7_955_720,2_039_280],preTokenBalances:[],postTokenBalances:[],innerInstructions:[],logMessages:[],loadedAddresses:{writable:[],readonly:[]},rewards:[],computeUnitsConsumed:10000}};
  res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({jsonrpc:'2.0',id:r.id,result}));
 });await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 return{client:new V2Client(await generateKeyPairSigner(),`http://127.0.0.1:${(server.address() as AddressInfo).port}`),game,owner,calls,signature,setMode:(v:typeof mode)=>{mode=v;},setCostMode:(v:typeof costMode)=>{costMode=v;},setSlots:(confirmed:number,finalized:number)=>{confirmedSlot=confirmed;finalizedSlot=finalized;},close:()=>new Promise<void>((r,j)=>server.close(e=>e?j(e):r()))};
}
test('readVaultFinalized requests finalized, validates owner/PDA and preserves invalidated roster receipts',async()=>{
 const f=await readFixture();try{const m=await f.client.readVaultFinalized(f.game);assert.ok(m);assert.equal(m.slots[0].status,2);assert.equal((f.calls.at(-1)!.params[1] as any).commitment??'finalized','finalized');await f.client.readVault(f.game);assert.equal((f.calls.at(-1)!.params[1] as any).commitment,'confirmed');assert.equal(f.calls.filter(c=>c.method==='getAccountInfo'&&c.params[0]===f.game).length,0,'historical mission decode does not demand a live roster pin');f.setMode('wrong-owner');await assert.rejects(f.client.readVault(f.game),/owner/);}finally{await f.close();}
});
test('Canonical token reads use bigint base units, distinguish absent ATA and reject substituted mint/delegates',async()=>{
 const f=await readFixture();try{const b=await f.client.readTokenBalance(f.owner,'finalized');assert.equal(b.amount,80_000_000n);assert.equal(b.decimals,6);assert.equal(b.exists,true);for(const mode of ['wrong-owner','wrong-mint','delegate'] as const){f.setMode(mode);await assert.rejects(f.client.readTokenBalance(f.owner));}f.setMode('missing');const absent=await f.client.readTokenBalance(f.owner);assert.equal(absent.amount,0n);assert.equal(absent.exists,false);}finally{await f.close();}
});
test('Observed SOL costs separate the network fee from account deposits and do not invent missing history',async()=>{
 const f=await readFixture();try{const c=await f.client.readTransactionCosts(f.signature);assert.ok(c);assert.equal(c.feeLamports,5000n);assert.equal(c.createdAccountLamports,2_039_280n);assert.equal(c.feePayerChangeLamports,-2_044_280n);assert.equal(c.commitment,'finalized');assert.equal(c.executed,true);f.setCostMode('missing');assert.equal(await f.client.readTransactionCosts(f.signature),null);f.setCostMode('wrong-signature');await assert.rejects(f.client.readTransactionCosts(f.signature),/metadata/);}finally{await f.close();}
});
test('Confirmed watermark 100 does not prevent legitimate finalized reads at 90 or lower future confirmed guard',async()=>{
 const f=await readFixture();try{f.setSlots(100,90);await f.client.readVault(f.game);await f.client.readFinalized(f.game);
  const gameRequest=f.calls.find(c=>c.method==='getAccountInfo'&&c.params[0]===f.game)!;assert.equal((gameRequest.params[1] as any).minContextSlot,undefined);
  await f.client.readVaultFinalized(f.game);assert.equal((f.calls.at(-1)!.params[1] as any).minContextSlot,90);
  await f.client.readTokenBalance(f.owner,'finalized');assert.equal((f.calls.at(-1)!.params[1] as any).minContextSlot,90);
  await f.client.readVault(f.game);assert.equal((f.calls.at(-1)!.params[1] as any).minContextSlot,100);
 }finally{await f.close();}
});
