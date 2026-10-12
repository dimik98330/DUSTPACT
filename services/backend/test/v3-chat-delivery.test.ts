import assert from 'node:assert/strict';import {test}from'node:test';import {randomUUID}from'node:crypto';
import {generateKeyPairSigner}from'@solana/kit';import {WebSocket}from'ws';
import {database,migrate}from'../src/db-v3.ts';import {configV3}from'../src/v3-config.ts';import {V3Chain}from'../src/v3-chain.ts';import {createV3Api}from'../src/v3-api.ts';
import {gameFixtureV3,genesisFixtureV3}from'./v3-fixtures.ts';import {storeChatMessageV3,chatClientId}from'../src/v3-chat-message.ts';
test('V3 delivery IDs reject malformed input before storage',()=>{assert.equal(chatClientId(undefined),undefined);assert.throws(()=>chatClientId('x'.repeat(1000)));assert.throws(()=>chatClientId(1));assert.equal(chatClientId('AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA'),'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');});
test('V3 optional chat: live PostgreSQL/HTTP/WS exact delivery, lost ACK, old-room lookup and no game authority',{skip:process.env.DUSTPACT_V3_DATABASE_TESTS!=='1',timeout:60000},async()=>{
 const cfg={...configV3(),databaseUrl:process.env.DUSTPACT_V3_TEST_DATABASE_URL??'postgresql://dustpact@127.0.0.1:15434/dustpact_v3_test'},admin=database(cfg.databaseUrl),schema=`v3_chat_${randomUUID().replaceAll('-','')}`;
 assert.match(schema,/^v3_chat_[0-9a-f]{32}$/);await admin.query(`CREATE SCHEMA "${schema}"`);const connection=new URL(cfg.databaseUrl);connection.searchParams.set('options',`-c search_path=${schema}`);const db=database(connection.href);await migrate(db);
 const actors=await Promise.all(Array.from({length:4},()=>generateKeyPairSigner())),{game,match}=await gameFixtureV3(actors.map(s=>s.address)),chain=new V3Chain(cfg.rpcUrl);
 chain.genesis=async()=>genesisFixtureV3;chain.read=async()=>({game,mission:null,genesis:genesisFixtureV3,slot:100n,commitment:'confirmed'});chain.now=async()=>1000;
 const beforeGame=JSON.stringify(game,(_,v)=>typeof v==='bigint'?String(v):v),api=createV3Api(db,cfg,chain),origin='http://127.0.0.1:4175';await new Promise<void>(r=>api.server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${(api.server.address()as {port:number}).port}/api/v2`;let cookie='',csrf='',ws:WebSocket|undefined;
 async function request(path:string,body?:unknown){const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{Origin:origin,...(body===undefined?{}:{'Content-Type':'application/json'}),...(cookie?{Cookie:cookie,'x-csrf-token':csrf}:{})},body:body===undefined?undefined:JSON.stringify(body)});const data=await response.json()as any;assert.equal(response.status,200,JSON.stringify(data));return{response,data};}
 try{
  const c=(await request('/auth/challenge',{address:actors[0].address,origin,cluster:cfg.cluster})).data;
  const signature=Buffer.from(await crypto.subtle.sign('Ed25519',actors[0].keyPair.privateKey,Buffer.from(c.message))).toString('base64');const verified=await request('/auth/verify',{challengeId:c.challengeId,signature});cookie=verified.response.headers.get('set-cookie')!.split(';')[0];csrf=verified.data.csrfToken;
  const room=(await request('/rooms',{matchAddress:match,ownerAddress:actors[0].address,title:'Isolated fixture room',keeperEnabled:false})).data;
  assert.equal(room.match_address,match);assert.equal(room.host_address,actors[0].address);assert.equal(room.keeper_enabled,false);
  // Older matches remain discoverable even after more than100 newer rooms.
  await db.query(`INSERT INTO v3_rooms(id,network_key,match_address,title,host_address,keeper_enabled,created_at) SELECT gen_random_uuid(),$1,'fixture-'||n,'Test',$2,false,now()+interval '1 second' FROM generate_series(1,101)n`,[genesisFixtureV3,actors[0].address]);
  assert.equal((await request(`/rooms?matchAddress=${match}`)).data.rooms[0].id,room.id);
  const id=randomUUID();const saves=await Promise.all(Array.from({length:5},()=>storeChatMessageV3(db,room.id,actors[0].address,'Same attempt',id)));assert.equal(new Set(saves.map(s=>s.message.id)).size,1);assert.equal(saves.filter(s=>s.created).length,1);await assert.rejects(storeChatMessageV3(db,room.id,actors[0].address,'Changed payload',id),/V3_CHAT_ID_REUSED/);
  assert.equal((await storeChatMessageV3(db,room.id,actors[1].address,'Other wallet',id)).created,true,'ID scope includes actual sender');
  const ticket=(await request(`/rooms/${room.id}/ticket`,{})).data.ticket;ws=new WebSocket(base.replace('http:','ws:')+`/rooms/${room.id}/socket?ticket=${ticket}`,{headers:{Origin:origin,Cookie:cookie}});await new Promise<void>((r,j)=>{ws!.once('open',r);ws!.once('error',j);});
  const received:any[]=[];ws.on('message',data=>received.push(JSON.parse(data.toString())));const lost=randomUUID(),serverSocket=[...api.chat.wss.clients][0],originalSend=serverSocket.send.bind(serverSocket);let dropping=true;
  (serverSocket as any).send=(data:any,...args:any[])=>{const value=JSON.parse(String(data));if(dropping&&(value.clientId===lost||value.message?.clientId===lost))return;return(originalSend as any)(data,...args);};
  ws.send(JSON.stringify({type:'message',text:'Unsealed promise, not a contract',clientId:lost}));
  for(let i=0;i<50;i++){if((await db.query('SELECT 1 FROM v3_chat_messages WHERE client_id=$1',[lost])).rowCount)break;await new Promise(r=>setTimeout(r,40));}
  assert.equal(received.some(e=>e.clientId===lost||e.message?.clientId===lost),false,'response was actually lost');
  const lookup=(await request(`/rooms/${room.id}/messages?clientId=${lost}`)).data.messages;assert.equal(lookup.length,1);assert.equal(lookup[0].clientId,lost);
  dropping=false;ws.send(JSON.stringify({type:'message',text:'Unsealed promise, not a contract',clientId:lost}));
  for(let i=0;i<50&&!received.some(e=>e.type==='ack'&&e.clientId===lost);i++)await new Promise(r=>setTimeout(r,40));
  assert.equal(received.find(e=>e.type==='ack'&&e.clientId===lost)?.message.id,lookup[0].id);assert.equal((await db.query('SELECT count(*)::int AS n FROM v3_chat_messages WHERE client_id=$1',[lost])).rows[0].n,1);
  await request(`/rooms/${room.id}/moderate`,{messageId:lookup[0].id});const hidden=(await request(`/rooms/${room.id}/messages?clientId=${lost}`)).data.messages[0];assert.equal(hidden.hidden,true);assert.equal(hidden.text,null);
  assert.equal(JSON.stringify(game,(_,v)=>typeof v==='bigint'?String(v):v),beforeGame,'chat never changes game resources, pacts or commitments');
 }finally{ws?.close();await api.close();await db.end();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();}
});
