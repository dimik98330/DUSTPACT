/** Replays retained outcomes with the canonical Rust/Wasm kernel, not a JS rules copy. */
import {createV2State,resolveV2,applyV2Barter,type V2Bundle,type V2Deal,type V2Player,V2_RULES_HASH}from'./v2';
export type ReplaySummary={complete:boolean;hull:number;route:number;threat:number;guard:number;objective:boolean;flags:number;actions:number[];routes:number[];deliveries:number[];missing:number;inputs:V2Bundle[];outputs:V2Bundle[];resources:V2Bundle[];support:number[];delivered:number[];forfeited:number;deals:Array<{status:number;kind:number;maker:number;taker:number;provider:number;action:number;delivery:number;gives:[V2Bundle,V2Bundle];jobSlot:number}>;dealCount:number};
export type ReplayMaterial={count:number;phase:number;stage:number;hull:number;flags:number;arrived:boolean;rulesHash:Uint8Array;contentHash:Uint8Array;seats:V2Player[];history:ReplaySummary[];scores:number[]};
const hex=(v:Uint8Array)=>Array.from(v,b=>b.toString(16).padStart(2,'0')).join('');
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
export async function verifyV2History(game:ReplayMaterial){
 const limits='Verifies retained effects. Rejected raw plans and unrevealed secrets are not reconstructible from the retained effective-action summaries; no claim to verify those preimages or external wallet ownership.';
 let checkedStages=0;
 try{
  if(hex(game.rulesHash)!==V2_RULES_HASH||hex(game.contentHash)!==V2_RULES_HASH||game.history.length!==6)throw Error('Unsupported rule/content or history layout');
  const state=createV2State(game.count);let players=state.players,hull=12,flags=0,arrived=false,scores=Array(game.count).fill(0),ended=false,gap=false;
  for(let stage=0;stage<6;stage++){
   const h=game.history[stage];if(!h.complete){gap=true;continue;}if(gap||ended)throw Error('Non-contiguous or impossible retained history');
   if(h.dealCount<0||h.dealCount>Math.floor(game.count/2)||h.deals.length!==3)throw Error('Invalid retained pact count');
   const deals:V2Deal[]=h.deals.slice(0,h.dealCount).map(d=>({active:true,kind:d.kind,maker:d.maker,taker:d.taker,provider:d.provider,action:d.action,delivery:d.delivery,job:d.jobSlot,gives:d.gives}));
   for(const d of deals){if(d.kind===0)players=await applyV2Barter(players,d.maker,d.taker,d.gives);}
   const result=await resolveV2({count:game.count,stage,hull,flags,players,moves:Array.from({length:game.count},(_,i)=>({action:h.actions[i],route:h.routes[i],delivery:h.deliveries[i]})),missing:h.missing,deals});
   const expected={hull:result.hull,route:result.route,threat:result.threat,guard:result.guard,objective:result.objective,flags:result.flags,actions:result.actions,deliveries:result.deliveries,inputs:result.inputs,outputs:result.outputs,resources:result.players.map(p=>p.resources),support:result.players.map(p=>p.support),delivered:result.players.map(p=>p.delivered),forfeited:result.players.reduce((bits,p,i)=>bits|(p.forfeited?1<<i:0),0)};
   const observed={hull:h.hull,route:h.route,threat:h.threat,guard:h.guard,objective:h.objective,flags:h.flags,actions:h.actions.slice(0,game.count),deliveries:h.deliveries.slice(0,game.count),inputs:h.inputs.slice(0,game.count),outputs:h.outputs.slice(0,game.count),resources:h.resources.slice(0,game.count),support:h.support.slice(0,game.count),delivered:h.delivered.slice(0,game.count),forfeited:h.forfeited};
   if(!same(expected,observed))throw Error(`Retained outcome differs at encounter ${stage+1}`);
   checkedStages++;players=result.players;hull=result.hull;flags=result.flags;arrived=result.arrived;scores=result.scores;ended=hull===0||stage===5;
  }
  if(game.phase===5){if(!ended||game.hull!==hull||game.flags!==flags||game.arrived!==arrived||!same(game.scores.slice(0,game.count),scores)||!same(game.seats.slice(0,game.count).map(p=>({resources:p.resources,support:p.support,delivered:p.delivered,forfeited:p.forfeited})),players))throw Error('Terminal state or scores differ from replay');}
  return {valid:true,checkedStages,scope:limits};
 }catch(e){return {valid:false,checkedStages,error:e instanceof Error?e.message:'Replay failed',scope:limits};}
}
