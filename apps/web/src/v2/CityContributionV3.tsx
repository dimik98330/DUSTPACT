import {cityPlanning} from '../../../../packages/engine/src/v3-design';
import {designState} from './gameplay';
import type {GameView,Move} from './model';
import {cityOwnCargo} from './city-preview';
export default function CityContributionV3({game:g,move,disabled,language,onChange}:{game:GameView;move:Move;disabled:boolean;language:string;onChange(delivery:number):void}){
 const say=(ru:string,en:string)=>language==='en'?en:ru,me=g.seats[g.seat],city=cityPlanning(designState(g));
 const {pledged:q,total,remaining}=cityOwnCargo(g,move);
 const free=Math.max(0,me.resources[2]-me.reserved[2]),max=Math.min(5-q,free+(g.revealed&(1<<g.seat)?move.delivery:0));
 const target=move.route?city.emergency:city.normal;
 return <section data-guide="city-contribution" className="v2-city-contribution">
  <h3>{say('Твоя роль у ворот','Your role at the gates')}</h3>
  <p>{say(`Закреплено договорами: ${city.pledgedTotal} груза и ${city.fixedGuards} охранников.`,`Pacts bind ${city.pledgedTotal} cargo and ${city.fixedGuards} guards.`)}</p>
  {move.action===5?<>
   <p><b>{say(`Твоя обязательная доставка: ${q}.`,`Your pledged delivery: ${q}.`)}</b> {say('Она исполнится при пропуске раскрытия; свободная добавка — нет.','It survives a missed reveal; voluntary extra does not.')}</p>
   <label className="v2-field">{q?say(`Добавить свободно (0–${max})`,`Voluntary extra (0–${max})`):say(`Доставить своим действием (1–${max})`,`Deliver with your action (1–${max})`)}<input type="number" min={q?0:1} max={max} step={1} value={move.delivery} disabled={disabled} onChange={e=>onChange(Number(e.target.value))}/></label>
   {q>0&&<button disabled={disabled} onClick={()=>onChange(0)}>{say('Только закреплённая часть','Pledged quantity only')}</button>}
   <p>{say(`Итого от тебя: ${total}. После цены и доставки останется ${remaining} груза.`,`Your total delivery: ${total}. After price and delivery you retain ${remaining} cargo.`)}</p>
  </>:<p>{move.action===6?say('Работа даст 1 личного груза. Это отдельное действие: новый груз нельзя тут же доставить.','Work earns 1 personal cargo. It is a separate action: newly earned cargo cannot be delivered now.'):move.action===1?say('Охрана даёт 2 защиты и занимает действие. Твой груз не доставляется.','Guarding adds 2 defense and takes your action. Your cargo is not delivered.'):say('Ожидание сохраняет запасы, но не добавляет доставку или эскорт.','Waiting keeps supplies but adds neither delivery nor escort.')}</p>}
  <div aria-live="polite"><p>{say(`Твой голос: нужно ${target.goal} груза и ${target.escortGoal} разных охранников.`,`Your vote requires ${target.goal} cargo and ${target.escortGoal} distinct guards.`)}</p>
   {target.cargoShortfall>0&&<p className="v2-warning">{say(`По нынешним свободным запасам не хватает ${target.cargoShortfall} доставки. Проверь цену или перераспредели груз.`,`Current available inventory is short by ${target.cargoShortfall} delivery. Review the price or redistribute cargo.`)}</p>}
   {target.actionShortfall>0&&<p className="v2-warning">{say(`Груз распределён между слишком многими доставщиками: не хватает ${target.actionShortfall} действий эскорта. Поможет обмен, объединяющий груз.`,`Cargo needs too many couriers: ${target.actionShortfall} escort actions are missing. A consolidating barter can help.`)}</p>}
   {remaining>=0&&<p>{say(`Если прибудете без потери зачёта: оставшийся груз и эта доставка дадут ${3*remaining+total} очков; прежний и новый вклад считаются отдельно.`,`If you arrive without forfeiture: retained cargo and this delivery score ${3*remaining+total}; past and new contribution are separate.`)}</p>}
   <small>{say('Это условия твоего голоса и открытые запасы, а не прогноз чужих планов. Итоговый путь решит большинство.','These are your vote’s conditions and public stocks, not a prediction of hidden plans. The majority determines the route.')}</small>
  </div>
 </section>;
}
