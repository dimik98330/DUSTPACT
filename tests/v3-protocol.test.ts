import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {address,getBase58Decoder,signature} from '@solana/kit';
import {decodeGameV3,prepareMove,validateMove,privateMoveEnvelope,verifyPrivateMoveCopy,verifyPrivateBackupCandidate,verifyRecoveryBundle,recoveryBundle,PROGRAM_V3,SYSTEM,type GameV3} from '../packages/solana-v3/src/index';
import {decodeGameV2} from '../packages/solana-v2/src/decode';
import {loadV3Kernel} from '../packages/engine/src/v3';
import {verifyV3History} from '../packages/engine/src/v3-replay';
import type {DirectPendingRecord} from '../packages/solana-client/src/pending';
await loadV3Kernel(Uint8Array.from(await readFile('apps/web/public/engine/rules-v3.wasm')).buffer);
for(const n of [4,5,6])test(`protocol3 decodes and independently replays actual SBF campaign N${n}`,async()=>{
 const bytes=await readFile(`tests/fixtures/native/v3/program/replay/v2-native-n${n}.bin`),g=await decodeGameV3(bytes);
 assert.equal(bytes.length,4500);assert.equal(g.count,n);assert.equal(g.arrived,true);
 assert.equal((await verifyV3History(g)).valid,true);assert.equal((await verifyV3History(g)).checkedStages,6);
 assert.equal(g.history[5].deliveries.every((q,i)=>q===g.history[5].pledged[i]+g.history[5].voluntary[i]),true);
});
const before=await decodeGameV3(await readFile('tests/fixtures/native/v3/program/replay/work-before.bin'));
const after=await decodeGameV3(await readFile('tests/fixtures/native/v3/program/replay/work-after.bin'));
const vector=JSON.parse(await readFile('tests/fixtures/native/v3/program/replay/work-context.json','utf8'));
const match=address(vector.match),scope=(game:GameV3)=>({game,match,genesis:SYSTEM as string,seat:3});
test('SDK commitment/work context agrees byte for byte with new native Rust',async()=>{
 const old=await prepareMove(match,before,3,{action:5,route:0,delivery:1},Uint8Array.from(vector.salt));
 const current=await prepareMove(match,after,3,{action:5,route:0,delivery:1},Uint8Array.from(vector.salt));
 assert.deepEqual(Array.from(old.commitment),vector.beforeCommitment);assert.deepEqual(Array.from(current.commitment),vector.afterCommitment);
 assert.deepEqual(Array.from(old.workContext),vector.beforeWork);assert.deepEqual(Array.from(current.workContext),vector.afterWork);assert.notDeepEqual(old.commitment,current.commitment);
});
test('a pact changes meaning even with same Deliver action; old private bytes remain recoverable',async()=>{
 const old=await prepareMove(match,before,3,{action:5,route:0,delivery:1},Uint8Array.from(vector.salt));const json=JSON.stringify(privateMoveEnvelope(old,SYSTEM));
 await assert.rejects(()=>verifyPrivateMoveCopy(json,scope(after)));
 const retained=await verifyPrivateBackupCandidate(json,scope(after));assert.deepEqual(retained.commitment,old.commitment);
 const current=await prepareMove(match,after,3,{action:5,route:0,delivery:1},Uint8Array.from(vector.salt));assert.deepEqual((await verifyPrivateMoveCopy(JSON.stringify(privateMoveEnvelope(current,SYSTEM)),scope(after))).workContext,current.workContext);
});
test('extra is funded from free owned cargo, not an incoming price; action/cap checks are explicit',()=>{
 validateMove(after,3,{action:5,route:0,delivery:1});assert.throws(()=>validateMove(after,3,{action:5,route:0,delivery:2}));
 assert.throws(()=>validateMove(after,3,{action:6,route:0,delivery:0}));assert.throws(()=>validateMove(after,1,{action:1,route:0,delivery:1}));
 assert.throws(()=>validateMove(after,1,{action:5,route:0,delivery:0}));
 const g=structuredClone(after);g.deals[0].gives[0]=[0,0,1];assert.throws(()=>validateMove(g,3,{action:5,route:0,delivery:2}));
});
test('old-stage recovery uses recorded work context and retains a current public pending journal',async()=>{
 // Synthetic recovery scope from native actors: this is not another played campaign.
 const old=structuredClone(after);old.stage=1;old.phase=1;old.committed=0;old.revealed=0;
 old.deals[0]={...old.deals[0],stage:1,kind:1,action:3,delivery:0,reserve:[[1,0,0],[0,1,0]]};old.seats[3].bound=3;old.seats[3].reserved=[0,1,0];
 const p=await prepareMove(match,old,3,{action:3,route:0,delivery:0});
 const next=structuredClone(before);next.stage=2;next.phase=1;next.committed=0;next.revealed=0;next.dealCount=0;next.seats[3].bound=255;next.seats[3].reserved=[0,0,0];
 const record:DirectPendingRecord={status:'pending',program:PROGRAM_V3,genesis:SYSTEM,actor:old.seats[3].owner,match,signature:signature(getBase58Decoder().decode(new Uint8Array(64).fill(7))),intentHash:'ab'.repeat(32),lastValidBlockHeight:100n,feeLamports:5000n,createdAt:Date.now()};
 const full=recoveryBundle(scope(old),p,[record]);const checked=await verifyRecoveryBundle(full,scope(next));
 assert.equal(checked.staleMove,true);assert.equal(checked.move,null);assert.equal(checked.pending.length,1);assert.equal(checked.pending[0].signature,record.signature);
 const single=await verifyRecoveryBundle(JSON.stringify(privateMoveEnvelope(p,SYSTEM)),scope(next));assert.equal(single.staleMove,true);assert.equal(single.move,null);
});
test('protocol2 account and private-copy envelopes cannot be mistaken for protocol3',async()=>{
 const old=Buffer.from((await readFile('tests/fixtures/protocol3/legacy-game2.hex','utf8')).trim(),'hex'),current=await readFile('tests/fixtures/native/v3/program/replay/v2-native-n4.bin');
 await assert.rejects(()=>decodeGameV3(old));await assert.rejects(()=>decodeGameV2(current));
 const p=await prepareMove(match,after,3,{action:5,route:0,delivery:0});const copy={...privateMoveEnvelope(p,SYSTEM),version:2};await assert.rejects(()=>verifyPrivateMoveCopy(JSON.stringify(copy),scope(after)));
});
test('independent replay detects tampering with the retained pledge/extra accounting',async()=>{
 const g=await decodeGameV3(await readFile('tests/fixtures/native/v3/program/replay/v2-native-n4.bin'));g.history[5].pledged[0]=1;
 assert.equal((await verifyV3History(g)).valid,false);
});
