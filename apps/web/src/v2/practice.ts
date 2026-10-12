import { createV2State, loadV2Kernel, resolveV2, v2Input, advanceV2State, applyV2Barter, reservesV2, type V2State, type V2Deal } from "../../../../packages/engine/src/v2";
import { chooseV2AgentMove, v2AgentOffers, v2AgentAccepts, type V2Personality } from "../../../../packages/engine/src/v2-bots";
import { v2BridgeOpen, v2ProductionSlots, v2Rejection } from "../../../../packages/engine/src/v2-design";
import type { GameController, GameView, Move, Pact, PactTerms, Operation, Bundle } from "./model";
import { reviewTerms } from "./terms";
import {V2_PERSONALITIES} from '../../../../packages/engine/src/v2-npc';
const personalities=V2_PERSONALITIES;
const names=["Вы","Айша","Тимур","Сая","Нура","Алан"];
const success=():Operation=>({ok:true});
const unavailable=async():Promise<Operation>=>({ok:false,error:"В практике нет кошельков, токенов или подписей. / Practice has no wallets, tokens or signatures."});
type StoredPact=Pact&{reserves:[Bundle,Bundle]};
const asDeal=(p:PactTerms):V2Deal=>({active:true,kind:p.kind,maker:p.maker,taker:p.taker,provider:p.provider,action:p.action,delivery:p.delivery,job:255,gives:structuredClone(p.gives)});
const publicPact=(p:StoredPact):Pact=>({maker:p.maker,taker:p.taker,provider:p.provider,kind:p.kind,action:p.action,delivery:p.delivery,gives:structuredClone(p.gives),nonce:p.nonce,stage:p.stage,status:p.status,...(p.job===undefined||p.job===255?{}:{job:p.job})});
export async function createPracticeController(count=4):Promise<GameController> {
  await loadV2Kernel();const c=new PracticeController(count);await c.initialize();return c;
}
class PracticeController implements GameController {
  readonly ownerAvailable=false;readonly recoveryAvailable=false;
  private state:V2State;private view:GameView;private listeners=new Set<()=>void>();
  private disposed=false;private working=false;private offers:StoredPact[]=[];private nonces:number[];private creations:number[];
  private historyPacts:Pact[][]=[];private revision=0;private id=`practice-${crypto.randomUUID()}`;
  constructor(count:number){this.state=createV2State(count);this.nonces=Array(count).fill(0);this.creations=Array(count).fill(0);this.view=this.convert();}
  async initialize(){await this.seedOffer();this.view=this.convert();}
  snapshot=()=>this.view;
  subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>this.listeners.delete(listener);};
  private convert():GameView {
    const s=this.state,accepted=this.offers.filter(p=>p.status==="accepted");
    const seats=s.players.map((p,i)=>({...p,resources:[...p.resources] as Bundle,reserved:[0,0,0] as Bundle,owner:`Practice seat ${i+1}`,name:names[i],npc:i!==0,seal:!this.offers.some(d=>(d.status==="open"&&d.maker===i)||(d.status==="accepted"&&(d.maker===i||d.taker===i))),bound:accepted.find(d=>d.kind!==0&&d.provider===i)?.action??null,ready:true,offerNonce:this.nonces[i]}));
    for(const p of this.offers){if(p.status==="open")for(let r=0;r<3;r++)seats[p.maker].reserved[r]+=p.reserves[0][r];else if(p.status==="accepted"&&p.kind!==0)for(const [index,seat]of[p.maker,p.taker].entries())for(let r=0;r<3;r++)seats[seat].reserved[r]+=p.reserves[index][r];}
    return {version:2,match:this.id,network:"practice",stage:s.stage,phase:s.finished?5:1,hull:s.hull,count:s.count,seat:0,seats,offers:this.offers.map(publicPact),history:s.history.map((r,i)=>({stage:i,route:r.route,hullBefore:i?s.history[i-1].hull:12,hullAfter:r.hull,threat:r.threat,defense:r.guard,actions:r.actions,objective:r.objective,outcome:r.objective?"fulfilled":"unfulfilled",resources:r.players.map(p=>[...p.resources]as Bundle),delivered:r.players.map(p=>p.delivered),support:r.players.map(p=>p.support),reasons:r.rejected.flatMap((code,seat)=>code?[`${names[seat]}: ${v2Rejection(code).join(" / ")}`]:[]),proof:"practice",settlementKey:`stage-${i}`,flags:r.flags,missingMask:r.missing,forfeitedMask:r.players.reduce((mask,p,seat)=>p.forfeited?mask|(1<<seat):mask,0),rejectedCodes:[...r.rejected],progress:r.progress,goal:r.goal,inputs:structuredClone(r.inputs),outputs:structuredClone(r.outputs),deliveries:[...r.deliveries],pacts:structuredClone(this.historyPacts[i]??[]),work:r.work.filter(w=>w.active).map(w=>({provider:w.provider,action:w.action,executed:w.executed,consumed:[...w.consumed]as Bundle,delivered:w.delivered,...(w.job===255?{}:{job:w.job})}))})),bridgeOpen:v2BridgeOpen(s.flags),committed:0,revealed:0,seconds:0,revision:this.revision,arrived:s.arrived,sessionActive:false,preparedStatus:"missing"};
  }
  private emit(){this.view=this.convert();if(!this.disposed)for(const f of this.listeners)f();}
  private async operation(action:()=>Promise<void>):Promise<Operation>{if(this.disposed)return{ok:false,error:"Practice closed"};if(this.working)return{ok:false,error:"Another action is in progress"};this.working=true;try{await action();this.revision++;this.emit();return success();}catch(e){this.emit();return{ok:false,error:e instanceof Error?e.message:String(e)};}finally{this.working=false;}}
  private policyState(){return {...this.state,deals:this.offers.filter(p=>p.status==="accepted").map(asDeal),players:this.convert().seats};}
  private async addOpen(deal:V2Deal){
    const maker=deal.maker,p:Pact={maker,taker:deal.taker,provider:deal.provider,kind:deal.kind,action:deal.action,delivery:deal.delivery,gives:structuredClone(deal.gives),nonce:this.nonces[maker],stage:this.state.stage,status:"open"};
    if(this.creations[maker]>=3||this.offers.some(p=>p.maker===maker&&p.status==="open"))return null;
    const invalid=reviewTerms({...this.convert(),seat:maker},p);if(invalid)return null;
    const reserves=await reservesV2(this.state.stage,asDeal(p));
    this.offers.push({...p,reserves});this.nonces[maker]++;this.creations[maker]++;this.view=this.convert();return this.offers.at(-1)!;
  }
  private async seedOffer(){
    // One initiator; other agents keep their seals for a player's custom terms.
    const makers=Array.from({length:this.state.count-1},(_,i)=>i+1).sort((a,b)=>this.state.players[b].resources[1]-this.state.players[a].resources[1]||a-b);
    for(const maker of makers)for(const deal of v2AgentOffers(this.policyState(),maker,0,personalities[maker]))if(await this.addOpen(deal))return;
  }
  private cancelCurrent(p:StoredPact,status:"cancelled"|"expired"="cancelled"){p.status=status;this.view=this.convert();}
  private cleanNpcOffers(){for(const p of this.offers)if(p.status==="open"&&p.maker!==0&&!this.convert().seats[p.taker].seal)this.cancelCurrent(p);}
  private async acceptCurrent(p:StoredPact){
    if(p.status!=="open"||p.stage!==this.state.stage)throw Error("Предложение уже изменилось. / Offer changed.");
    const view=structuredClone(this.convert());
    // The maker reservation is held. Exclude only this offer for acceptance preflight.
    view.seats[p.maker].seal=true;for(let r=0;r<3;r++)view.seats[p.maker].reserved[r]-=p.reserves[0][r];
    const reviewed=reviewTerms({...view,seat:p.maker},p);if(reviewed)throw Error(reviewed.join(" / "));
    if(this.offers.filter(p=>p.status==="accepted").length>=Math.floor(this.state.count/2))throw Error("Все места договоров заняты. / All pact slots are occupied.");
    if(p.kind===2&&this.state.stage===2&&this.offers.filter(d=>d.status==="accepted"&&d.kind===2).length>=v2ProductionSlots(this.state.flags))throw Error("Места добычи уже зарезервированы. / Production slots already reserved.");
    if(p.kind===0)this.state={...this.state,players:await applyV2Barter(this.state.players,p.maker,p.taker,p.gives)};
    p.status="accepted";this.view=this.convert();
  }
  private async pairAgents(){
    for(let maker=1;maker<this.state.count;maker++)for(let taker=maker+1;taker<this.state.count;taker++){
      const view=this.convert();if(!view.seats[maker].seal||!view.seats[taker].seal)continue;
      for(const deal of v2AgentOffers(this.policyState(),maker,taker,personalities[maker])){
        if(!v2AgentAccepts(deal,this.state.players[taker],personalities[taker],this.state))continue;
        const p=await this.addOpen(deal);if(!p)continue;
        try{await this.acceptCurrent(p);}catch{this.cancelCurrent(p);}break;
      }
    }
  }
  refresh=async()=>success();ready=async()=>success();start=async()=>success();
  offer=(terms:PactTerms)=>this.operation(async()=>{
    const p=structuredClone(terms);const invalid=reviewTerms(this.view,p);if(invalid)throw Error(invalid.join(" / "));
    if(p.nonce!==this.nonces[0])throw Error("Предложение изменилось. / Offer nonce changed.");
    const offer=await this.addOpen(asDeal(p));if(!offer)throw Error("Отмените прежнее предложение или проверьте лимит трёх условий. / Cancel the existing offer or check the three-offer limit.");
    this.cleanNpcOffers();
    if(v2AgentAccepts(asDeal(offer),this.state.players[p.taker],personalities[p.taker],this.state))await this.acceptCurrent(offer);
    else throw Error("Агент не принял условия по своей политике. Предложение остаётся открытым; отмените его и пересмотрите цену. / The agent declined under its policy. Your offer stays open; cancel it and revise the price.");
  });
  accept=(reviewed:Pact)=>this.operation(async()=>{const current=this.offers.find(p=>p.status==="open"&&p.maker===reviewed.maker&&p.nonce===reviewed.nonce);if(!current||JSON.stringify(publicPact(current))!==JSON.stringify(reviewed))throw Error("Условия изменились. / Terms changed.");if(current.taker!==0)throw Error("Это предложение адресовано другому участнику. / Another participant is the taker.");await this.acceptCurrent(current);this.cleanNpcOffers();});
  cancel=()=>this.operation(async()=>{const p=this.offers.find(p=>p.maker===0&&p.status==="open");if(!p)throw Error("Нет открытого предложения. / No open offer.");this.cancelCurrent(p);});
  planReady=(move:Move)=>this.operation(async()=>{
    if(this.state.finished)throw Error("Экспедиция завершена. / Expedition finished.");
    // Public readiness triggers peer negotiations; the agent policy never sees move.
    for(const p of this.offers)if(p.status==="open"&&p.taker===0&&p.maker!==0)this.cancelCurrent(p);
    await this.pairAgents();
    for(const p of this.offers)if(p.status==="open")this.cancelCurrent(p,"expired");
    const view=this.convert(),policy=this.policyState();
    const moves=this.state.players.map((_,i)=>i===0?structuredClone(move):chooseV2AgentMove(policy,i,view.seats[i].bound??undefined,personalities[i]));
    const accepted=this.offers.filter(p=>p.status==="accepted");
    const result=await resolveV2(v2Input(this.state,moves,accepted.map(asDeal)));
    this.historyPacts.push(accepted.map(publicPact));this.state=advanceV2State(this.state,result);this.offers=[];this.creations.fill(0);if(!this.state.finished)await this.seedOffer();
  });
  commit=unavailable;reveal=unavailable;advance=unavailable;resolve=unavailable;enableSession=unavailable;revokeSession=unavailable;
  exportMove=()=>null;importMove=unavailable;fundMission=unavailable;claim=unavailable;refund=unavailable;
  dispose(){this.disposed=true;this.listeners.clear();}
}
