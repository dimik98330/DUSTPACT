import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import type {Pool} from 'pg';
import {blockhash,generateKeyPairSigner,lamports,getBase64EncodedWireTransaction,getBase64Decoder,getTransactionDecoder,type Address,type TransactionPartialSigner,type TransactionMessageBytesBase64} from '@solana/kit';
import {getSysvarClockDecoder,SYSVAR_CLOCK_ADDRESS} from '@solana/sysvars';
import {V2Reader} from '../../../packages/solana-v2/src/reader';
import {accountBytesV2,checkedGameV2,checkedMissionV2,checkedTokenAmount} from '../../../packages/solana-v2/src/accounts';
import {missionAddress,tokenAddress} from '../../../packages/solana-v2/src/addressing';
import {PROGRAM_V2,VAULT_PROGRAM,RULES_HASH,CONTENT_HASH} from '../../../packages/solana-v2/src/constants';
import {V2_FEE_STATEMENT,V2_MAX_SPONSORED_FEE} from '../../../packages/solana-v2/src/fees';
import {hex} from '../../../packages/solana-v2/src/codec';
import {Auth} from './auth';
import {transaction} from './db';
import {asAddress,body,digest,decodeBase64,HttpError,json,log,originOf,RateLimit,requireThat} from './security';
import type {V2Config} from './v2-config';
import {rebuildSponsoredV2,type FeeQuoteV2,type FeeStateV2} from './v2-fee-canonical';
export type FeeLimitsV2={dailyLamports:bigint;ownerGrants:number;matchGrants:number};
const limitsDefault:FeeLimitsV2={dailyLamports:5_000_000n,ownerGrants:200,matchGrants:256};
const quoteId=(v:unknown)=>{requireThat(typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v),400,'FEE_QUOTE_ID');return v;};
const fromRow=(r:any):FeeQuoteV2=>({id:r.id,genesis:r.genesis,feePayer:asAddress(r.fee_payer),owner:asAddress(r.owner_address),actor:asAddress(r.actor_address),match:asAddress(r.match_address),blockhash:blockhash(r.blockhash),lastValidBlockHeight:BigInt(r.last_valid_height)});
export class FeeAuthorityV2 {
 readonly reader:V2Reader;
 constructor(readonly db:Pool,readonly cfg:V2Config,readonly signer:TransactionPartialSigner,readonly genesis:string,readonly limits:FeeLimitsV2=limitsDefault){
  requireThat(limits.dailyLamports>0n&&limits.dailyLamports<=5_000_000n&&limits.ownerGrants>0&&limits.ownerGrants<=200&&limits.matchGrants>0&&limits.matchGrants<=256,500,'FEE_LIMIT_CONFIG');
  this.reader=new V2Reader(cfg.rpcUrl,genesis);
 }
 async assertNetwork(){requireThat(await this.reader.rpc.getGenesisHash().send()===this.genesis,503,'FEE_NETWORK_CHANGED');}
 async state(match:Address):Promise<FeeStateV2>{
  await this.assertNetwork();const[m]=await missionAddress(match),[escrow]=await tokenAddress(m);
  const r=await this.reader.rpc.getMultipleAccounts([match,m,escrow,SYSVAR_CLOCK_ADDRESS],{encoding:'base64',commitment:'confirmed'}).send();
  const clock=getSysvarClockDecoder().decode(accountBytesV2(r.value[3],asAddress('Sysvar1111111111111111111111111111111111111'),40));requireThat(clock.slot===r.context.slot,503,'FEE_CLOCK_CONTEXT');
  const game=r.value[0]===null?null:await checkedGameV2(match,r.value[0]),mission=await checkedMissionV2(match,r.value[1]);
  if(mission)requireThat(checkedTokenAmount(r.value[2],m)!==null,422,'FEE_ESCROW_MISSING');
  await this.assertNetwork();return{game,mission,chainNow:clock.unixTimestamp};
 }
 async quote(owner:Address,origin:string,input:Record<string,unknown>){
  await this.assertNetwork();requireThat(input.genesis===this.genesis,409,'FEE_NETWORK_CHANGED');const actor=asAddress(input.actor),match=asAddress(input.match);
  requireThat(actor!==this.signer.address,403,'FEE_ACTOR_REJECTED');
  const lifetime=(await this.reader.rpc.getLatestBlockhash({commitment:'confirmed'}).send()).value;
  const id=randomUUID();await transaction(this.db,async c=>{
   await c.query('SELECT pg_advisory_xact_lock(60419740)');
   await c.query("DELETE FROM v2_fee_quotes WHERE status='quoted' AND quote_until<now()");
   const live=await c.query("SELECT count(*)::int AS total,count(*) FILTER(WHERE owner_address=$1)::int AS own FROM v2_fee_quotes WHERE status='quoted'",[owner]);
   requireThat(live.rows[0].total<1000&&live.rows[0].own<5,429,'FEE_QUOTE_CAPACITY');
   await c.query("INSERT INTO v2_fee_quotes(id,genesis,fee_payer,owner_address,actor_address,match_address,origin,blockhash,last_valid_height,quote_until) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,now()+interval '45 seconds')",[id,this.genesis,this.signer.address,owner,actor,match,origin,lifetime.blockhash,lifetime.lastValidBlockHeight.toString()]);
  });await this.assertNetwork();return{id,genesis:this.genesis,feePayer:this.signer.address,actor,owner,match,...lifetime};
 }
 async grant(owner:Address,origin:string,input:Record<string,unknown>){
  await this.assertNetwork();const id=quoteId(input.quoteId),row=(await this.db.query('SELECT * FROM v2_fee_quotes WHERE id=$1',[id])).rows[0];
  requireThat(row&&row.owner_address===owner&&row.origin===origin&&row.genesis===this.genesis&&row.fee_payer===this.signer.address,403,'FEE_QUOTE_CONTEXT');
  requireThat(typeof input.wire==='string'&&input.wire.length<=1700,400,'FEE_WIRE_LIMIT');
  const quote=fromRow(row);
  // The immutable stored digest permits recovery after game state/nonce has advanced.
  if(row.status!=='quoted'){const decoded=getTransactionDecoder().decode(decodeBase64(input.wire,1232)),hash=digest(Uint8Array.from(decoded.messageBytes));requireThat(Object.values(decoded.signatures).every(s=>s===null)&&row.message_hash===hash,409,'FEE_QUOTE_REUSED');return{feePayer:quote.feePayer,genesis:this.genesis,messageHash:hash,signature:row.fee_signature,feeLamports:row.fee_lamports};}
  const state=await this.state(quote.match),rebuilt=await rebuildSponsoredV2(input.wire,quote,state),hash=digest(Uint8Array.from(rebuilt.transaction.messageBytes));
  requireThat(new Date(row.quote_until).getTime()>Date.now(),409,'FEE_QUOTE_EXPIRED');
  const valid=await this.reader.rpc.isBlockhashValid(quote.blockhash,{commitment:'confirmed'}).send();requireThat(valid.value,409,'FEE_BLOCKHASH_EXPIRED');
  const sim=await this.reader.rpc.simulateTransaction(getBase64EncodedWireTransaction(rebuilt.transaction),{encoding:'base64',sigVerify:false,commitment:'confirmed',minContextSlot:valid.context.slot}).send();
  requireThat(!sim.value.err,409,'FEE_ACTION_REJECTED');
  const fee=(await this.reader.rpc.getFeeForMessage(getBase64Decoder().decode(rebuilt.transaction.messageBytes) as TransactionMessageBytesBase64,{commitment:'confirmed'}).send()).value;
  requireThat(fee!==null&&fee>0n&&fee<=V2_MAX_SPONSORED_FEE,409,'FEE_LIMIT');await this.assertNetwork();
  return transaction(this.db,async c=>{
   // One lock for this database guarantees totals even across different RAM keys/processes.
   await c.query('SELECT pg_advisory_xact_lock(60419741)');
   const current=(await c.query('SELECT * FROM v2_fee_quotes WHERE id=$1 FOR UPDATE',[id])).rows[0];requireThat(current,409,'FEE_QUOTE_EXPIRED');
   if(current.status!=='quoted'){requireThat(current.message_hash===hash,409,'FEE_QUOTE_REUSED');return{feePayer:quote.feePayer,genesis:this.genesis,messageHash:hash,signature:current.fee_signature,feeLamports:current.fee_lamports};}
   const clock=(await c.query('SELECT now() AS now')).rows[0].now as Date;requireThat(new Date(current.quote_until)>clock,409,'FEE_QUOTE_EXPIRED');
   const usage=(await c.query("SELECT coalesce(sum(fee_lamports),0)::text AS total,count(*) FILTER(WHERE owner_address=$2)::int AS own,count(*) FILTER(WHERE match_address=$3)::int AS match FROM v2_fee_quotes WHERE genesis=$1 AND issued_at>=date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'",[this.genesis,owner,quote.match])).rows[0];
   requireThat(BigInt(usage.total)+fee<=this.limits.dailyLamports&&usage.own<this.limits.ownerGrants&&usage.match<this.limits.matchGrants,429,'FEE_BUDGET_EXHAUSTED');
   const balance=(await this.reader.rpc.getBalance(this.signer.address,{commitment:'confirmed'}).send()).value;requireThat(balance>=this.limits.dailyLamports,503,'FEE_PAYER_LOW_BALANCE');
   await this.assertNetwork();const [signatures]=await this.signer.signTransactions([rebuilt.transaction]);const signature=signatures[this.signer.address];requireThat(signature?.length===64,503,'FEE_SIGNER_FAILED');
   const base64=Buffer.from(signature).toString('base64');await c.query("UPDATE v2_fee_quotes SET status='issued',issued_at=now(),message_hash=$2,fee_signature=$3,fee_lamports=$4 WHERE id=$1",[id,hash,base64,fee.toString()]);
   return{feePayer:quote.feePayer,genesis:this.genesis,messageHash:hash,signature:base64,feeLamports:fee.toString()};
  });
 }
 dispose(){this.reader.dispose();}
}
export async function createFeeServiceV2(db:Pool,cfg:V2Config,providedSigner?:TransactionPartialSigner,limits=limitsDefault){
 requireThat(cfg.allowLocalSigning&&['127.0.0.1','localhost','[::1]'].includes(new URL(cfg.rpcUrl).hostname),503,'FEE_LOCAL_SIGNING_DISABLED');
 const signer=providedSigner??await generateKeyPairSigner(),pin=new V2Reader(cfg.rpcUrl,cfg.expectedGenesis),genesis=await pin.rpc.getGenesisHash().send();pin.dispose();
 requireThat(!cfg.expectedGenesis||genesis===cfg.expectedGenesis,503,'FEE_NETWORK_CHANGED');
 const authority=new FeeAuthorityV2(db,cfg,signer,genesis,limits),auth=new Auth(db,{...cfg,cookieName:cfg.cookieName+'-fees'},{scope:`v2-fees:${genesis}`,statement:V2_FEE_STATEMENT}),rate=new RateLimit();
 const server=createServer((req,res)=>{void(async()=>{
  rate.hit(`ip:${req.socket.remoteAddress}`,600,60000);const path=new URL(req.url??'/','http://127.0.0.1').pathname.replace(/^\/api\/v2(?=\/|$)/,'');
  const origin=originOf(req,cfg);res.setHeader('access-control-allow-origin',origin);res.setHeader('access-control-allow-credentials','true');res.setHeader('vary','Origin');
  if(req.method==='OPTIONS'){res.writeHead(204,{'access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'Content-Type,X-CSRF-Token'});res.end();return;}
  await authority.assertNetwork();
  if(path==='/fees/version'&&req.method==='GET')return json(res,200,{version:2,scope:'v2-fees',test:true,genesis,cluster:cfg.cluster,feePayer:signer.address,game:PROGRAM_V2,vault:VAULT_PROGRAM,rulesHash:hex(RULES_HASH),contentHash:hex(CONTENT_HASH),maxFeeLamports:V2_MAX_SPONSORED_FEE,dailyAuthorizationLamports:limits.dailyLamports,statement:V2_FEE_STATEMENT});
  if(path==='/auth/challenge'&&req.method==='POST')return json(res,200,await auth.challenge(await body(req),origin));
  if(path==='/auth/verify'&&req.method==='POST')return json(res,200,await auth.verify(await body(req),origin,res));
  const session=await auth.session(req,origin,req.method==='POST'),owner=asAddress(session.address);rate.hit(`owner:${owner}`,240,60000);
  if(path==='/auth/session'&&req.method==='GET')return json(res,200,{address:session.address,csrfToken:session.csrf_token,expiresAt:session.expires_at.toISOString()});
  if(path==='/auth/logout'&&req.method==='POST'){await auth.logout(session,res);return json(res,200,{ok:true});}
  if(path==='/fees/quote'&&req.method==='POST')return json(res,200,await authority.quote(owner,origin,await body(req)));
  if(path==='/fees/grant'&&req.method==='POST')return json(res,200,await authority.grant(owner,origin,await body(req,4096)));
  throw new HttpError(404,'NOT_FOUND');
 })().catch(e=>{const code=e instanceof HttpError?e.code:'FEE_UNAVAILABLE';if(!(e instanceof HttpError))log('v2_fee_request_failed',{code});if(!res.headersSent)json(res,e instanceof HttpError?e.status:503,{error:{code}});});});
 return{server,authority,signer,genesis,async close(){authority.dispose();await new Promise<void>(resolve=>{server.close(()=>resolve());server.closeAllConnections();});}};
}
