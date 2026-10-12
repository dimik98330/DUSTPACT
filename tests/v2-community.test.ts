import {test}from'node:test';import assert from'node:assert/strict';import {generateKeyPairSigner}from'@solana/kit';
import {CommunityClient}from'../packages/ui/src/community';import {V2Community,validV2Message,mergeChatMessages}from'../apps/web/src/v2/community';
const origin='http://127.0.0.1:4175';
function challenge(address:string){const issued=new Date(),expires=new Date(+issued+300000);return{challengeId:crypto.randomUUID(),message:`127.0.0.1:4175 wants you to sign in to DUSTPACT:\n${address}\n\nSign in to the optional chat service. This does not authorize game actions or transfer funds.\n\nURI: ${origin}\nVersion: 1\nChain ID: solana:localnet-v2\nNonce: ${'a'.repeat(43)}\nIssued At: ${issued.toISOString()}\nExpiration Time: ${expires.toISOString()}`,expiresAt:expires.toISOString()};}
test('V2 sign-in uses its own prefix/cluster; changed context after wallet approval never uploads verification',async()=>{
 const actor=await generateKeyPairSigner(),original=globalThis.fetch;let signs=0,verifies=0,valid=true;
 const signer={...actor,signMessages:async(...args:Parameters<typeof actor.signMessages>)=>{signs++;const result=await actor.signMessages(...args);valid=false;return result;}};
 globalThis.fetch=async(url,init)=>{assert.match(String(url),/\/api\/v2\//);if(String(url).endsWith('/auth/session'))return new Response(JSON.stringify({error:{code:'AUTH_REQUIRED'}}),{status:401});if(String(url).endsWith('/auth/challenge')){assert.equal(JSON.parse(String(init?.body)).cluster,'localnet-v2');return new Response(JSON.stringify(challenge(actor.address)));}verifies++;return new Response('{}');};
 try{await assert.rejects(new CommunityClient('http://127.0.0.1:4184',origin,'localnet-v2','v2').authenticate(signer,{validateContext:async()=>{if(!valid)throw Error('Context changed');}}),/Context changed/);assert.equal(signs,1);assert.equal(verifies,0);}finally{globalThis.fetch=original;}
});
test('concurrent different wallets cannot share one sign-in flight',async()=>{
 const [a,b]=await Promise.all([generateKeyPairSigner(),generateKeyPairSigner()]),original=globalThis.fetch,abort=new AbortController();let release!:(r:Response)=>void;const delayed=new Promise<Response>(r=>release=r);const client=new CommunityClient('http://127.0.0.1:4184',origin,'localnet-v2','v2');
 globalThis.fetch=async()=>delayed;
 try{const pending=client.authenticate(a,{abortSignal:abort.signal});await assert.rejects(client.authenticate(b),/Wallet changed/);abort.abort();release(new Response('{}'));await assert.rejects(pending);}finally{globalThis.fetch=original;}
});
test('V2 chat orders PostgreSQL IDs without precision loss and retains moderation over stale history',async()=>{
 const owner=(await generateKeyPairSigner()).address,one={id:'9007199254740992',address:owner,text:'one',createdAt:new Date().toISOString(),clientId:crypto.randomUUID()},two={...one,id:'9007199254740993',text:'two'};
 assert.equal(validV2Message(one),true);assert.equal(validV2Message({...one,id:'9223372036854775808'}),false);
 assert.equal(validV2Message({...one,text:null,hidden:true}),true);assert.equal(validV2Message({...one,text:null,hidden:false}),false);
 const result=mergeChatMessages([two,one],[{...two,text:'stale',hidden:false}],new Set([two.id]));assert.deepEqual(result.map(m=>m.id),[one.id,two.id]);assert.equal(result[1].hidden,true);assert.equal(result[1].text,null);
 const nextEvent=mergeChatMessages([one],[two],new Set([one.id]));assert.equal(nextEvent[0].hidden,true);assert.equal(nextEvent[0].text,null,'moderated previous cache cannot resurrect on an unrelated new event');
 const returnToLatest=mergeChatMessages([one,two],[],new Set([one.id]));assert.equal(returnToLatest[0].text,null,'restoring a live window also respects past moderation');
});
test('an older history window retains fetched pages after300 messages instead of discarding them',async()=>{
 const owner=(await generateKeyPairSigner()).address;
 const messages=Array.from({length:401},(_,i)=>({id:String(i+1),address:owner,text:String(i+1),createdAt:new Date().toISOString()}));
 const latest=mergeChatMessages([],messages);assert.equal(latest.length,300);assert.equal(latest[0].id,'102');
 const older=mergeChatMessages(latest,messages.slice(1,101),new Set(),'older');assert.equal(older.length,300);assert.equal(older[0].id,'2');assert.equal(older.at(-1)!.id,'301');
 const newestAgain=mergeChatMessages(latest,messages.slice(-100));assert.equal(newestAgain.at(-1)!.id,'401');
});
test('exact-ID history lookup rejects conflicting restored text instead of clearing its outbox',async()=>{
 const actor=await generateKeyPairSigner(),clientId=crypto.randomUUID(),oldFetch=globalThis.fetch;
 const access=new V2Community({base:'http://127.0.0.1:4184',origin,cluster:'localnet-v2',signer:actor,match:actor.address,creator:actor.address,genesis:'unit-genesis',validateContext:async()=>{},storage:{getItem:()=>JSON.stringify([{clientId,text:'restored text'}]),setItem:()=>{}}});
 (access as any).view.room=crypto.randomUUID();
 globalThis.fetch=async()=>new Response(JSON.stringify({messages:[{id:'1',address:actor.address,clientId,text:'different stored text',createdAt:new Date().toISOString()}]}));
 try{await assert.rejects(access.check(clientId),/different text/);assert.equal(access.snapshot().outgoing.length,1);assert.equal(access.snapshot().outgoing[0].status,'unknown');}finally{access.dispose();globalThis.fetch=oldFetch;}
});
