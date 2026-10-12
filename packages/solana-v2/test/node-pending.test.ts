import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {generateKeyPairSigner,getBase58Decoder,type Signature} from '@solana/kit';
import {DirectPendingJournal} from '../../solana-client/src/pending';
import {FilePendingStorage} from '../node-pending';
import {PROGRAM_V2,SYSTEM} from '../src/constants';
test('CLI public pending metadata survives a new client process adapter and contains no wire/preimage',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'dustpact-v2-pending-'));try{const path=join(dir,'pending.json'),actor=(await generateKeyPairSigner()).address,signature=getBase58Decoder().decode(new Uint8Array(64).fill(17)) as Signature,scope={program:PROGRAM_V2,actor,genesis:SYSTEM};
  const first=new DirectPendingJournal({...scope,storage:new FilePendingStorage(path)});first.remember({...scope,match:SYSTEM,signature,intentHash:'b'.repeat(64),lastValidBlockHeight:1000n,feeLamports:5000n,createdAt:1});
  const restored=new DirectPendingJournal({...scope,storage:new FilePendingStorage(path)});assert.equal(restored.get(SYSTEM)?.signature,signature);assert.equal(restored.get(SYSTEM)?.feeLamports,5000n);assert.doesNotMatch(readFileSync(path,'utf8'),/salt|wire|privateKey|cookie|seedPhrase/);restored.clear(SYSTEM,signature,{status:'expired',blockHeight:1001n});assert.equal(new DirectPendingJournal({...scope,storage:new FilePendingStorage(path)}).list().length,0);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('Malformed pending files are preserved and never replaced with an empty journal',()=>{
 const dir=mkdtempSync(join(tmpdir(),'dustpact-v2-pending-'));try{const path=join(dir,'pending.json');writeFileSync(path,'broken json');const storage=new FilePendingStorage(path);assert.throws(()=>storage.getItem('scope'),/malformed/);assert.throws(()=>storage.setItem('dustpact:direct-pending:v1:test','{}'),/malformed/);assert.equal(readFileSync(path,'utf8'),'broken json');}finally{rmSync(dir,{recursive:true,force:true});}
});
