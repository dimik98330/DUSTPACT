/** Disclosed deterministic agent policies: public state only, never hidden player moves. */
import type { V2Input,V2Move,V2Deal,V2Player } from './v2';
import { v2Free, type DesignState, type DesignPlayer } from './v2-design';
import {V2_PERSONALITIES,type V2Personality} from './v2-npc';
export type {V2Personality} from './v2-npc';
export type V2AgentState=Pick<V2Input,'count'|'stage'|'players'|'flags'|'hull'>&{deals?:V2Deal[]};
export function v2RepairSeats(state:V2AgentState):number[]{
 const target=state.stage===1?Math.ceil(state.count/2):Math.ceil(state.count/3);
 const fixed=[...new Set((state.deals??[]).filter(d=>d.active&&d.kind!==0&&d.action===3).map(d=>d.provider))];
 const choices=state.players.map((p,seat)=>({seat,tools:v2Free(p)[1],npc:(p as V2Player&{npc?:boolean}).npc??seat!==0})).filter(p=>p.tools>0&&!fixed.includes(p.seat)&&(state.stage!==1||state.hull<=5||!p.npc||V2_PERSONALITIES[p.seat]==='builder'));
 choices.sort((a,b)=>(a.seat%3===2?0:1)-(b.seat%3===2?0:1)||a.seat-b.seat);
 return [...fixed,...choices.slice(0,Math.max(0,target-fixed.length)).map(p=>p.seat)];
}
export function chooseV2AgentMove(state:V2AgentState,seat:number,bound?:number,personality:V2Personality=seat%3===2?'builder':seat%3===0?'trader':'supplier'):V2Move {
 const p=state.players[seat],free=v2Free(p),s=state.stage;
 const repairers=state.players.filter(p=>v2Free(p)[1]>0).length;
 const bridgeWorkers=v2RepairSeats(state).length;
 const supplies=state.players.reduce((total,p)=>total+v2Free(p)[0],0);
 let action=0;
 if(bound!==undefined&&bound!==255)action=bound;
 else if(state.hull<=5&&free[1]>0&&s!==0)action=3;
 else if((s===1||s===4)&&v2RepairSeats(state).includes(seat))action=3;
 else if(free[0]< (s===4?3:2))action=2;
 else if(s===2&&free[1]>0&&(personality==='trader'||seat>=state.count-2))action=4;
 else if(s===3&&free[0]>1&&repairers<Math.ceil(state.count/3)&&personality!=='supplier')action=4;
 else if(s===0&&free[0]>=2&&free[1]>0&&personality==='builder')action=3;
 else if(s===3||s===2)action=personality==='supplier'&&supplies<state.count*2?2:1;
 else if(s===5)action=1;
 else action=2;
 // Delivery is a strategic commitment. Builders contribute; traders keep value
 // until the whole public cargo supply is too scarce to cover the gate.
 const cargoTotal=state.players.reduce((sum,p)=>sum+p.resources[2],0);
 const share=s===5?(personality==='trader'&&cargoTotal>state.count?Math.max(1,Math.ceil(state.count*free[2]/cargoTotal)):Math.min(5,free[2])):0;
 return {action,route:s===1&&bridgeWorkers<Math.ceil(state.count/2)?1:s===5&&cargoTotal<state.count?1:0,delivery:Math.min(5,free[2],share)};
}
export function v2AgentOffers(state:Pick<V2Input,'stage'|'players'|'count'>&{deals?:V2Deal[]},maker:number,taker:number,personality:V2Personality=maker%3===2?'builder':maker%3===0?'trader':'supplier'):V2Deal[] {
 const me=v2Free(state.players[maker]),peer=v2Free(state.players[taker]);const common={active:true,maker,taker,provider:maker,delivery:0,job:255};
 if(state.stage===0&&me[1]>0&&peer[0]>=2&&personality==='builder')return [{...common,kind:2,action:3,gives:[[0,1,0],[2,0,0]]}];
 if(state.stage===0&&me[1]>0&&peer[0]>0)return [{...common,kind:0,action:0,gives:[[0,1,0],[1,0,0]]}];
 const repairs=(state.deals??[]).filter(d=>d.active&&d.kind!==0&&d.action===3).length;
 const required=state.stage===1?Math.ceil(state.count/2):Math.ceil(state.count/3);
 if((state.stage===1||state.stage===4)&&repairs<required&&me[1]>0&&peer[0]>=1)return [{...common,kind:1,action:3,gives:[[0,0,0],[1,0,0]]}];
 if(state.stage===2&&me[1]>0&&peer[0]>0)return [{...common,kind:2,action:4,gives:[[0,1,0],[1,0,0]]}];
 if(state.stage===3&&peer[0]>0)return [{...common,kind:1,action:1,gives:[[0,0,0],[Math.min(personality==='trader'?2:1,peer[0]),0,0]]}];
 if(me[1]>0&&peer[0]>1)return [{...common,kind:0,action:0,gives:[[0,1,0],[1,0,0]]}];
 if(me[0]>2&&peer[1]>0)return [{...common,kind:0,action:0,gives:[[2,0,0],[0,1,0]]}];
 return [];
}
export function v2AgentAccepts(deal:V2Deal,inventory:V2Player,personality:V2Personality,context?:Pick<DesignState,'stage'|'count'|'hull'>):boolean {
 const side=deal.taker===deal.provider?1:0; // Callers evaluate an offer addressed to the agent.
 const free=v2Free(inventory),paid=deal.gives[1];if(paid.some((v,j)=>!Number.isInteger(v)||v<0||v>5||v>free[j]))return false;
 if(deal.kind===2)return (context?.stage===2&&personality==='trader')||inventory.resources[0]<4||personality==='builder';
 const received=deal.gives[0];
 if(received.some(v=>!Number.isInteger(v)||v<0||v>5))return false;
 if(deal.kind===0)return (received[0]>paid[0]&&(inventory.resources[0]<3||personality==='trader'&&received[0]+received[1]*2+received[2]*3>paid[0]+paid[1]*2+paid[2]*3))||(received[1]>paid[1]&&personality==='builder')||(received[2]>paid[2]&&personality==='trader');
 if(side===1){const stage=context?.stage??(deal.action===3?1:3);const tools=deal.action===3?1:0,water=deal.action===3&&stage===0?2:0;
  if(free[1]+received[1]<tools||free[0]+received[0]<water)return false;
  const payValue=received[0]+received[1]*2+received[2]*3;
  return payValue>= (personality==='trader'&&deal.action===1?2:1);
 }
 // At the bridge agents volunteer their own work or sell it; they do not automatically
 // purchase a second repair on the human's behalf. This public preference never reads the human move.
 return context?.stage!==1&&inventory.resources[0]>=3&&paid[0]<=1;
}
