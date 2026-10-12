import {expeditionDebrief as base,type DebriefGame,type DebriefReceipt} from './v2-debrief';
export type {DebriefGame,DebriefReceipt,DebriefPact} from './v2-debrief';
/** Reuse score/conservation math; explain the extra escort gate from retained protocol3 fields. */
export function expeditionDebrief(g:DebriefGame){
 const d={...base(g),escortFailure:false};const r=g.history.find(r=>r.stage===5) as (DebriefReceipt&{escortGoal?:number;escortProgress?:number})|undefined;
 if(!r)return d;
 const e=d.encounters.find(e=>e.stage===5);if(!e)return d;
 const target=r.escortGoal??(r.route?Math.ceil(g.count/2):0),actual=r.escortProgress??r.actions.filter(a=>a===1).length;
 e.facts.push([`Эскорт: ${actual} из ${target} разных охранников.`,`Escort: ${actual} of ${target} distinct guards.`]);
 if(actual<target){e.headline=['Для обхода не хватило эскорта','The detour lacked escorts'];d.escortFailure=true;d.failureCauses=d.failureCauses.filter(c=>c!=='missing-result');}
 else if(e.progress!==null&&e.progress>=e.goal)e.headline=['Доставка и условие эскорта выполнены','Delivery and escort conditions were met'];
 return d;
}
