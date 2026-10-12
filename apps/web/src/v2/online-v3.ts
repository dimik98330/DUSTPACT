import {completeAgentRoster} from './entry-bootstrap';
import { address, generateKeyPairSigner, type Address, type TransactionSigner } from "@solana/kit";
import { V3Client, LOCAL_RPC_V3, PROGRAM_V3, VAULT_PROGRAM, USDC_MINT, SYSTEM, RULES_HASH, CONTENT_HASH, workContextBytes, privateMoveEnvelope, configBytes, reviewConfig, reviewOffer, reviewOfferIntent, prepareMove, snapshotReleasePolicy, recoveryBundle, verifyPrivateMoveCopy, verifyPrivateBackupCandidate, type ClientOptions, type GameV3, type Offer, type PreparedMove, type Mission, type Summary, type TransactionUpdate, type TrustedReleasePolicy } from "../../../../packages/solana-v3/src/index";
import { localIdentity } from "../../../../packages/ui/src/local-identity";
import { chooseV3AgentMove, v3AgentOffers, v3AgentAccepts, type V3Personality } from "../../../../packages/engine/src/v3-bots";
import type { V3Deal } from "../../../../packages/engine/src/v3";
import { verifyV3History } from '../../../../packages/engine/src/v3-replay';
import { v3BridgeOpen, v3ProductionSlots, v3Rejection } from "../../../../packages/engine/src/v3-design";
import { sameChoice } from "./model";
import { reviewTerms } from "./terms";
import { V2Community as V3Community } from './community';
import { projectReceipt } from './projection-v3';
import {FeeConnectionV3}from'./fee-support-v3';
import {V3_PERSONALITIES} from '../../../../packages/engine/src/v3-npc';
export { projectReceipt } from './projection-v3';
import type { GameController, GameView, Move, Operation, Pact, PactTerms, VaultView, Receipt, Bundle } from "./model";
export type OnlineOptions={network:"local"|"devnet";signer?:TransactionSigner;match?:string;agents?:boolean;count?:number;fees?:boolean;onProgress?(message:[string,string]):void;onCreated?(match:string,agentCount?:number):void};
function feeBase(network:'local'|'devnet'){const configured=(import.meta.env as Record<string,unknown>).VITE_DUSTPACT_V3_FEE_URL;if(typeof configured==='string'&&configured)return configured;if(network==='local'&&typeof location!=='undefined'&&['127.0.0.1','localhost'].includes(location.hostname))return `${location.protocol}//${location.hostname}:4198`;throw Error('Fee support is not configured for this network');}
const personalities=V3_PERSONALITIES;
const PROTOCOL3={game:PROGRAM_V3,vault:VAULT_PROGRAM,rules:RULES_HASH,content:CONTENT_HASH};
const names=["Вы","Айша","Тимур","Сая","Нура","Алан"];
const same=(a:unknown,b:unknown)=>JSON.stringify(a,(_,v)=>typeof v==="bigint"?v.toString():v instanceof Uint8Array?Array.from(v):v)===JSON.stringify(b,(_,v)=>typeof v==="bigint"?v.toString():v instanceof Uint8Array?Array.from(v):v);
export function publicPolicies():readonly TrustedReleasePolicy[]|undefined {
  const raw=(import.meta.env as Record<string,unknown>).VITE_DUSTPACT_V3_RELEASE_POLICY;
  if(typeof raw!=="string"||!raw.trim())return undefined;
  const parsed=JSON.parse(raw);if(!Array.isArray(parsed)||parsed.length!==2)throw Error("V3 release policy must pin both programs");
  return parsed.map(p=>snapshotReleasePolicy(p));
}
export async function openOnline(options:OnlineOptions):Promise<GameController> {
  const url=options.network==="local"?LOCAL_RPC_V3:"https://api.devnet.solana.com";
  const policies=publicPolicies(), config:ClientOptions={...(policies?{releasePolicies:policies}:{}),pendingStorage:typeof sessionStorage!=="undefined"?sessionStorage:undefined};
  if(options.network==="devnet"&&!policies)throw Error("V3 Devnet ещё не развёрнут с проверенной конфигурацией. Публичные подписи отключены. / V3 Devnet has no reviewed deployment configuration; public signing is disabled.");
  if(options.agents&&options.network!=="local")throw Error("Generated agent parties are currently available only on Localnet");
  const owner=options.signer?new V3Client(options.signer,url,config):options.network==="local"?new V3Client(await localIdentity("dustpact-v3-player"),url,config):null;
  if(!owner)throw Error("Подключите Wallet Standard кошелёк. / Connect a Wallet Standard wallet.");
  let fees:FeeConnectionV3|undefined;
  try {
    if(!await owner.programExists())throw Error("Программы V3 не доступны в этой сети. Запустите локальный V3 runtime или выберите практику. / V3 programs are unavailable on this network. Start the V3 runtime or choose practice.");
    options.onProgress?.(['Готовим локальные игровые профили…','Preparing local game profiles…']);
    if(!options.signer&&!options.match)await owner.fundLocal();
    let match:Address, bots:V3Client[]=[];
    const genesis=await owner.rpc.getGenesisHash().send();
    if(options.fees){fees=await FeeConnectionV3.connect({protocol:PROTOCOL3,base:feeBase(options.network),origin:location.origin,cluster:options.network==='local'?'localnet-v2':'devnet',genesis,owner:owner.signer,validate:async()=>{if(await owner.rpc.getGenesisHash().send()!==genesis)throw Error('Fee support network changed');}});owner.setFeeSponsor(fees);}
    const botAt=async(match:Address,seat:number)=>new V3Client(await localIdentity(`dustpact-v3-agent:${genesis}:${match}:${seat}`),url,config);
    if(options.match){
      options.onProgress?.(['Читаем состав и условия сохранённого матча…','Reading the saved roster and match terms…']);
      match=address(options.match.trim());const g=await owner.read(match);
      if(!g.seats.slice(0,g.count).some(s=>s.owner===owner.signer.address||s.session===owner.signer.address)){if(g.phase!==0)throw Error("Матч уже начался; это место принадлежит другому кошельку. / Match started; another wallet owns this seat.");if(!options.signer)await owner.fundLocal();await owner.join(match);}
      if(options.network==='local'&&g.creator===owner.signer.address&&g.phase===0&&options.agents){bots=await completeAgentRoster(owner,match,options.count??4,seat=>botAt(match,seat),(seat,total)=>options.onProgress?.([`Подключаем спутника ${seat} из ${total}…`,`Joining companion ${seat} of ${total}…`]));}
      else if(options.network==="local"&&g.creator===owner.signer.address){for(let seat=0;seat<g.count;seat++)if(g.npcMask&(1<<seat)){const bot=await botAt(match,seat);if(bot.signer.address!==g.seats[seat].owner)throw Error("Локальный профиль агента отсутствует; чужие места не подписываются. / Agent identity is unavailable; another seat is not signed.");bots.push(bot);}}
    }
    else {
      options.onProgress?.(['Создаём экспедицию в Solana…','Creating the expedition in Solana…']);
      match=await owner.create(undefined,created=>options.onCreated?.(created,options.agents?(options.count??4):undefined));
      if(options.agents)bots=await completeAgentRoster(owner,match,options.count??4,seat=>botAt(match,seat),(seat,total)=>options.onProgress?.([`Подключаем спутника ${seat} из ${total}…`,`Joining companion ${seat} of ${total}…`]));
      else await owner.configureMission(match,0,false);
    }
    options.onProgress?.(['Проверяем состав и загружаем игровое состояние…','Verifying the roster and loading game state…']);
    const controller=new OnlineController(owner,match,options.network,bots,config,fees);
    await controller.initialize();return controller;
  }catch(e){fees?.dispose();owner.cancelPendingSignatures();throw e;}
}
export class OnlineController implements GameController {
  get ownerAvailable(){return !!this.game&&this.game.seats[this.seat]?.owner===this.owner.signer.address;} readonly recoveryAvailable=true;
  private game!:GameV3; private vault:Mission|null=null; private view!:GameView;
  private final:GameV3|null=null; private finalVault:Mission|null=null; private genesis=""; private listeners=new Set<()=>void>();
  private replay:Awaited<ReturnType<typeof verifyV3History>>|undefined; private replayKey='';
  private session:V3Client|null=null; private sessionPaused=false; private prepared:PreparedMove|null=null;
  private backup:PreparedMove|null=null;
  private preparedStatus:"missing"|"verified"|"invalid"="missing";
  private botMoves=new Map<number,PreparedMove>(); private plannedStage=-1;
  private transaction?:TransactionUpdate; private disposed=false; private busy=false; private polling=false;private pumping=false;
  private pumpFlight:Promise<void>|null=null;
  private timer:ReturnType<typeof setTimeout>|null=null; private seat=0;
  private communityClient:V3Community|undefined;
  get community(){
    if(!this.ownerAvailable||typeof location==='undefined')return undefined;
    if(this.communityClient)return this.communityClient;
    const configured=(import.meta.env as Record<string,unknown>).VITE_DUSTPACT_V3_API_URL;
    const base=typeof configured==='string'&&configured?configured:this.network==='local'&&['127.0.0.1','localhost'].includes(location.hostname)?`${location.protocol}//${location.hostname}:4197`:undefined;
    if(!base)return undefined;
    try{this.communityClient=new V3Community({protocol:{game:PROGRAM_V3,vault:VAULT_PROGRAM,version:3},base,origin:location.origin,cluster:this.network==='local'?'localnet-v2':'devnet',signer:this.owner.signer,match:this.match,creator:this.game.creator,genesis:this.genesis,storage:sessionStorage,
      validateContext:async()=>{this.alive();if(!this.ownerAvailable)throw Error('Chat owner changed');const genesis=await this.owner.rpc.getGenesisHash().send();this.alive();if(!this.ownerAvailable||genesis!==this.genesis)throw Error('Chat context changed');}});}catch{return undefined;}
    return this.communityClient;
  }
  constructor(private owner:V3Client,private match:Address,private network:"local"|"devnet",private bots:V3Client[],private options:ClientOptions,private fees?:FeeConnectionV3){this.owner.onTransaction=e=>{this.transaction=e;this.publish();};}
  snapshot=()=>this.view;
  subscribe=(f:()=>void)=>{this.listeners.add(f);return()=>this.listeners.delete(f);};
  private actor(){return this.session&&!this.sessionPaused?this.session:this.owner;}
  async initialize(){this.genesis=await this.owner.rpc.getGenesisHash().send();await this.read();await this.restoreMove();this.schedule();await this.pump();}
  private alive(){if(this.disposed)throw Error("Игровой контекст закрыт. / Game context closed.");}
  private async read(){
    const g=await this.owner.read(this.match);this.alive();
    this.seat=this.owner.seat(g);this.owner.activeSeat=this.seat;if(this.session)this.session.activeSeat=this.seat;
    this.game=g;this.vault=await this.owner.readVault(this.match);this.alive();
    try{this.final=await this.owner.readFinalized(this.match);}catch{this.final=null;}
    if(this.final?.phase===5){const key=JSON.stringify(this.final,(_,v)=>typeof v==='bigint'?v.toString():v instanceof Uint8Array?Array.from(v):v);if(this.replayKey!==key){this.replay=await verifyV3History(this.final);this.replayKey=key;}}
    try{this.finalVault=await this.owner.readVaultFinalized(this.match);}catch{this.finalVault=null;}
    this.alive();
    if(this.session){const s=g.seats[this.seat];if(s.session!==this.session.signer.address||!s.quota||Number(s.expires)<=this.owner.chainNow()){this.sessionPaused=true;await this.session.reconcilePending(this.match);const f=this.final?.seats[this.seat],finalizedInactive=f&&f.owner===s.owner&&(f.session!==this.session.signer.address||!f.quota||Number(f.expires)<=this.owner.chainNow());if(finalizedInactive&&!(await this.session.pending(this.match)).length){this.session.cancelPendingSignatures();this.session=null;this.sessionPaused=false;}}}
    const priorBackup=this.backup;
    if(this.prepared&&(this.prepared.stage!==g.stage||this.prepared.owner!==g.seats[this.seat].owner||this.prepared.seat!==this.seat)){this.clearPrepared();}
    if(this.prepared){try{await this.checkMove(JSON.stringify(this.envelope(this.prepared)));this.preparedStatus='verified';}catch{this.clearPrepared('invalid');}}
    if(!this.prepared&&(g.committed&(1<<this.seat))){for(const p of [priorBackup,this.backup]){if(!p)continue;try{await this.checkMove(JSON.stringify(this.envelope(p)));this.prepared=p;this.preparedStatus='verified';break;}catch{/* Retain material; an incompatible backup is not signing authority. */}}}
    if(this.plannedStage===g.stage&&!g.seats[this.seat].planningReady)this.plannedStage=-1;
    this.publish();
  }
  private publish(){if(!this.game||this.disposed)return;const g=this.game;
    const offers=[...g.offers.filter(p=>p.status===1),...g.deals.slice(0,g.dealCount)];
    const history:Receipt[]=g.history.flatMap((h,i)=>!h.complete?[]:[projectReceipt(g,h,i,seat=>this.name(seat),this.final?.history[i])]);
    this.view={version:3,match:this.match,network:this.network,stage:g.stage,phase:g.phase,hull:g.hull,count:g.count,seat:this.seat,seats:g.seats.slice(0,g.count).map((s,i)=>({owner:s.owner,name:this.name(i),npc:!!(g.npcMask&(1<<i)),resources:[...s.resources]as Bundle,reserved:[...s.reserved]as Bundle,support:s.support,delivered:s.delivered,forfeited:s.forfeited,seal:s.seal,bound:s.bound===255?null:s.bound,ready:g.phase===0?s.ready:s.planningReady,offerNonce:s.offerNonce,sessionQuota:s.quota})),offers:offers.map(p=>this.pact(p)),history,bridgeOpen:v3BridgeOpen(g.flags),committed:g.committed,revealed:g.revealed,seconds:Math.max(0,Number(g.deadline)-this.owner.chainNow()),revision:Number(g.revision),arrived:g.arrived,sessionActive:!!this.session,sessionPaused:this.sessionPaused,transaction:this.transaction,vault:this.vaultView(),preparedStatus:this.preparedStatus,replay:this.replay,fees:{enabled:!!this.fees,payer:this.fees?.feePayer},...(this.prepared?{preparedChoice:{action:this.prepared.action,route:this.prepared.route,delivery:this.prepared.delivery}}:{})};
    this.view.automaticPlanApproved=this.plannedStage===g.stage&&this.preparedStatus==='verified';
    for(const f of this.listeners)f();
  }
  private name(i:number){return i===this.seat?"Вы":this.game.npcMask&(1<<i)?names[i]??`Агент ${i+1}`:`Игрок ${i+1}`;}
  private pact(p:Offer):Pact{return {maker:p.maker,taker:p.taker,provider:p.provider,kind:p.kind,action:p.action,delivery:p.delivery,gives:structuredClone(p.gives),nonce:p.nonce,stage:p.stage,status:p.status===1?"open":p.status===2?"accepted":p.status===3?"cancelled":"expired",...(p.jobSlot===255?{}:{job:p.jobSlot})};}
  private vaultView():VaultView|undefined {
    const m=this.vault;if(!m)return undefined;const g=this.game,now=this.owner.chainNow(),pinned=g.mission!==SYSTEM&&g.missionRoster===g.roster&&m.roster===g.roster&&m.eligibleMask===g.eligibleMask;
    const slots=m.slots.map((s,id)=>{
      const job=g.history[1]?.complete?g.history[1].jobs.find(j=>j.slot===id&&j.provider===s.provider&&j.owner===s.owner&&j.nonce===s.nonce):undefined;
      const refundable=s.status===0?(now>=Number(m.fundedAt)+86400||g.history[1]?.complete||g.stage>1||g.phase>=5||g.phase===0&&!pinned):s.status===1&&job?.executed===false;
      const finalized=!!this.finalVault&&same(s,this.finalVault.slots[id])&&(s.status!==1||!!this.final?.history[1]?.complete&&same(g.history[1],this.final.history[1]));
      return {id,status:s.status===2?"paid":s.status===3?"refunded":s.status===0?"open":job?.executed?"earned":"reserved",...(s.status===0||s.owner===SYSTEM?{}:{provider:s.provider,recipient:s.owner}),refundable:!!refundable,proof:finalized?"finalized":"confirmed"} as VaultView["slots"][number];
    });
    return {active:pinned,funded:true,test:true,mint:USDC_MINT,issuer:this.network==="local"?"local-fixture":"devnet",amount:20,slots,refundable:slots.some(s=>s.refundable),sponsor:m.sponsor};
  }
  private async operation(action:()=>Promise<void>):Promise<Operation>{
    if(this.busy)return{ok:false,error:"Другая операция ещё завершается. / Another operation is finishing."};
    const phase=this.game.phase,scope=this.moveScope(this.game,this.seat),actor=this.actor().signer.address;
    this.busy=true;let timer:ReturnType<typeof setTimeout>|undefined;
    try{
      this.alive();
      if(this.pumpFlight)await Promise.race([this.pumpFlight,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error("Агент ещё сверяет прежнюю операцию. Попробуйте после синхронизации; подпись игрока не запрошена. / An agent is still reconciling its operation. Retry after sync; no player signature was requested.")),20000);})]);
      this.alive();
      if(this.game.phase!==phase||this.moveScope(this.game,this.seat)!==scope||this.actor().signer.address!==actor)throw Error("Игровой контекст изменился, пока агент завершал работу. Проверьте новый этап и повторно выберите действие. / Game context changed while the agent finished. Review the current phase and select the action again.");
      await action();this.alive();await this.read();return{ok:true};
    }catch(e){return{ok:false,error:e instanceof Error?e.message:String(e)};}
    finally{if(timer)clearTimeout(timer);this.busy=false;if(!this.disposed)void this.pump();}
  }
  refresh=async():Promise<Operation>=>{if(this.busy||this.polling)return{ok:false,error:"Синхронизация уже выполняется. / Sync already running."};this.polling=true;try{await this.owner.reconcilePending(this.match);if(this.session)await this.session.reconcilePending(this.match);await this.read();return{ok:true};}catch(e){return{ok:false,error:e instanceof Error?e.message:String(e)};}finally{this.polling=false;}};
  ready=()=>this.operation(async()=>{const reviewed=await reviewConfig(this.match,this.game);await this.actor().ready(this.match,reviewed);});
  start=()=>this.operation(async()=>{await this.owner.start(this.match);});
  private pactOperation(action:()=>Promise<void>){this.plannedStage=-1;this.publish();return this.operation(action);}
  offer=(terms:PactTerms,bountySlot?:number)=>this.pactOperation(async()=>{const p=structuredClone(terms);if(p.stage!==this.game.stage||p.maker!==this.seat)throw Error("Offer context changed");const intent=await reviewOfferIntent(this.match,this.game,this.seat,{taker:p.taker,provider:p.provider,kind:p.kind,action:p.action,delivery:p.delivery,offerNonce:p.nonce,gives:p.gives,jobSlot:bountySlot??255});await this.actor().offer(this.match,intent);});
  accept=(p:Pact)=>this.pactOperation(async()=>{const reviewed=await reviewOffer(this.match,this.game,p.maker);if(!same(this.pact(reviewed.offer),p))throw Error("Показанные условия изменились. / Displayed terms changed.");await this.actor().accept(this.match,reviewed);});
  cancel=()=>this.pactOperation(async()=>{const offer=this.game.offers[this.seat];if(!offer||offer.status!==1)throw Error("No open offer");await this.actor().cancel(this.match,offer.nonce);});
  planReady=(move:Move)=>this.operation(async()=>{const choice=structuredClone(move);if(this.game.phase!==1||this.game.committed&(1<<this.seat))throw Error("Planning already closed");const p=this.prepared&&this.preparedStatus==='verified'&&sameChoice(this.prepared,choice)?this.prepared:await prepareMove(this.match,this.game,this.seat,choice);await this.checkMove(JSON.stringify(this.envelope(p)));this.persistMove(p);this.prepared=p;this.preparedStatus="verified";this.plannedStage=-1;await this.actor().stageReady(this.match);this.plannedStage=this.game.stage;});
  revisePlan=()=>{
    // Stop automation immediately, including while waiting for an existing pump. Keep the old
    // preimage/journal for a phase race, refusal, rollback or lost acknowledgement.
    this.plannedStage=-1;
    return this.operation(async()=>{
      const stage=this.game.stage;
      if(this.game.phase!==1)throw Error('Planning is closed; the retained approved choice is unchanged.');
      await this.actor().stageReady(this.match,false);
      await this.read();
      if(this.game.phase!==1||this.game.stage!==stage||this.game.seats[this.seat].planningReady)
        throw Error('Readiness withdrawal is not observed in this Planning phase; reconcile the retained choice.');
      // Editing is unlocked by canonical ready=false. The next explicit approval replaces
      // the backup; withdrawing readiness alone never deletes it or enables auto-signing.
    });
  };
  commit=(move:Move)=>this.operation(async()=>{const choice=structuredClone(move);if(this.game.phase!==2||this.game.committed&(1<<this.seat))throw Error("Commit phase closed or already stored");if(this.prepared&&!sameChoice(this.prepared,choice))throw Error("Показанный план отличается от сохранённого. Откройте проверенный план; другой выбор не подписан. / Displayed choice differs from the saved plan. Open the verified plan; no different choice was signed.");const p=this.prepared??await prepareMove(this.match,this.game,this.seat,choice);await this.checkMove(JSON.stringify(this.envelope(p)));this.persistMove(p);this.prepared=p;this.preparedStatus="verified";await this.actor().commit(this.match,p);});
  reveal=()=>this.operation(async()=>{if(this.game.phase!==3||!(this.game.committed&(1<<this.seat)))throw Error('План не закреплён: раскрытие невозможно. / No commitment exists for this seat.');if(this.game.revealed&(1<<this.seat))throw Error('План уже раскрыт. / Plan already revealed.');if(!this.prepared||this.preparedStatus!=='verified')throw Error("Копия скрытого плана отсутствует или не подходит. Импортируйте исходную копию. / Import the original verified plan.");const p=await this.checkMove(JSON.stringify(this.envelope(this.prepared)));await this.actor().reveal(this.match,p);});
  advance=()=>this.operation(async()=>{const intent={stage:this.game.stage,phase:this.game.phase};await this.actor().advance(this.match,intent);});
  resolve=()=>this.operation(async()=>{await this.actor().resolve(this.match,this.game.stage);});
  enableSession=()=>this.operation(async()=>{if(this.network!=="local")throw Error("Игровые сессии Devnet пока отключены: безопасная оплата их комиссии ещё не настроена. / Devnet sessions are disabled until their fee funding is configured.");if(this.session)throw Error("Сначала подтвердите отзыв прежней сессии и сверку её операций. / Confirm the previous session revocation and reconcile its operations first.");const key=await generateKeyPairSigner(),session=new V3Client(key,this.owner.url,{...this.options,feeSponsor:this.owner.feeSponsor});if(!this.owner.feeSponsor)await session.fundLocal();const expiry=BigInt(this.owner.chainNow()+7200);await this.owner.authorizeSession(this.match,key.address,expiry);this.alive();this.session=session;this.sessionPaused=false;session.activeSeat=this.seat;session.onTransaction=e=>{this.transaction=e;this.publish();};});
  enableFeeSupport=()=>this.operation(async()=>{if(this.fees)return;const connection=await FeeConnectionV3.connect({protocol:PROTOCOL3,base:feeBase(this.network),origin:location.origin,cluster:this.network==='local'?'localnet-v2':'devnet',genesis:this.genesis,owner:this.owner.signer,validate:async()=>{this.alive();if(!this.ownerAvailable||await this.owner.rpc.getGenesisHash().send()!==this.genesis)throw Error('Fee owner or network changed');}});this.alive();this.owner.setFeeSponsor(connection);this.session?.setFeeSponsor(connection);this.fees=connection;});
  disableFeeSupport=()=>this.operation(async()=>{this.sessionPaused=!!this.session;this.owner.setFeeSponsor(undefined);this.session?.setFeeSponsor(undefined);this.fees?.dispose();this.fees=undefined;this.publish();if(this.session)await this.owner.revokeSession(this.match);});
  revokeSession=()=>this.operation(async()=>{this.sessionPaused=!!this.session;this.publish();await this.owner.revokeSession(this.match);});
  private moveKey(){return `dustpact:v3:move:${this.genesis}:${this.match}:${this.seat}:${this.game.seats[this.seat].owner}`;}
  private envelope(p:PreparedMove){return privateMoveEnvelope(p,this.genesis);}
  private persistMove(p:PreparedMove){this.alive();if(typeof localStorage==="undefined")throw Error("Persistent move storage unavailable");const previous=this.prepared??this.backup;if(previous&&previous.owner===p.owner&&previous.seat===p.seat&&!same(previous.commitment,p.commitment)){localStorage.setItem(this.moveKey()+':previous',JSON.stringify(this.envelope(previous)));this.backup=previous;}localStorage.setItem(this.moveKey(),JSON.stringify(this.envelope(p)));}
  private clearPrepared(status:"missing"|"invalid"="missing"){if(this.prepared)this.backup=this.prepared;this.prepared=null;this.preparedStatus=status;this.plannedStage=-1;}
  private async restoreMove(){
    this.prepared=null;this.backup=null;this.plannedStage=-1;
    try{const raw=localStorage.getItem(this.moveKey()),previous=localStorage.getItem(this.moveKey()+':previous'),scope={game:this.game,match:this.match,genesis:this.genesis,seat:this.seat};const candidates:Array<{p:PreparedMove;primary:boolean}>=[];
      for(const [i,value] of [raw,previous].entries()){if(!value)continue;try{const p=await verifyPrivateBackupCandidate(value,scope);this.alive();candidates.push({p,primary:i===0});}catch{/* Corrupt/foreign materials are not exported or used. */}}
      this.backup=candidates[0]?.p??null;this.preparedStatus=raw?'invalid':'missing';
      for(const candidate of candidates){const p=candidate.p;if(!candidate.primary&&!(this.game.committed&(1<<this.seat)))continue;try{const checked=await this.checkMove(JSON.stringify(this.envelope(p)));this.prepared=checked;this.preparedStatus='verified';this.backup=candidates.find(c=>c.p!==p)?.p??null;break;}catch{/* Keep only validated material for explicit recovery; never approve it silently. */}}
    }catch{this.preparedStatus='invalid';}this.publish();
  }
  private moveCopy(){return [this.prepared,this.backup].find(p=>p&&p.owner===this.game.seats[this.seat]?.owner&&p.seat===this.seat&&p.match===this.match)??null;}
  exportMove=()=>{const p=this.moveCopy();return p?JSON.stringify(this.envelope(p)):null;};
  exportRecovery=async()=>{
    const original=this.moveCopy(),scope={game:structuredClone(this.game),match:this.match,genesis:this.genesis,seat:this.seat},key=this.moveScope(this.game,this.seat),move=original?structuredClone(original):null,session=this.session;
    const records=(await Promise.all([this.owner.pending(this.match),...(session?[session.pending(this.match)]:[])])).flat();
    this.alive();if(key!==this.moveScope(this.game,this.seat)||session!==this.session||original!==this.moveCopy())throw Error('Recovery context changed; refresh before exporting');
    return recoveryBundle(scope,move,records,session?.signer.address);
  };
  private async checkMove(json:string){
    const g=this.game,seat=this.seat,scope=this.moveScope(g,seat);
    const p=await verifyPrivateMoveCopy(json,{game:g,seat,match:this.match,genesis:this.genesis});this.alive();
    // A fresh poll object is harmless; changed owners/configuration/stage/binding is not.
    if(this.seat!==seat||this.moveScope(this.game,seat)!==scope)throw Error("Контекст изменился при проверке. / Context changed during verification.");
    const current=this.game,s=current.seats[seat];
    if(s.bound!==255&&s.bound!==p.action||(current.committed&(1<<seat))&&!same(p.commitment,current.commitments[seat]))throw Error("Копия не совпадает с закреплённым планом или обязательством. / Copy does not match the commitment or bound work.");
    return p;
  }
  private moveScope(g:GameV3,seat:number){return JSON.stringify({config:Array.from(configBytes(this.match,g)),stage:g.stage,seat,bound:g.seats[seat]?.bound,work:Array.from(workContextBytes(g,seat))});}
  importMove=(json:string)=>this.operation(async()=>{if(json.length>16384)throw Error("Move copy too large");const p=await this.checkMove(json);this.persistMove(p);this.prepared=p;this.preparedStatus="verified";this.plannedStage=-1;});
  get canConfigureMission(){return this.game.phase===0&&this.ownerAvailable&&this.game.creator===this.owner.signer.address;}
  get canFundMission(){return this.game.phase===0&&this.ownerAvailable&&!this.vault&&(this.canConfigureMission||this.game.mission!==SYSTEM&&this.game.missionRoster===this.game.roster);}
  fundMission=()=>this.operation(async()=>{
    if(!this.canFundMission)throw Error('Only the lobby creator can configure a mission; another owner can fund an already pinned mission.');
    if(this.game.mission===SYSTEM||this.game.missionRoster!==this.game.roster){
      if(!this.canConfigureMission)throw Error('Ask the lobby creator to pin mission terms first.');
      await this.owner.configureMission(this.match,this.game.npcMask,true);
    }
    await this.owner.fund(this.match);
  });
  claim=(slot:number)=>this.operation(async()=>{await this.actor().claim(this.match,slot);});
  refund=()=>this.operation(async()=>{await this.read();const slots=this.vaultView()?.slots.filter(s=>s.refundable)??[];if(!slots.length)throw Error("Нет задания с доступным возвратом. / No job is currently refundable.");for(const s of slots)await this.owner.refund(this.match,s.id);});
  private policyState(){const g=this.game;return {count:g.count,stage:g.stage,hull:g.hull,flags:g.flags,npcMask:g.npcMask,deals:g.deals.slice(0,g.dealCount).map(p=>({active:true,kind:p.kind,maker:p.maker,taker:p.taker,provider:p.provider,action:p.action,delivery:p.delivery,job:p.jobSlot,gives:p.gives})),players:g.seats.slice(0,g.count).map((s,i)=>({npc:!!(g.npcMask&(1<<i)),resources:s.resources,reserved:s.reserved,bound:s.bound===255?null:s.bound,support:s.support,delivered:s.delivered,forfeited:s.forfeited}))};}
  private canOffer(deal:V3Deal){
    const g=this.game,s=g.seats[deal.maker];if(g.dealCount>=Math.floor(g.count/2)||s.offerCount>=3)return false;
    if(deal.kind===2&&g.stage===2&&g.deals.slice(0,g.dealCount).filter(p=>p.kind===2).length>=v3ProductionSlots(g.flags))return false;
    return !reviewTerms({...this.view,seat:deal.maker},{...deal,nonce:s.offerNonce,stage:g.stage});
  }
  private async planBot(bot:V3Client,seat:number){
    let g=this.game,s=g.seats[seat],own=g.offers[seat];
    const incoming=g.offers.find(p=>p.status===1&&p.taker===seat);
    // Cancellation is an actual maker operation; accepting one pact never invents expiry of another.
    if(own?.status===1&&(incoming||!g.seats[own.taker].seal||own.taker===this.seat&&g.seats[this.seat].planningReady)){
      await bot.cancel(this.match,own.nonce);await this.read();g=this.game;s=g.seats[seat];own=g.offers[seat];
    }
    if(this.busy)return;
    const offer=g.offers.find(p=>p.status===1&&p.taker===seat);
    if(s.seal&&offer){
      const deal:V3Deal={active:true,kind:offer.kind,maker:offer.maker,taker:offer.taker,provider:offer.provider,action:offer.action,delivery:offer.delivery,job:offer.jobSlot,gives:offer.gives};
      if(v3AgentAccepts(deal,this.policyState().players[seat],personalities[seat],this.policyState())){
        await bot.accept(this.match,await reviewOffer(this.match,g,offer.maker));await this.read();g=this.game;s=g.seats[seat];
      }
    }
    if(this.busy)return;
    if(s.seal&&s.offerCount<3&&g.offers[seat]?.status!==1){
      if(g.seats[this.seat].planningReady){
        // Other agents may negotiate once the player's ready bit is public, never from their private move.
        for(const peerBot of this.bots){const peer=peerBot.seat(g);if(peer===seat||!g.seats[peer].seal)continue;
          const deal=v3AgentOffers(this.policyState(),seat,peer,personalities[seat]).find(d=>this.canOffer(d)&&v3AgentAccepts(d,this.policyState().players[peer],personalities[peer],this.policyState()));
          if(deal){await bot.offer(this.match,await reviewOfferIntent(this.match,g,seat,{taker:peer,provider:deal.provider,kind:deal.kind,action:deal.action,delivery:deal.delivery,offerNonce:s.offerNonce,gives:deal.gives,jobSlot:255}));break;}
        }
      }else if(g.seats[this.seat].seal&&!g.offers.some(p=>p.status===1&&p.taker===this.seat&&p.maker!==this.seat)){
        const initiator=this.bots.map(b=>b.seat(g)).filter(i=>g.seats[i].seal&&g.seats[i].offerCount<3).sort((a,b)=>g.stage===5?g.seats[b].resources[2]-g.seats[a].resources[2]||a-b:g.seats[b].resources[1]-g.seats[a].resources[1]||a-b).find(i=>v3AgentOffers(this.policyState(),i,this.seat,personalities[i]).some(d=>this.canOffer(d)));
        if(initiator===seat){const deal=v3AgentOffers(this.policyState(),seat,this.seat,personalities[seat]).find(d=>this.canOffer(d));if(deal)await bot.offer(this.match,await reviewOfferIntent(this.match,g,seat,{taker:this.seat,provider:deal.provider,kind:deal.kind,action:deal.action,delivery:deal.delivery,offerNonce:s.offerNonce,gives:deal.gives,jobSlot:255}));}
      }
    }
    await this.read();if(!this.busy&&this.game.phase===1&&!this.game.seats[seat].planningReady)await bot.stageReady(this.match);
  }
  private pump():Promise<void>{
    if(this.disposed||this.busy||this.pumping||this.polling||this.transaction?.stage==="unknown_transport"||this.transaction?.stage==="not_submitted")return Promise.resolve();
    this.pumping=true;const flight=this.runPump().finally(()=>{if(this.pumpFlight===flight)this.pumpFlight=null;});this.pumpFlight=flight;return flight;
  }
  private async runPump(){
    try{
      if(this.bots.length){
        for(const bot of this.bots){this.alive();if(this.busy)break;await this.read();if(this.busy)break;const g=this.game,seat=bot.seat(g);bot.activeSeat=seat;const s=g.seats[seat];
          if(g.phase===0){if(!s.ready)await bot.ready(this.match,await reviewConfig(this.match,g));continue;}
          if(g.phase===1){
            await this.planBot(bot,seat);continue;
          }
          if(g.phase===2&&!(g.committed&(1<<seat))){const move=chooseV3AgentMove(this.policyState(),seat,s.bound,personalities[seat]);const p=await prepareMove(this.match,g,seat,move);this.botMoves.set(seat,p);await bot.commit(this.match,p);continue;}
          if(g.phase===3&&!(g.revealed&(1<<seat))){const p=this.botMoves.get(seat);if(p&&p.stage===g.stage&&g.committed&(1<<seat))await bot.reveal(this.match,p);continue;}
        }
      }
      await this.read();if(this.busy)return;const g=this.game;
      if(this.session&&!this.sessionPaused&&this.prepared&&this.plannedStage===g.stage){const actor=this.session;if(g.phase===2&&!(g.committed&(1<<this.seat)))await actor.commit(this.match,this.prepared);else if(g.phase===3&&!(g.revealed&(1<<this.seat))&&g.committed&(1<<this.seat))await actor.reveal(this.match,this.prepared);}
      await this.read();if(this.busy)return;const now=this.game;const all=(1<<now.count)-1;
      const legal=now.phase===1?(now.seats.slice(0,now.count).every(s=>s.planningReady)||this.owner.chainNow()>=Number(now.deadline)):now.phase===2?(now.committed===all||this.owner.chainNow()>=Number(now.deadline)):now.phase===3?(now.revealed===now.committed||this.owner.chainNow()>=Number(now.deadline)):false;
      const independent=this.bots[0];if(independent&&legal)await independent.advance(this.match,{stage:now.stage,phase:now.phase});else if(independent&&now.phase===4)await independent.resolve(this.match,now.stage);
      await this.read();
    }catch(e){if(!this.disposed){const message=e instanceof Error?e.message:String(e);if(message.includes("unknown")||message.includes("rolled back")){this.transaction={stage:"unknown_transport",error:message};this.publish();}}}
    finally{this.pumping=false;}
  }
  private schedule(){this.timer=setTimeout(async()=>{if(this.disposed)return;if(!this.busy&&!this.polling&&!this.pumping){this.polling=true;try{await this.owner.reconcilePending(this.match);if(this.session)await this.session.reconcilePending(this.match);await this.read();}catch(e){if(!this.disposed){this.transaction={stage:"unknown_transport",error:e instanceof Error?e.message:String(e)};this.publish();}}finally{this.polling=false;}await this.pump();}if(!this.disposed)this.schedule();},1600);}
  dispose(){this.disposed=true;this.fees?.dispose();this.communityClient?.dispose();if(this.timer)clearTimeout(this.timer);this.owner.cancelPendingSignatures();this.session?.cancelPendingSignatures();for(const bot of this.bots)bot.cancelPendingSignatures();this.listeners.clear();this.prepared=null;this.backup=null;this.botMoves.clear();}
}
