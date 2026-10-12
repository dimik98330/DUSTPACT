import type { GameV3, Offer, Summary } from '../../../../packages/solana-v3/src/types';
import { observationKey } from '../../../../packages/solana-v3/src/reader';
import { v3Rejection } from '../../../../packages/engine/src/v3-design';
import type { Bundle, GameView, Pact, Receipt } from './model';

export function projectPact(p: Offer): Pact {
 return { maker:p.maker, taker:p.taker, provider:p.provider, kind:p.kind, action:p.action,
  delivery:p.delivery, gives:structuredClone(p.gives), nonce:p.nonce, stage:p.stage,
  status:p.status===1?'open':p.status===2?'accepted':p.status===3?'cancelled':'expired',
  ...(p.jobSlot===255?{}:{job:p.jobSlot}) };
}

/** Only public reveals and accepted obligations have a current-action label. */
export function visibleMove(g: GameV3, seat: number) {
 if (g.revealed & (1 << seat)) return { type:'revealed' as const, action:g.actions[seat], route:g.routes[seat], delivery:g.deliveries[seat] };
 if (g.seats[seat].bound !== 255) return { type:'bound' as const, action:g.seats[seat].bound };
 return { type:'hidden' as const };
}

/** Scene camera anchor is seat zero; the spectator has no seat or personal game controls. */
export function projectObserverScene(g: GameV3, match: string, network: 'local'|'devnet', name:(i:number)=>string, finalized:boolean):GameView {
 return {version:3,match,network,stage:g.stage,phase:g.phase,hull:g.hull,count:g.count,seat:0,
  seats:g.seats.slice(0,g.count).map((s,i)=>({owner:s.owner,name:name(i),npc:!!(g.npcMask&(1<<i)),resources:[...s.resources]as Bundle,reserved:[...s.reserved]as Bundle,support:s.support,delivered:s.delivered,forfeited:s.forfeited,seal:s.seal,bound:s.bound===255?null:s.bound,ready:g.phase===0?s.ready:s.planningReady})),
  offers:[...g.offers.filter(p=>p.status===1),...g.deals.slice(0,g.dealCount)].filter(p=>!g.history[p.stage].complete).map(projectPact),
  history:g.history.flatMap((h,i)=>h.complete?[projectReceipt(g,h,i,name,finalized?h:undefined)]:[]),
  bridgeOpen:!!(g.flags&2),committed:g.committed,revealed:g.revealed,seconds:0,revision:Number(g.revision),arrived:g.arrived,sessionActive:false};
}

/** Derives explanations from retained native history; does not decide game outcomes. */
export function projectReceipt(g:GameV3,h:Summary,stage:number,name:(seat:number)=>string,final?:Summary):Receipt {
 const pacts=h.deals.slice(0,h.dealCount).map(p=>({...projectPact(p),status:'accepted' as const}));
 const work=pacts.filter(p=>p.kind!==0).flatMap(p=>{
  const job=p.job===undefined?undefined:h.jobs.find(j=>j.slot===p.job&&j.provider===p.provider&&j.nonce===p.nonce&&j.owner===g.seats[p.provider].owner);
  if(p.job!==undefined&&!job)return [];
  return [{provider:p.provider,action:p.action,executed:p.job===undefined?h.actions[p.provider]===p.action:job!.executed,consumed:[...h.inputs[p.provider]]as Bundle,delivered:p.kind===3?p.delivery:p.action===2?p.delivery:0,...(p.job===undefined?{}:{job:p.job,owner:g.seats[p.provider].owner,nonce:p.nonce})}];
 });
 const goal=stage===0||stage===2?1:stage===1?Math.ceil(g.count/2):stage===3?h.threat:stage===4?Math.ceil(g.count/3):h.route?Math.ceil(g.count/2):g.count;
 const progress=stage===0?h.actions.slice(0,g.count).filter(a=>a===3).length:stage===1||stage===4?h.actions.slice(0,g.count).filter(a=>a===3).length:stage===2?h.actions.slice(0,g.count).filter(a=>a===4).length:stage===3?h.guard:h.deliveries.slice(0,g.count).reduce((a,b)=>a+b,0);
 return {stage,route:h.route,hullBefore:stage?g.history[stage-1].hull:12,hullAfter:h.hull,threat:h.threat,defense:h.guard,actions:h.actions.slice(0,g.count),objective:h.objective,outcome:h.objective?'fulfilled':'unfulfilled',resources:structuredClone(h.resources.slice(0,g.count)),delivered:h.delivered.slice(0,g.count),support:h.support.slice(0,g.count),reasons:h.rejected.slice(0,g.count).flatMap((code,seat)=>code?[`${name(seat)}: ${v3Rejection(code).join(' / ')}`]:[]),proof:final?.complete&&observationKey(h)===observationKey(final)?'finalized':'confirmed',settlementKey:`${stage}:${h.revision}`,flags:h.flags,goal,progress,missingMask:h.missing,forfeitedMask:h.forfeited,rejectedCodes:h.rejected.slice(0,g.count),inputs:structuredClone(h.inputs.slice(0,g.count)),outputs:structuredClone(h.outputs.slice(0,g.count)),deliveries:h.deliveries.slice(0,g.count),pacts,work,escortGoal:h.escortGoal,escortProgress:h.escortProgress,pledged:h.pledged.slice(0,g.count),voluntary:h.voluntary.slice(0,g.count),pricesPaid:structuredClone(h.pricesPaid.slice(0,g.count)),pricesReceived:structuredClone(h.pricesReceived.slice(0,g.count))};
}
