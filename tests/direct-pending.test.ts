import assert from 'node:assert/strict';
import test from 'node:test';
import {getAddressDecoder, getBase58Decoder, type Address, type Signature} from '@solana/kit';
import {DirectPendingJournal, DirectPendingJournalError, DIRECT_PENDING_LIMIT, type DirectPendingInput, type DirectPendingStorage} from '../packages/solana-client/src/pending';

function bytes(n:number, length:number) { const value=new Uint8Array(length);new DataView(value.buffer).setUint32(0,n,true);value[length-1]=7;return value; }
const address=(n:number)=>getAddressDecoder().decode(bytes(n,32));
const signature=(n:number)=>getBase58Decoder().decode(bytes(n,64)) as Signature;
const scope={program:address(1),genesis:address(2),actor:address(3)};
const match=address(4);
function record(n=1, changes:Partial<DirectPendingInput>={}):DirectPendingInput {
 return {...scope,match,signature:signature(n),intentHash:'ab'.repeat(32),lastValidBlockHeight:200n,feeLamports:5000n,createdAt:1_700_000_000_000,...changes};
}
class MemoryStorage implements DirectPendingStorage {
 readonly data=new Map<string,string>(); writes=0; deniedReads=false; deniedWrites=false; dropWrites=false;
 getItem(key:string){if(this.deniedReads)throw Error('SecurityError');return this.data.get(key)??null;}
 setItem(key:string,value:string){if(this.deniedWrites)throw Error('QuotaExceededError');this.writes++;if(!this.dropWrites)this.data.set(key,value);}
 removeItem(key:string){this.data.delete(key);}
}
function setup(){const storage=new MemoryStorage(),journal=new DirectPendingJournal({...scope,storage});return {storage,journal};}
const code=(expected:string)=>(error:unknown)=>error instanceof DirectPendingJournalError && error.code===expected;
function browser(storage:MemoryStorage|undefined,run:()=>void,deny=false){
 const oldWindow=Object.getOwnPropertyDescriptor(globalThis,'window'),oldStorage=Object.getOwnPropertyDescriptor(globalThis,'sessionStorage');
 Object.defineProperty(globalThis,'window',{configurable:true,value:{}});
 Object.defineProperty(globalThis,'sessionStorage',{configurable:true,get:()=>{if(deny)throw Error('SecurityError');return storage;}});
 try{run();}finally{if(oldWindow)Object.defineProperty(globalThis,'window',oldWindow);else delete(globalThis as any).window;if(oldStorage)Object.defineProperty(globalThis,'sessionStorage',oldStorage);else delete(globalThis as any).sessionStorage;}
}
function persisted(storage:MemoryStorage,journal:DirectPendingJournal){return JSON.parse(storage.data.get(journal.storageKey)!);}

