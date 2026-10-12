import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {OnlineController} from './online';
import {decodeGameV2,SYSTEM} from '../../../../packages/solana-v2/src/index';

async function harness(){
 const game=await decodeGameV2(new Uint8Array(await readFile(new URL('../../../../tests/fixtures/native/v2/vault-sdk/fixtures/open-paid-offer-game.bin',import.meta.url))));
 const seat=game.seats[0];seat.session=game.seats[2].owner;seat.quota=128;seat.expires=1000n;
 let fail=true,cancelled=0,revokes=0,reconciliations=0;let records:any[]=[];let finalized:typeof game|null=game;
 const session={signer:{address:seat.session},setFeeSponsor(){},cancelPendingSignatures(){cancelled++;},async pending(){return records;},async reconcilePending(){reconciliations++;}};
 const owner={signer:{address:seat.owner},setFeeSponsor(){},chainNow:()=>0,seat:()=>0,async reconcilePending(){return [];},async read(){return game;},async readVault(){return null;},async readVaultFinalized(){return null;},async readFinalized(){return finalized;},async revokeSession(){revokes++;if(fail)throw Error('Wallet refused or ACK unknown');seat.session=SYSTEM;seat.quota=0;}};
 const connection={dispose(){}};
 const controller=new OnlineController(owner as any,SYSTEM,'local',[],{},connection as any),c=controller as any;
 c.game=game;c.session=session;c.pump=async()=>{};c.publish();
 return {controller,c,game,session,get cancelled(){return cancelled;},get reconciliations(){return reconciliations;},get revokes(){return revokes;},allow:()=>{fail=false;},records:(r:any[])=>{records=r;},finalized:(g:typeof game|null)=>{finalized=g;}};
}
test('Self-pay refusal retains paused session, reconciliation context and retry until confirmed revoke',async()=>{
 const h=await harness();assert.equal((await h.controller.disableFeeSupport!()).ok,false);
 assert.equal(h.controller.snapshot().fees?.enabled,false);assert.equal(h.controller.snapshot().sessionActive,true);assert.equal(h.controller.snapshot().sessionPaused,true);assert.equal(h.c.session,h.session);assert.equal(h.cancelled,0);
 assert.equal((await h.controller.enableSession()).ok,false,'cannot overwrite the retained key with a new session');
 assert.equal((await h.controller.refresh()).ok,true);assert.ok(h.reconciliations>0,'refresh still reconciles the retained session after refusal');
 h.allow();assert.equal((await h.controller.revokeSession()).ok,true);assert.equal(h.revokes,2);assert.equal(h.controller.snapshot().sessionActive,false);assert.equal(h.cancelled,1);assert.ok(h.reconciliations>0);
});
test('Revoked authority still retains earlier unknown/confirmed journal until reconciliation clears it',async()=>{
 const h=await harness();h.records([{status:'confirmed'}]);h.allow();assert.equal((await h.controller.revokeSession()).ok,true);
 assert.equal(h.c.session,h.session);assert.equal(h.controller.snapshot().sessionPaused,true);assert.equal(h.cancelled,0);
 h.records([]);await h.c.read();assert.equal(h.controller.snapshot().sessionActive,false);assert.equal(h.cancelled,1);
});
test('Confirmed revocation never discards a session before finalized absence; rollback can still reconcile it',async()=>{
 const h=await harness(),active=structuredClone(h.game);h.finalized(active);h.allow();assert.equal((await h.controller.revokeSession()).ok,true);
 assert.equal(h.c.session,h.session);assert.equal(h.cancelled,0);h.finalized(null);await h.c.read();assert.equal(h.c.session,h.session);
 // A confirmed bank rollback restores the old authority, but local automation stays paused.
 h.game.seats[0].session=active.seats[0].session;h.game.seats[0].quota=128;await h.c.read();assert.equal(h.c.session,h.session);assert.equal(h.controller.snapshot().sessionPaused,true);
 h.game.seats[0].session=SYSTEM;h.game.seats[0].quota=0;h.finalized(h.game);await h.c.read();assert.equal(h.controller.snapshot().sessionActive,false);assert.equal(h.cancelled,1);
});
