import {cityPlanning} from '../../../../packages/engine/src/v3-design';
import {designState} from './gameplay';
import type {GameView,Move,PactTerms} from './model';
/** Barter already settled at acceptance; only deferred work prices change the future balance. */
export function cityOwnCargo(g:GameView,move:Move){
 const me=g.seats[g.seat],p=g.offers.find(p=>p.status==='accepted'&&p.kind!==0&&[p.maker,p.taker].includes(g.seat));
 const side=p?.maker===g.seat?0:1,paid=p?.gives[side][2]??0,received=p?.gives[1-side][2]??0;
 const pledged=g.offers.find(p=>p.status==='accepted'&&p.kind===3&&p.provider===g.seat)?.delivery??0,total=move.action===5?pledged+move.delivery:0;
 return {pledged,total,remaining:me.resources[2]-paid+received-total+(move.action===6?1:0)};
}
/** Conditional consequence of acceptance, not consent or a forecast of hidden actions. */
export function pactCityPreview(g:GameView,p:PactTerms){
 if(g.version!==3||g.stage!==5||p.kind!==3||![p.maker,p.taker].includes(p.provider)||p.maker===p.taker||p.maker<0||p.taker<0||p.maker>=g.count||p.taker>=g.count||!Number.isInteger(p.delivery)||p.delivery<1||p.delivery>5||p.gives.flat().some(n=>!Number.isInteger(n)||n<0||n>5))return null;
 const state=structuredClone(designState(g)),existing=g.offers.find(o=>o.maker===p.maker&&o.nonce===p.nonce&&o.stage===p.stage&&(o.status==='open'||o.status==='accepted'));
 if(existing?.status!=='accepted'){
  const providerSide=p.provider===p.maker?0:1;
  for(const [side,seat]of[p.maker,p.taker].entries())if(!(side===0&&existing?.status==='open'))for(let j=0;j<3;j++)state.players[seat].reserved[j]+=p.gives[side][j]+(side===providerSide&&j===2?p.delivery:0);
  state.deals.push({...p,active:true,status:'accepted',job:255});
 }
 return cityPlanning(state);
}