test('reload restores exact public metadata and decimal-string u64 values',()=>{
 const {storage,journal}=setup();const input=record(1,{lastValidBlockHeight:(1n<<64n)-1n,feeLamports:0n});journal.remember(input);
 const reloaded=new DirectPendingJournal({...scope,storage});assert.deepEqual(reloaded.get(match),{...input,status:'pending'});
 const raw=storage.data.get(journal.storageKey)!;const saved=JSON.parse(raw).records[0];
 assert.equal(saved.lastValidBlockHeight,'18446744073709551615');assert.equal(saved.feeLamports,'0');
 assert.deepEqual(Object.keys(saved).sort(),['program','genesis','actor','match','signature','intentHash','lastValidBlockHeight','feeLamports','createdAt','status'].sort());
 assert.ok(!/wire|preimage|private|messageBytes|https?:\/\//i.test(raw));assert.ok(!/https?:|apikey|token=/i.test(journal.storageKey));
 assert.notStrictEqual(journal.get(match),reloaded.get(match));
 (input as any).feeLamports=999n;assert.equal(reloaded.get(match)?.feeLamports,0n);
 assert.throws(()=>{(reloaded.get(match) as any).intentHash='cd'.repeat(32);},TypeError);
});

test('browser default sessionStorage persists through new journal instances',()=>{
 const storage=new MemoryStorage();browser(storage,()=>{
  const first=new DirectPendingJournal(scope);first.remember(record());
  const reloaded=new DirectPendingJournal(scope);assert.equal(reloaded.get(match)?.signature,signature(1));
 });
});

test('browser storage denial or absence never uses Node memory fallback',()=>{
 browser(undefined,()=>assert.throws(()=>new DirectPendingJournal(scope),code('storage_unavailable')),true);
 browser(undefined,()=>assert.throws(()=>new DirectPendingJournal(scope),code('storage_unavailable')));
 const storage=new MemoryStorage();storage.deniedReads=true;
 browser(storage,()=>assert.throws(()=>new DirectPendingJournal(scope),code('storage_unavailable')));
});

test('worker-like non-Node runtimes without sessionStorage fail instead of using memory',()=>{
 const oldProcess=Object.getOwnPropertyDescriptor(globalThis,'process');
 Object.defineProperty(globalThis,'process',{configurable:true,value:undefined});
 try{assert.throws(()=>new DirectPendingJournal(scope),code('storage_unavailable'));}
 finally{if(oldProcess)Object.defineProperty(globalThis,'process',oldProcess);}
});

test('failed or unverifiable durable write prevents the following send step',()=>{
 for(const mode of ['deniedWrites','dropWrites'] as const){
  const {storage,journal}=setup();storage[mode]=true;let sendCalls=0;
  const submit=()=>{journal.remember(record());sendCalls++;};
  assert.throws(submit,code('storage_unavailable'));assert.equal(sendCalls,0);assert.equal(journal.get(match),undefined);
 }
});

test('Node-only fallback survives reconstruction within the same process',()=>{
 const local={program:address(900),genesis:address(901),actor:address(902)};
 const first=new DirectPendingJournal(local);first.remember(record(900,{...local}));
 const next=new DirectPendingJournal(local);assert.equal(next.get(match)?.signature,signature(900));
 assert.equal(next.clear(match,signature(900),{status:'finalized'}),true);
});

test('confirmed evidence remains after reload while the next match action can proceed',()=>{
 const {storage,journal}=setup();journal.remember(record());
 assert.equal(journal.markConfirmed(match,signature(1),10n),true);assert.equal(journal.get(match),undefined);
 const next=new DirectPendingJournal({...scope,storage});assert.equal(next.list()[0].status,'confirmed');assert.equal(next.list()[0].confirmedSlot,10n);
 next.remember(record(2,{intentHash:'cd'.repeat(32)}));assert.equal(next.get(match)?.signature,signature(2));assert.equal(next.list().length,2);
 const saved=persisted(storage,next);assert.equal(saved.records[0].confirmedSlot,'10');assert.equal(saved.records[1].status,'pending');
});

test('definitive rejection persists through reload and permits the next intentional action',()=>{
 for(const proof of [{reason:'preflight' as const},{reason:'preflight' as const,slot:undefined},{reason:'program_error' as const,slot:15n}]){
  const {storage,journal}=setup();journal.remember(record());assert.equal(journal.markRejected(match,signature(1),proof),true);
  assert.equal(journal.get(match),undefined);const reloaded=new DirectPendingJournal({...scope,storage});const rejected=reloaded.list()[0];
  assert.equal(rejected.status,'rejected');assert.equal(rejected.rejectedReason,proof.reason);assert.equal(rejected.rejectedSlot,proof.slot);
  const stored=persisted(storage,reloaded).records[0];assert.equal(stored.rejectedSlot,proof.slot===undefined?undefined:'15');
  reloaded.remember(record(2,{intentHash:'cd'.repeat(32)}));assert.equal(reloaded.get(match)?.signature,signature(2));assert.equal(reloaded.list().length,2);
  reloaded.clear(match,signature(1),{status:'expired',blockHeight:201n});assert.equal(reloaded.get(match)?.signature,signature(2));
 }
});

test('rejection compares identifiers and cannot classify unknown transport as definitive',()=>{
 const {journal}=setup();journal.remember(record());
 assert.equal(journal.markRejected(match,signature(2),{reason:'preflight'}),false);assert.equal(journal.markRejected(address(8),signature(1),{reason:'preflight'}),false);
 assert.throws(()=>journal.markRejected(match,signature(1),{reason:'unknown_transport'} as any),code('invalid_record'));
 assert.throws(()=>journal.markRejected(match,signature(1),{reason:'program_error',slot:-1n}),code('invalid_record'));
 assert.throws(()=>journal.markRejected(match,signature(1),{reason:'preflight',wire:'private payload'} as any),code('invalid_record'));
 assert.equal(journal.get(match)?.status,'pending');
});

test('same rejection proof is idempotent and contradictory lifecycle rewrites are refused',()=>{
 const {storage,journal}=setup();journal.remember(record());journal.markRejected(match,signature(1),{reason:'program_error',slot:15n});const raw=storage.data.get(journal.storageKey);
 assert.equal(journal.markRejected(match,signature(1),{reason:'program_error',slot:15n}),true);assert.equal(storage.data.get(journal.storageKey),raw);
 assert.throws(()=>journal.markRejected(match,signature(1),{reason:'program_error',slot:16n}),code('pending_conflict'));
 assert.throws(()=>journal.markRejected(match,signature(1),{reason:'preflight'}),code('pending_conflict'));
 assert.throws(()=>journal.markConfirmed(match,signature(1),15n),code('pending_conflict'));assert.equal(storage.data.get(journal.storageKey),raw);
 assert.equal(journal.remember(record()).status,'rejected');
 journal.remember(record(2));journal.markConfirmed(match,signature(2),20n);const confirmed=storage.data.get(journal.storageKey);
 assert.throws(()=>journal.markRejected(match,signature(2),{reason:'program_error',slot:20n}),code('pending_conflict'));assert.equal(storage.data.get(journal.storageKey),confirmed);
});

test('a failed rejection write preserves unresolved metadata instead of allowing a new action',()=>{
 const {storage,journal}=setup();journal.remember(record());const raw=storage.data.get(journal.storageKey);storage.deniedWrites=true;
 assert.throws(()=>journal.markRejected(match,signature(1),{reason:'preflight'}),code('storage_unavailable'));
 assert.equal(storage.data.get(journal.storageKey),raw);assert.equal(journal.get(match)?.signature,signature(1));
 assert.throws(()=>journal.remember(record(2)),code('pending_conflict'));
});

test('same signature is idempotent and its immutable metadata cannot be replaced',()=>{
 const {storage,journal}=setup();journal.remember(record());const before=storage.data.get(journal.storageKey);
 journal.remember(record());assert.equal(storage.data.get(journal.storageKey),before);
 assert.throws(()=>journal.remember(record(1,{intentHash:'ef'.repeat(32)})),code('pending_conflict'));
 assert.throws(()=>journal.remember(record(1,{lastValidBlockHeight:201n})),code('pending_conflict'));
 assert.throws(()=>journal.remember(record(1,{createdAt:1_700_000_000_001})),code('pending_conflict'));
 assert.equal(storage.data.get(journal.storageKey),before);
 journal.markConfirmed(match,signature(1),12n);assert.equal(journal.remember(record()).status,'confirmed');assert.equal(journal.get(match),undefined);
});

test('only one unresolved signature per match, while separate matches are independent',()=>{
 const {journal}=setup();journal.remember(record());
 assert.throws(()=>journal.remember(record(2)),code('pending_conflict'));
 const other=address(8);journal.remember(record(3,{match:other}));assert.equal(journal.get(other)?.signature,signature(3));assert.equal(journal.list().length,2);
 assert.throws(()=>journal.remember(record(1,{match:other})),code('pending_conflict'));
});

test('markConfirmed is compare-and-update and does not silently accept a different slot',()=>{
 const {journal}=setup();journal.remember(record());
 assert.equal(journal.markConfirmed(match,signature(2),10n),false);assert.equal(journal.markConfirmed(address(8),signature(1),10n),false);
 assert.equal(journal.get(match)?.status,'pending');assert.equal(journal.markConfirmed(match,signature(1),10n),true);
 assert.equal(journal.markConfirmed(match,signature(1),10n),true);
 assert.throws(()=>journal.markConfirmed(match,signature(1),11n),code('pending_conflict'));assert.equal(journal.list()[0].confirmedSlot,10n);
});

test('compare-and-clear an older confirmed record preserves the newer pending signature',()=>{
 const {journal}=setup();journal.remember(record());journal.markConfirmed(match,signature(1),10n);journal.remember(record(2));
 assert.equal(journal.clear(match,signature(99),{status:'finalized'}),false);
 assert.equal(journal.clear(address(8),signature(1),{status:'finalized'}),false);
 assert.equal(journal.clear(match,signature(1),{status:'finalized'}),true);
 assert.equal(journal.get(match)?.signature,signature(2));assert.equal(journal.list().length,1);
});

test('wall-clock age never deletes unknown metadata and expiry requires explicit height proof',()=>{
 const {storage,journal}=setup();journal.remember(record(1,{createdAt:0}));const raw=storage.data.get(journal.storageKey);
 assert.equal(journal.get(match)?.createdAt,0);assert.equal(storage.data.get(journal.storageKey),raw);
 assert.throws(()=>(journal.clear as any)(match,signature(1)),code('invalid_reconciliation'));
 assert.throws(()=>journal.clear(match,signature(1),{status:'expired',blockHeight:200n}),code('invalid_reconciliation'));
 assert.throws(()=>journal.clear(match,signature(1),{status:'expired',blockHeight:-1n}),code('invalid_reconciliation'));
 assert.equal(journal.get(match)?.signature,signature(1));
 assert.equal(journal.clear(match,signature(1),{status:'expired',blockHeight:201n}),true);assert.equal(journal.get(match),undefined);
});

test('corrupt storage is preserved and blocks constructor and all later mutations',()=>{
 const {storage,journal}=setup();journal.remember(record());storage.data.set(journal.storageKey,'{broken');const writes=storage.writes;
 for(const operation of [()=>new DirectPendingJournal({...scope,storage}),()=>journal.get(match),()=>journal.list(),()=>journal.remember(record(2)),()=>journal.markConfirmed(match,signature(1),10n),()=>journal.markRejected(match,signature(1),{reason:'preflight'}),()=>journal.clear(match,signature(1),{status:'finalized'})])assert.throws(operation,code('malformed_journal'));
 assert.equal(storage.data.get(journal.storageKey),'{broken');assert.equal(storage.writes,writes);
});

test('foreign top-level and record scopes fail closed without erasing their data',()=>{
 for(const field of ['program','genesis','actor'] as const)for(const level of ['envelope','record']){
  const {storage,journal}=setup();journal.remember(record());const data=persisted(storage,journal);
  (level==='envelope'?data:data.records[0])[field]=address(99);const raw=JSON.stringify(data);storage.data.set(journal.storageKey,raw);
  assert.throws(()=>new DirectPendingJournal({...scope,storage}),code('scope_mismatch'));assert.equal(storage.data.get(journal.storageKey),raw);
 }
});

test('a different program, genesis or actor has a separate namespace and preserves older scope',()=>{
 const {storage,journal}=setup();journal.remember(record());const raw=storage.data.get(journal.storageKey);
 for(const field of ['program','genesis','actor'] as const){
  const foreign=new DirectPendingJournal({...scope,[field]:address(99),storage});assert.equal(foreign.get(match),undefined);assert.equal(foreign.list().length,0);assert.notEqual(foreign.storageKey,journal.storageKey);
 }
 assert.equal(storage.data.get(journal.storageKey),raw);
});

test('strict metadata bounds reject malformed inputs and any payload/private fields',()=>{
 const invalid:Record<string,unknown>[]=[{program:'https://rpc.example/?api-key=secret'},{match:'0'.repeat(32)},{signature:getBase58Decoder().decode(bytes(1,63))},
  {intentHash:'a'.repeat(63)},{intentHash:'AB'.repeat(32)},{lastValidBlockHeight:-1n},{lastValidBlockHeight:1n<<64n},{lastValidBlockHeight:200},
  {feeLamports:-1n},{feeLamports:1n<<64n},{createdAt:NaN},{createdAt:-1},{createdAt:1.5},{createdAt:Number.MAX_SAFE_INTEGER+1},
  {wire:'signed transaction'},{preimage:[1,2,3]},{privateKey:'secret'},{messageBytes:new Uint8Array(4)},{status:'confirmed',confirmedSlot:1n}];
 for(const changes of invalid){const {journal}=setup();assert.throws(()=>journal.remember({...record(),...changes} as DirectPendingInput),code('invalid_record'));assert.equal(journal.list().length,0);}
 for(const field of ['program','genesis','actor'] as const){const {journal}=setup();assert.throws(()=>journal.remember(record(1,{[field]:address(99)})),code('scope_mismatch'));}
});

test('malformed stored lifecycle, decimal numbers and duplicates never get partially loaded',()=>{
 const edits=[
  (data:any)=>{data.records[0].feeLamports=5000;},(data:any)=>{data.records[0].lastValidBlockHeight='0200';},
  (data:any)=>{data.records[0].lastValidBlockHeight='18446744073709551616';},
  (data:any)=>{data.records[0].status='confirmed';},(data:any)=>{data.records[0].confirmedSlot='1';},
  (data:any)=>{data.records.push({...data.records[0],signature:signature(2)});},
  (data:any)=>{data.records.push({...data.records[0],status:'confirmed',confirmedSlot:'1'});},
  (data:any)=>{data.records[0].status='rejected';},
  (data:any)=>{data.records[0].status='rejected';data.records[0].rejectedReason='unknown_transport';},
  (data:any)=>{data.records[0].status='rejected';data.records[0].rejectedReason='program_error';data.records[0].rejectedSlot=10;},
  (data:any)=>{data.records[0].status='rejected';data.records[0].rejectedReason='preflight';data.records[0].confirmedSlot='10';},
  (data:any)=>{data.records[0].rejectedReason='preflight';},
  (data:any)=>{data.records[0].wire='not allowed';},(data:any)=>{data.privateKey='not allowed';},(data:any)=>{data.version=2;},
 ];
 for(const edit of edits){const {storage,journal}=setup();journal.remember(record());const data=persisted(storage,journal);edit(data);const raw=JSON.stringify(data);storage.data.set(journal.storageKey,raw);assert.throws(()=>journal.list(),code('malformed_journal'));assert.equal(storage.data.get(journal.storageKey),raw);}
});

test('128-row cap includes confirmed/rejected evidence and never auto-evicts unknown records',()=>{
 const {storage,journal}=setup();journal.remember(record());const data=persisted(storage,journal),template=data.records[0];
 data.records=Array.from({length:DIRECT_PENDING_LIMIT},(_,i)=>({...template,signature:signature(i+1),createdAt:0,...(i%2?{status:'confirmed',confirmedSlot:String(i+1)}:{status:'rejected',rejectedReason:'preflight'})}));
 const raw=JSON.stringify(data);storage.data.set(journal.storageKey,raw);const reloaded=new DirectPendingJournal({...scope,storage});
 assert.equal(reloaded.list().length,128);assert.equal(reloaded.get(match),undefined);
 assert.throws(()=>reloaded.remember(record(129)),code('journal_full'));assert.equal(storage.data.get(journal.storageKey),raw);
 reloaded.clear(match,signature(2),{status:'finalized'});reloaded.remember(record(129));assert.equal(reloaded.list().length,128);assert.equal(reloaded.get(match)?.signature,signature(129));
 const oversized=persisted(storage,reloaded);oversized.records.push({...template,signature:signature(130),match:address(130)});const overflow=JSON.stringify(oversized);storage.data.set(journal.storageKey,overflow);
 assert.throws(()=>reloaded.list(),code('malformed_journal'));assert.equal(storage.data.get(journal.storageKey),overflow);
});

test('oversized raw storage and newly denied reads fail without cleanup writes',()=>{
 const {storage,journal}=setup();storage.data.set(journal.storageKey,'x'.repeat(128*1024+1));assert.throws(()=>journal.list(),code('malformed_journal'));assert.equal(storage.writes,0);
 storage.deniedReads=true;assert.throws(()=>journal.get(match),code('storage_unavailable'));assert.throws(()=>journal.remember(record()),code('storage_unavailable'));assert.equal(storage.writes,0);
});
