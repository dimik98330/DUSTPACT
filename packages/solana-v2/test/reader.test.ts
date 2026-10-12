import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import type {AddressInfo} from 'node:net';
import {address,getAddressEncoder} from '@solana/kit';
import {getSysvarClockEncoder,SYSVAR_CLOCK_ADDRESS} from '@solana/sysvars';
import {V2Reader,assertObservationContinuity} from '../src/reader';
import {decodeGameV2} from '../src/decode';
import {PROGRAM_V2,VAULT_PROGRAM,TOKEN,SYSTEM} from '../src/constants';
import {missionAddress,tokenAddress} from '../src/addressing';
const fixture=(name:string)=>new URL(`../../../tests/fixtures/native/v2/vault-sdk/fixtures/${name}`,import.meta.url);
async function mock(){
 const metadata=JSON.parse(await readFile(fixture('paid.json'),'utf8'));
 const game=address(metadata.game),mission=(await missionAddress(game))[0],escrow=(await tokenAddress(mission))[0];
 const gameBytes=new Uint8Array(await readFile(fixture('paid-game.bin'))),missionBytes=new Uint8Array(await readFile(fixture('paid-mission.bin')));
 const tokenBytes=new Uint8Array(await readFile(fixture('paid-sponsor-token.bin')));
 tokenBytes.set(getAddressEncoder().encode(mission),32);new DataView(tokenBytes.buffer).setBigUint64(64,30_000_000n,true);
 const modes={confirmed:100,finalized:90,mission:true,token:true,genesis:SYSTEM as string,owner:PROGRAM_V2 as string,clockOwner:'Sysvar1111111111111111111111111111111111111',clockOffset:0,clockMismatchOnce:false,game:gameBytes,missionBytes,tokenBytes,delay:false};
 const calls:Array<{method:string;params:any[]}>=[];
 const account=(bytes:Uint8Array,owner:string)=>({owner,data:[Buffer.from(bytes).toString('base64'),'base64'],lamports:1_000_000,executable:false,rentEpoch:0});
 const server=createServer(async(req,res)=>{
  const chunks:Buffer[]=[];for await(const c of req)chunks.push(Buffer.from(c));const q=JSON.parse(Buffer.concat(chunks).toString());calls.push(q);
  if(modes.delay)await new Promise(r=>setTimeout(r,80));
  let result:unknown;
  if(q.method==='getGenesisHash')result=modes.genesis;
  else if(q.method==='getMultipleAccounts'){
   const slot=q.params[1].commitment==='confirmed'?modes.confirmed:modes.finalized;
   const once=modes.clockMismatchOnce;modes.clockMismatchOnce=false;
   const clock=getSysvarClockEncoder().encode({slot:BigInt(slot+modes.clockOffset-(once?1:0)),epochStartTimestamp:1000n,epoch:0n,leaderScheduleEpoch:0n,unixTimestamp:1001n} as any);
   result={context:{slot},value:[account(modes.game,modes.owner),modes.mission?account(modes.missionBytes,VAULT_PROGRAM):null,modes.token?account(modes.tokenBytes,TOKEN):null,account(Uint8Array.from(clock),modes.clockOwner)]};
  }else {res.writeHead(500);res.end('Unexpected mutation or separate read');return;}
  res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({jsonrpc:'2.0',id:q.id,result}));
 });await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 return {reader:new V2Reader(`http://127.0.0.1:${(server.address() as AddressInfo).port}`),game,mission,escrow,modes,calls,close:()=>new Promise<void>((r,j)=>{server.close(e=>e?j(e):r());server.closeAllConnections();})};
}
test('Signerless snapshot reads all four canonical accounts once, exact bigint escrow, no actor methods',async()=>{
 const f=await mock();try{
  const o=await f.reader.read(f.game,'finalized');assert.equal(o.slot,90n);assert.equal(o.chainNow,1001n);assert.equal(o.escrowAmount,30_000_000n,'donations above original funding are legal');assert.equal(o.missionActive,true);
  assert.deepEqual(f.calls.map(q=>q.method),['getGenesisHash','getMultipleAccounts','getGenesisHash']);
  assert.deepEqual(f.calls[1].params[0],[f.game,f.mission,f.escrow,SYSVAR_CLOCK_ADDRESS]);
  for(const method of ['signer','join','create','fundLocal','accept','send','claim'])assert.equal(method in f.reader,false);
 }finally{f.reader.dispose();await f.close();}
});
test('Absent mission and precreated ATA are valid; invalidated roster preserves funded receipts',async()=>{
 const f=await mock();try{
  f.modes.mission=false;f.modes.token=false;let o=await f.reader.read(f.game);assert.equal(o.mission,null);assert.equal(o.escrowAmount,null);
  f.modes.token=true;o=await f.reader.read(f.game);assert.equal(o.mission,null);assert.equal(o.escrowAmount,30_000_000n);
  f.modes.mission=true;const bytes=f.modes.missionBytes.slice();new DataView(bytes.buffer).setUint32(73,12345,true);f.modes.missionBytes=bytes;
  o=await f.reader.read(f.game);assert.equal(o.missionActive,false);assert.equal(o.mission?.slots[0].status,2);
 }finally{f.reader.dispose();await f.close();}
});
test('Confirmed and finalized watermarks are independent; slot regression never silently updates',async()=>{
 const f=await mock();try{
  await f.reader.read(f.game,'confirmed');await f.reader.read(f.game,'finalized');
  const calls=f.calls.filter(q=>q.method==='getMultipleAccounts');assert.equal(calls[1].params[1].minContextSlot,undefined);
  await f.reader.read(f.game,'finalized');assert.equal(f.calls.filter(q=>q.method==='getMultipleAccounts').at(-1)!.params[1].minContextSlot,90);
  f.modes.confirmed=99;await assert.rejects(f.reader.read(f.game),/slot regressed/);
 }finally{f.reader.dispose();await f.close();}
});
test('transient clock mismatch retries the entire bank snapshot; a persistent mismatch stays closed',async()=>{
 const f=await mock();try{
  f.modes.clockMismatchOnce=true;assert.equal((await f.reader.read(f.game)).slot,100n);
  assert.equal(f.calls.filter(q=>q.method==='getMultipleAccounts').length,2);
  f.modes.clockOffset=-1;await assert.rejects(f.reader.read(f.game),/Clock does not match/);
  assert.equal(f.calls.filter(q=>q.method==='getMultipleAccounts').length,5,'exactly three unsuccessful read attempts, no signing');
  f.modes.clockOffset=0;f.modes.confirmed=99;await assert.rejects(f.reader.read(f.game),/slot regressed/);
 }finally{f.reader.dispose();await f.close();}
});
test('Bad Game/Clock owner, PDA/hash, missing escrow and changed token mint fail closed',async()=>{
 for(const mode of ['owner','hash','pda','clock','clock-slot','token-mint','missing-escrow'] as const){
  const f=await mock();try{
   if(mode==='owner')f.modes.owner=SYSTEM;
   if(mode==='hash'){f.modes.game=f.modes.game.slice();f.modes.game[57]^=1;}
   if(mode==='pda'){f.modes.game=f.modes.game.slice();f.modes.game[56]^=1;}
   if(mode==='clock')f.modes.clockOwner=SYSTEM;
   if(mode==='clock-slot')f.modes.clockOffset=-1;
   if(mode==='token-mint'){f.modes.tokenBytes=f.modes.tokenBytes.slice();f.modes.tokenBytes.fill(0,0,32);}
   if(mode==='missing-escrow')f.modes.token=false;
   await assert.rejects(f.reader.read(f.game));
  }finally{f.reader.dispose();await f.close();}
 }
});
test('Increasing bank slot cannot mask a game revision or retained-history rollback',async()=>{
 const f=await mock();try{
  const original=await decodeGameV2(f.modes.game),newer=f.modes.game.slice();new DataView(newer.buffer).setBigUint64(133,original.revision+10n,true);f.modes.game=newer;
  const first=await f.reader.read(f.game);first.game.revision=0n;
  f.modes.game=Uint8Array.from(await readFile(fixture('paid-game.bin')));f.modes.confirmed=101;
  await assert.rejects(f.reader.read(f.game),/revision/,'caller mutation cannot defeat internal guard');
  const h=structuredClone(original);h.revision++;h.history[0].hull=Math.max(0,h.history[0].hull-1);
  assert.throws(()=>assertObservationContinuity(original,h),/outcome changed/);
  const equalRevision=structuredClone(original);equalRevision.hull--;
  assert.throws(()=>assertObservationContinuity(original,equalRevision),/revision/);
  const final=await f.reader.read(f.game,'finalized');assert.equal(final.slot,90n,'finalized may legitimately trail a confirmed fork');
 }finally{f.reader.dispose();await f.close();}
});
test('Genesis switch and disposal abort reads without creating any identity',async()=>{
 const f=await mock();try{
  await f.reader.read(f.game);f.modes.genesis=SYSVAR_CLOCK_ADDRESS;await assert.rejects(f.reader.read(f.game),/network changed/);
  f.reader.dispose();await assert.rejects(f.reader.read(f.game),/abort/i);
 }finally{await f.close();}
});
