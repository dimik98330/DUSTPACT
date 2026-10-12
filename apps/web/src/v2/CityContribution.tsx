import { cityContributionPreview } from '../../../../packages/engine/src/v2-design';
import type { GameView, Move } from './model';
import CityContributionV3 from './CityContributionV3';

export default function CityContribution({game:g,move,disabled,language,onChange}:{game:GameView;move:Move;disabled:boolean;language:string;onChange(delivery:number):void}){
 if(g.version===3)return <CityContributionV3 game={g} move={move} disabled={disabled} language={language} onChange={onChange}/>;
 const say=(ru:string,en:string)=>language==='en'?en:ru,me=g.seats[g.seat],free=Math.max(0,me.resources[2]-me.reserved[2]);
 let price:ReturnType<typeof cityContributionPreview>|null=null;
 try{price=cityContributionPreview(g.count,me,move.delivery,move.route);}catch{/* The ordinary move validator explains invalid input. */}
 return <section className="v2-city-contribution"><label className="v2-field">{say('Отдать груза городу (0–5)','Deliver cargo to the city (0–5)')}<input type="number" min={0} max={Math.min(5,free)} value={move.delivery} disabled={disabled} onChange={e=>onChange(Number(e.target.value))}/></label>
  {price&&<div aria-live="polite"><p>{say(`Из ${price.freeCargo} свободного груза отдаёшь ${price.delivery}; останется ${price.remainingFreeCargo}.`,`From ${price.freeCargo} free cargo, deliver ${price.delivery}; retain ${price.remainingFreeCargo}.`)}</p>
   <p>{say(`Твой вклад у ворот: ${price.delivery} из ${price.targetForYourVote}. От остальных всё ещё нужно ${price.stillNeededFromOthers}.`,`Your gate contribution: ${price.delivery} of ${price.targetForYourVote}. Others still need to supply ${price.stillNeededFromOthers}.`)}</p>
   <p>{price.personalEligible?say(`Если прибудете без потери зачёта: этот свободный груз даст ${price.scoreFromThisCargoIfArrival} очков. Передача стоит ${price.scoreCostComparedWithKeeping} возможных очков по сравнению с сохранением всего груза.`,`If you arrive without forfeiture: this free cargo scores ${price.scoreFromThisCargoIfArrival}. Delivery gives up ${price.scoreCostComparedWithKeeping} potential points compared with retaining all of it.`):say('Личный зачёт уже утрачен. Доставка всё ещё помогает общему прибытию; право оплаты выполненного TEST-задания проверяется отдельно.','Personal score is already forfeited. Delivery still helps shared arrival; completed TEST job payment is checked separately.')}</p>
   <small>{say('Показан твой голос за путь. Итог решает большинство; чужая доставка неизвестна. Это цена решения, не обещание итогового счёта.','This shows your route vote. The majority determines entry; other deliveries remain unknown. This is the choice price, not a final score promise.')}</small>
  </div>}
 </section>;
}
