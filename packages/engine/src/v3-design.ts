import {advisoryWorkboard as baseBoard,encounterBrief as baseBrief,v2Free,type DesignState,type DesignText} from './v2-design';
export {v2BridgeOpen as v3BridgeOpen,v2ProductionSlots as v3ProductionSlots,v2Rejection as v3Rejection} from './v2-design';
export {advisoryWorkboardV3 as advisoryWorkboard,encounterBriefV3 as encounterBrief};
export type {DesignState,DesignPlayer,DesignText} from './v2-design';
/** Conditional public inventory/action capacity; never a prediction of hidden plans or votes. */
export function cityPlanning(g:DesignState){
 const pacts=(g.deals??[]).filter(d=>d.active),pledged=g.players.map((_,i)=>pacts.find(d=>d.kind===3&&d.provider===i)?.delivery??0);
 const fixedGuards=pacts.filter(d=>d.kind===1&&d.action===1).map(d=>d.provider);
 const capacity=g.players.map((p,i)=>fixedGuards.includes(i)?0:Math.min(5,v2Free(p)[2]+pledged[i]));
 const water=g.players.map(p=>p.resources[0]);for(const d of pacts.filter(d=>d.kind!==0)){water[d.maker]+=d.gives[1][0]-d.gives[0][0];water[d.taker]+=d.gives[0][0]-d.gives[1][0];}
 function route(goal:number,escortGoal:number){
  const fixed=pledged.flatMap((q,i)=>q>0?[i]:[]),chosen=new Set(fixed);let need=Math.max(0,goal-pledged.reduce((a,b)=>a+b,0));
  for(const i of fixed){const add=Math.min(need,capacity[i]-pledged[i]);need-=add;}
  for(const {i,q}of capacity.map((q,i)=>({i,q})).filter(x=>!chosen.has(x.i)&&x.q>0).sort((a,b)=>b.q-a.q)){if(!need)break;chosen.add(i);need-=Math.min(need,q);}
  const couriers=chosen.size,freeEscorts=g.count-couriers,thirst=water.filter(w=>w<=0).length;
  return {goal,escortGoal,couriers,freeEscorts,cargoShortfall:need,actionShortfall:Math.max(0,escortGoal-freeEscorts),possibleFromStocks:need===0&&freeEscorts>=escortGoal&&g.hull-thirst-(escortGoal?Math.max(0,g.count+4-2*freeEscorts):0)>0};
 }
 return {authority:'conditional-public-capacity' as const,pledged,capacity,pledgedTotal:pledged.reduce((a,b)=>a+b,0),fixedGuards:fixedGuards.length,normal:route(g.count,0),emergency:route(Math.ceil(g.count/2),Math.ceil(g.count/2))};
}
export function advisoryWorkboardV3(g:DesignState,seat=0){
 const board=baseBoard(g,seat);if(g.stage!==5)return board;
 const city=cityPlanning(g),me=v2Free(g.players[seat]);
 const partners=board.partners.map(p=>{
  const free=v2Free(g.players[p.seat]),suggestions:typeof p.suggestions=[];
  const price:[number,number,number]=me[2]>0?[0,0,1]:me[0]>1?[1,0,0]:[0,0,0];
  if(free[2]>0&&price.some(Boolean))suggestions.push({kind:3,action:5,provider:p.seat,delivery:Math.min(3,free[2]),gives:[price,[0,0,0]],reason:['Резервирует заработанный груз и действие доставки партнёра. Цена не гарантирует общий проход.','Reserves a partner’s earned cargo and delivery action. Payment does not guarantee arrival.'],opportunityCost:['Партнёр отказывается от рынка и охраны. Твоя цена уменьшает свободные запасы.','The partner gives up market work and guarding. Your payment reduces free inventory.']});
  if(free[2]>0&&me[0]>1)suggestions.push({kind:0,action:0,provider:p.seat,delivery:0,gives:[[Math.min(3,me[0]-1),0,0],[0,0,1]],reason:['Купи груз сейчас и доставь своим действием. Это меняет владельца, а не обещает чужую доставку.','Buy cargo now and deliver with your own action. Ownership changes; no partner delivery is promised.'],opportunityCost:['Понадобится твоё действие Deliver; за раз не больше5.','You need your own Deliver action, capped at5.']});
  if(price.some(Boolean))suggestions.push({kind:1,action:1,provider:p.seat,delivery:0,gives:[price,[0,0,0]],reason:['Закрепляет одного охранника для эскорта. Этот участник не сможет доставлять.','Binds one escort guard. That actor cannot also deliver.'],opportunityCost:['Охранник отказывается от рынка; его груз остаётся у него.','The guard gives up market work and keeps their cargo.']});
  return {...p,suggestions};
 });
 const need:DesignText=[`Ворота: ${g.count} груза. Обход: ${Math.ceil(g.count/2)} груза и ${Math.ceil(g.count/2)} разных охранника. Закреплено доставки: ${city.pledgedTotal}.`,`Gate: ${g.count} cargo. Detour: ${Math.ceil(g.count/2)} cargo and ${Math.ceil(g.count/2)} distinct guards. Pledged delivery: ${city.pledgedTotal}.`];
 return {...board,need,guaranteed:city.pledgedTotal,remaining:Math.max(0,g.count-city.pledgedTotal),partners,solana:['Solana резервирует цену, груз и действие. В квитанции обязательство отдельно от свободной добавки.','Solana reserves price, cargo and action. The receipt separates the pledge from voluntary extra.']as DesignText};
}
export function encounterBriefV3(g:DesignState,seat=0){
 const brief=baseBrief(g,seat);if(g.stage!==5)return brief;
 return {...brief,situation:['У ворот одно действие: доставка, охрана или личный заработок. Пустой запас не заменит чужой вклад.','One gate action: deliver, guard or earn privately. Empty inventory cannot replace a partner’s work.']as DesignText,dilemma:['Купи чужую доставку, получи груз обменом или доверься обещанию. Цена может оставить тебя без собственного вклада.','Buy a partner’s delivery, acquire cargo by barter or trust a promise. Payment may leave you short for your own contribution.']as DesignText,choices:[[`${g.count} груза: доставка тратит действие; остальные могут заработать на рынке.`,`${g.count} cargo: delivery takes an action; others can earn at the market.`],[`${Math.ceil(g.count/2)} груза и столько же охранников: меньше груза, больше занятых действий.`,`${Math.ceil(g.count/2)} cargo and as many guards: less cargo, more occupied actions.`]]as[DesignText,DesignText]};
}
