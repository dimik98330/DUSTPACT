import {test} from 'node:test';
import assert from 'node:assert/strict';
import {getAddressEncoder,getProgramDerivedAddress,generateKeyPairSigner,type Address,type TransactionSigner} from '@solana/kit';
import {createServer} from 'node:http';
import type {AddressInfo} from 'node:net';
import {verifyDeployment,UPGRADEABLE_LOADER,type TrustedReleasePolicy,type ReleaseRpc} from '../src/release';
import {V2Transport} from '../src/transport';
import {PROGRAM_V2,VAULT_PROGRAM,SYSTEM} from '../src/constants';
import {hex,sha256} from '../src/codec';

async function deployment(program:Address,immutable:boolean){
 const binary=new Uint8Array(1000).fill(program===PROGRAM_V2?7:9),[programData]=await getProgramDerivedAddress({programAddress:UPGRADEABLE_LOADER,seeds:[getAddressEncoder().encode(program)]}),p=new Uint8Array(36),d=new Uint8Array(45+binary.length);
 new DataView(p.buffer).setUint32(0,2,true);p.set(getAddressEncoder().encode(programData),4);new DataView(d.buffer).setUint32(0,3,true);new DataView(d.buffer).setBigUint64(4,5n,true);d[12]=immutable?0:1;d.set(getAddressEncoder().encode(SYSTEM),13);d.set(binary,45);
 const policy:TrustedReleasePolicy={version:2,program,genesisHash:SYSTEM,sbfSha256:hex(await sha256(binary)),executableBytes:1000,upgradeAuthority:immutable?{kind:'immutable'}:{kind:'address',address:SYSTEM}};
 return {policy,programData,p,d};
}
function account(data:Uint8Array,executable:boolean){return{owner:UPGRADEABLE_LOADER,executable,lamports:1n,data:[Buffer.from(data).toString('base64'),'base64']};}
test('Both V2 programs distinguish immutable None from present System upgrade authority',async()=>{
 for(const program of[PROGRAM_V2,VAULT_PROGRAM])for(const immutable of[true,false]){const f=await deployment(program,immutable),rpc={getGenesisHash:()=>({send:async()=>SYSTEM}),getMultipleAccounts:()=>({send:async()=>({context:{slot:10n},value:[account(f.p,true),account(f.d,false)]})})} as unknown as ReleaseRpc;
  const result=await verifyDeployment(rpc,f.policy);assert.equal(result.immutable,immutable);assert.equal(result.upgradeAuthority,immutable?null:SYSTEM);assert.equal(result.sbfSha256,f.policy.sbfSha256);
  if(!immutable)await assert.rejects(verifyDeployment(rpc,{...f.policy,upgradeAuthority:{kind:'immutable'}}),/authority/i);
 }
});
test('Policy mismatch in genesis, exact binary or program metadata rejects verification',async()=>{
 const f=await deployment(VAULT_PROGRAM,false);let mode:'genesis'|'binary'|'metadata'='genesis';
 const rpc={getGenesisHash:()=>({send:async()=>mode==='genesis'?PROGRAM_V2:SYSTEM}),getMultipleAccounts:()=>({send:async()=>{const p=f.p.slice(),d=f.d.slice();if(mode==='binary')d[d.length-1]^=1;if(mode==='metadata')p[0]=3;return{context:{slot:10n},value:[account(p,true),account(d,false)]};}})} as unknown as ReleaseRpc;
 for(const next of ['genesis','binary','metadata'] as const){mode=next;await assert.rejects(verifyDeployment(rpc,f.policy));}
});
test('Constructor requires both fixed programs on one genesis and snapshots policy list',async()=>{
 const a=await deployment(PROGRAM_V2,false),b=await deployment(VAULT_PROGRAM,false),signer=await generateKeyPairSigner();assert.throws(()=>new V2Transport(signer,undefined,{releasePolicies:[a.policy]}),/Game and Vault/);assert.throws(()=>new V2Transport(signer,undefined,{releasePolicies:[a.policy,{...b.policy,genesisHash:PROGRAM_V2}]}),/one network/);
 const policies=[a.policy,b.policy],c=new V2Transport(signer,undefined,{releasePolicies:policies});policies.splice(0);assert.equal(c.deploymentPolicies?.length,2);
});
class ActionClient extends V2Transport{async sendFixture(){return this.sendTyped(SYSTEM,[{programAddress:PROGRAM_V2,accounts:[{address:SYSTEM,role:1},{address:this.signer.address,role:2}],data:Uint8Array.of(1)}]);}}
test('Vault binary change during wallet approval prevents any native send',async()=>{
 const game=await deployment(PROGRAM_V2,false),vault=await deployment(VAULT_PROGRAM,false);let changed=false,signatures=0,sends=0;
 const server=createServer(async(req,res)=>{const chunks:Buffer[]=[];for await(const c of req)chunks.push(Buffer.from(c));const r=JSON.parse(Buffer.concat(chunks).toString());let result:unknown=null;
  if(r.method==='getGenesisHash')result=SYSTEM;
  else if(r.method==='getMultipleAccounts'){const f=r.params[0][0]===PROGRAM_V2?game:vault,d=f.d.slice();if(changed&&f===vault)d[d.length-1]^=1;result={context:{slot:10},value:[account(f.p,true),account(d,false)].map(a=>({...a,lamports:1}))};}
  else if(r.method==='getLatestBlockhash')result={context:{slot:10},value:{blockhash:SYSTEM,lastValidBlockHeight:1000}};
  else if(r.method==='simulateTransaction')result={context:{slot:10},value:{err:null,logs:[],unitsConsumed:1000,returnData:null,accounts:null}};
  else if(r.method==='getFeeForMessage')result={context:{slot:10},value:5000};
  else if(r.method==='sendTransaction')sends++;
  res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({jsonrpc:'2.0',id:r.id,result}));
 });await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const native=await generateKeyPairSigner(),signer:TransactionSigner={address:native.address,signTransactions:async(t,c)=>{signatures++;const result=await native.signTransactions(t,c);changed=true;return result;}},client=new ActionClient(signer,`http://127.0.0.1:${(server.address() as AddressInfo).port}`,{releasePolicies:[game.policy,vault.policy]});
 try{await assert.rejects(client.sendFixture(),/release|бинарник/i);assert.equal(signatures,1);assert.equal(sends,0);assert.equal((await client.pending(SYSTEM)).length,0);}finally{await new Promise<void>((r,j)=>server.close(e=>e?j(e):r()));}
});
