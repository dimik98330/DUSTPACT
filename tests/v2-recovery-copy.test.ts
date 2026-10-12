import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSigner, getBase58Decoder, type Signature } from '@solana/kit';
import { gameFixtureV2, genesisFixtureV2 } from '../services/backend/test/v2-fixtures';
import { PROGRAM_V2, prepareMove, privateMoveEnvelope, verifyPrivateMoveCopy, recoveryBundle, verifyRecoveryBundle } from '../packages/solana-v2/src/index';
import { RecoveryPendingFence } from '../packages/solana-v2/src/recovery-pending';
async function setup(){const owners=await Promise.all(Array.from({length:4},()=>generateKeyPairSigner())),{game,match}=await gameFixtureV2(owners.map(o=>o.address));game.phase=2;const scope={game,match,genesis:genesisFixtureV2,seat:0};const move=await prepareMove(match,game,0,{action:1,route:0,delivery:0});return {scope,move};}
test('private copy binds full context, commitment, byte arrays and accepted work without supplying authority',async()=>{
 const {scope,move}=await setup(),copy=privateMoveEnvelope(move,scope.genesis);
 assert.deepEqual(await verifyPrivateMoveCopy(JSON.stringify(copy),scope),move);
 for(const bad of[{...copy,genesis:'other'},{...copy,stage:1},{...copy,owner:scope.game.seats[1].owner},{...copy,action:2},{...copy,salt:[-1,...copy.salt.slice(1)]},{...copy,privateKey:'never accepted'}])await assert.rejects(verifyPrivateMoveCopy(JSON.stringify(bad),scope));
 scope.game.committed=1;scope.game.commitments[0]=Uint8Array.from(move.commitment);assert.ok(await verifyPrivateMoveCopy(JSON.stringify(copy),scope));
 scope.game.commitments[0][0]^=1;await assert.rejects(verifyPrivateMoveCopy(JSON.stringify(copy),scope));
});
test('full bundle strictly scopes public pending metadata; legacy copies are identified as move-only',async()=>{
 const {scope,move}=await setup(),signature=getBase58Decoder().decode(new Uint8Array(64).fill(7)) as Signature;
 const pending={program:PROGRAM_V2,genesis:scope.genesis,actor:scope.game.seats[0].owner,match:scope.match,signature,intentHash:'a'.repeat(64),lastValidBlockHeight:100n,feeLamports:5000n,createdAt:1,status:'pending' as const};
 const full=await verifyRecoveryBundle(recoveryBundle(scope,move,[pending]),scope);
 assert.equal(full.legacyMoveOnly,false);assert.deepEqual(full.pending,[pending]);assert.deepEqual(full.move,move);
 assert.equal((await verifyRecoveryBundle(JSON.stringify(privateMoveEnvelope(move,scope.genesis)),scope)).legacyMoveOnly,true);
 const bad=JSON.parse(recoveryBundle(scope,move,[pending]));bad.pending[0].actor=scope.game.seats[1].owner;await assert.rejects(verifyRecoveryBundle(JSON.stringify(bad),scope));
 bad.pending[0].actor=scope.game.seats[0].owner;bad.pending[0].wire='never accepted';await assert.rejects(verifyRecoveryBundle(JSON.stringify(bad),scope));
});
test('cross-origin unknown signature blocks fresh signing even with an untrusted early expiry hint',async()=>{
 const {scope}=await setup(),signature=getBase58Decoder().decode(new Uint8Array(64).fill(9)) as Signature;
 const pending={program:PROGRAM_V2,genesis:scope.genesis,actor:scope.game.seats[0].owner,match:scope.match,signature,intentHash:'b'.repeat(64),lastValidBlockHeight:1n,feeLamports:5000n,createdAt:1,status:'pending' as const};
 const fence=new RecoveryPendingFence([pending],250n);
 let height=120n,status:any=null;
 const rpc={getSignatureStatuses:()=>({send:async()=>({value:[status]})}),getBlockHeight:()=>({send:async()=>height})};
 assert.equal((await fence.reconcile(rpc as any)).blocked,true);
 height=251n;assert.equal((await fence.reconcile(rpc as any)).blocked,false);
 const second=new RecoveryPendingFence([pending],250n);status={confirmationStatus:'confirmed',slot:50n,err:null};assert.equal((await second.reconcile(rpc as any)).blocked,true);
 status=null;await assert.rejects(second.reconcile(rpc as any),/Confirmed recovery signature/);
});
