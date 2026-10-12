/** Disclosed public-state policies. No hidden moves, LLM claims or promised victory. */
import {chooseV2AgentMove,v2AgentOffers as baseOffers,v2AgentAccepts as baseAccepts,type V2AgentState} from './v2-bots';
import {v2Free} from './v2-design';
import {V2_PERSONALITIES,type V2Personality} from './v2-npc';
import type {V3Move,V3Deal} from './v3';
export type {V2Personality as V3Personality} from './v2-npc';
export type V3AgentState=V2AgentState&{npcMask?:number};
export function cityAssignments(s:V3AgentState){
 const deals=(s.deals??[]).filter(d=>d.active),pledges=s.players.map((_,i)=>deals.find(d=>d.kind===3&&d.provider===i)?.delivery??0);
 const boundGuards=new Set(deals.filter(d=>d.kind===1&&d.action===1).map(d=>d.provider));
 const capacity=s.players.map((p,i)=>{
  const npc=!!((s.npcMask??0)&(1<<i));
  if(boundGuards.has(i))return 0;
  if(npc&&pledges[i]>0)return pledges[i];
  return Math.min(npc&&V2_PERSONALITIES[i]==='trader'?1:5,pledges[i]+v2Free(p)[2]);
 });
 const route=capacity.reduce((a,b)=>a+b,0)<s.count?1:0;
 const deliveries=[...pledges];let need=Math.max(0,(route?Math.ceil(s.count/2):s.count)-pledges.reduce((a,b)=>a+b,0));
 const order=s.players.map((_,i)=>i).sort((a,b)=>(a%3===0?1:0)-(b%3===0?1:0)||capacity[b]-capacity[a]||a-b);
 for(const i of order){const q=Math.min(need,capacity[i]-pledges[i]);deliveries[i]+=q;need-=q;}
 const guards=[...boundGuards],freeActors=order.filter(i=>deliveries[i]===0&&!boundGuards.has(i)).sort((a,b)=>(a===0?1:0)-(b===0?1:0)||a-b);
 if(route)guards.push(...freeActors.slice(0,Math.max(0,Math.ceil(s.count/2)-guards.length)));
 return {route,deliveries,guards,pledges,capacity,deliveryShortfall:need};
}
export function chooseV3AgentMove(s:V3AgentState,seat:number,bound?:number,personality:V2Personality='supplier'):V3Move{
 if(s.stage!==5)return chooseV2AgentMove(s,seat,bound,personality);
 const plan=cityAssignments(s),free=v2Free(s.players[seat]);
 if(bound===5)return {action:5,route:plan.route,delivery:0};
 if(bound===1)return {action:1,route:plan.route,delivery:0};
 let delivery=Math.min(5,free[2],plan.deliveries[seat]);
 // Traders disclose a voluntary limit; a pact or an ownership transfer can change the result.
 if(personality==='trader')delivery=Math.min(1,delivery);
 return {action:delivery>0?5:plan.guards.includes(seat)?1:6,route:plan.route,delivery};
}
export function v3AgentOffers(s:Parameters<typeof baseOffers>[0],maker:number,taker:number,personality:V2Personality='supplier'):V3Deal[]{
 if(s.stage!==5)return baseOffers(s,maker,taker,personality);
 const me=v2Free(s.players[maker]),other=v2Free(s.players[taker]),common={active:true,maker,taker,provider:maker,job:255};
 const price:[number,number,number]=personality==='trader'&&other[2]>0?[0,0,1]:other[0]>1?[1,0,0]:[0,0,0];
 const offers:V3Deal[]=[];
 if(me[2]>0&&price.some(Boolean))offers.push({...common,kind:3,action:5,delivery:Math.min(3,me[2]),gives:[[0,0,0],price]});
 if(me[2]>0&&other[0]>1)offers.push({...common,kind:0,action:0,delivery:0,gives:[[0,0,1],[Math.min(personality==='trader'?3:1,other[0]-1),0,0]]});
 if(me[2]===0&&price.some(Boolean))offers.push({...common,kind:1,action:1,delivery:0,gives:[[0,0,0],price]});
 return offers;
}
export function v3AgentAccepts(d:V3Deal,inventory:Parameters<typeof baseAccepts>[1],personality:V2Personality,context?:Parameters<typeof baseAccepts>[3]):boolean{
 if(context?.stage!==5)return baseAccepts(d,inventory,personality,context);
 const free=v2Free(inventory),side=d.taker===d.provider?1:0,paid=d.gives[1],received=d.gives[0];
 if(paid.some((v,j)=>!Number.isInteger(v)||v<0||v>5||v>free[j]))return false;
 if(d.kind===0){const value=(b:number[])=>b[0]+3*b[2];return value(received)>=value(paid)&&received.some(Boolean);}
 if(side!==1)return d.kind===3&&free[0]>1&&paid[0]<=1&&paid[2]<=1;
 if(d.kind===3&&(d.delivery<1||d.delivery>Math.min(5,free[2])))return false;
 const value=received[0]+3*received[2];return value>=(personality==='trader'?3:1);
}
