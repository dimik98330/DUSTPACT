import { advisoryWorkboard, encounterBrief } from '../../../../packages/engine/src/v2-design';
import { advisoryWorkboardV3, encounterBriefV3 } from '../../../../packages/engine/src/v3-design';
import { V2_INITIAL } from '../../../../packages/engine/src/v2';
import type { GameView, Pact, PactTerms, Receipt } from './model';
import type { Text } from './content';

export const designState = (g:GameView) => ({count:g.count,stage:g.stage,hull:g.hull,flags:g.bridgeOpen?2:0,phase:g.phase,arrived:g.arrived,players:g.seats,
  deals:g.offers.filter(p=>p.status==='accepted').map(p=>({...p,active:true,job:p.job??255}))});
export const workboardFor = (g:GameView) => (g.version===3?advisoryWorkboardV3:advisoryWorkboard)(designState(g),g.seat);
export const briefingFor = (g:GameView) => (g.version===3?encounterBriefV3:encounterBrief)(designState(g),g.seat);
/** Action, route and delivery are one reviewed Move and must share the same edit lock. */
export function reviewedPlanFrozen(g:GameView){
 return g.phase>2||g.phase<1||!!(g.committed&(1<<g.seat))||g.phase>=2&&g.preparedStatus==='verified'||
  g.network!=='practice'&&g.phase===1&&g.seats[g.seat].ready||
  g.transaction?.stage==='unknown_transport'||g.transaction?.stage==='not_submitted';
}
/** A copy never substitutes for the seat's on-chain commitment. */
export function revealChoiceState(g:GameView):'closed'|'uncommitted'|'revealed'|'needs-copy'|'ready'{
 if(g.phase!==3)return 'closed';
 if(!(g.committed&(1<<g.seat)))return 'uncommitted';
 if(g.revealed&(1<<g.seat))return 'revealed';
 if(g.preparedStatus!=='verified'||!g.preparedChoice)return 'needs-copy';
 return 'ready';
}
export function incomingPact(g:GameView):Pact|undefined {
  return g.offers.find(p=>p.status==='open'&&p.stage===g.stage&&p.taker===g.seat);
}
export function usefulPartner(g:GameView):number {
  const incoming=incomingPact(g); if(incoming)return incoming.maker;
  const accepted=g.offers.find(p=>p.status==='accepted'&&[p.maker,p.taker].includes(g.seat));
  if(accepted)return accepted.maker===g.seat?accepted.taker:accepted.maker;
  if(g.count>=4){const candidate=workboardFor(g).partners.find(p=>p.available&&p.suggestions.length>0);if(candidate)return candidate.seat;}
  return g.seat===0?1:0;
}
export function pactHeadline(p:PactTerms,g:GameView):Text {
 if(p.kind===3)return p.provider===g.seat?[`Взять обязательство доставить ${p.delivery} груза`,`Commit to deliver ${p.delivery} cargo`]:[`Закрепить ${p.delivery} груза партнёра`,`Bind ${p.delivery} partner cargo`];
 const side=p.maker===g.seat?0:1,mine=p.gives[side],other=p.gives[1-side];
 if(p.kind===2)return g.stage===0?(mine[0]===2&&mine[1]===0&&other[0]===0&&other[1]===1?['Твои 2 воды + инструмент партнёра → по 4 воды','Your 2 water + partner’s tool → 4 water each']:['Колодец: соединить запасы и разделить 8 воды','Well: combine supplies and share 8 water']):['Вложиться в груз и разделить результат','Fund cargo and share the output'];
 if(p.kind===0)return ['Обменять запасы сейчас','Swap supplies now'];
 if(p.provider===g.seat)return p.action===3?['Взять заказ на ремонт','Accept a repair job']:p.action===1?['Взять заказ на охрану','Accept a guard job']:['Взять заказ на поставку воды','Accept a water delivery job'];
 return p.action===3?['Закрепить ремонт партнёра','Bind a partner’s repair']:p.action===1?['Купить вклад в охрану','Buy a guard contribution']:['Заказать поставку воды','Order a water delivery'];
}
/** Actual retained changes; includes work, trades and drinking. Not a simulated future result. */
export function receiptDelta(g:GameView,r:Receipt){
 const before=r.stage===0?V2_INITIAL[g.seat]:g.history.find(h=>h.stage===r.stage-1)?.resources[g.seat];
 return before?r.resources[g.seat].map((n,i)=>n-before[i]):null;
}
export const TOUR_KEY='dustpact-v2-first-pact-v1';
export const TOUR_STEPS=['caravan','water','tools','cargo','objective','partner','deal','reserve','action','resolve','receipt','solana'] as const;
export type TourStep=typeof TOUR_STEPS[number];
export function tourGate(step:TourStep,g:GameView,selectedAction:number):boolean {
 const completed=g.history.some(r=>r.stage===0&&r.pacts?.some(p=>p.kind===2&&[p.maker,p.taker].includes(g.seat)&&r.work?.some(w=>w.executed&&w.provider===p.provider&&w.action===p.action)));
 if(completed)return true;
 if(step==='deal')return g.stage===0&&g.offers.some(p=>p.status==='accepted'&&p.kind===2&&p.taker===g.seat);
 if(step==='reserve')return g.stage===0&&g.seats[g.seat].reserved[0]===2;
 if(step==='action')return g.stage===0&&selectedAction===2;
 if(step==='resolve'||step==='receipt')return completed;
 return true;
}
