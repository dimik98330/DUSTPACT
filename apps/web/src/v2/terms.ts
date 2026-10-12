import { actionContent, type Text } from "./content";
import { free, type Bundle, type GameView, type PactTerms } from "./model";
export function defaultTerms(g: GameView, partner: number, kind: number): PactTerms {
  const maker = g.seat, me = free(g.seats[maker]), other = free(g.seats[partner]);
  let gives: [Bundle,Bundle] = [[0,0,0],[0,0,0]];
  let action = g.stage === 0 ? 3 : g.stage === 2 ? 4 : g.stage === 1 || g.stage === 4 ? 3 : 1;
  if (kind === 2) {
    const water = g.stage === 0 ? 2 : 1;
    gives[0][0] = Math.min(water,me[0]); gives[1][0] = water-gives[0][0];
    gives[0][1] = me[1] && !other[1] ? 1 : 0; gives[1][1] = 1-gives[0][1];
  } else if (kind === 1) gives[0] = [Math.min(1,me[0]),0,0];
  else if(kind===3){action=5;gives[0]=me[2]>0?[0,0,1]:[Math.min(1,me[0]),0,0];}
  else { gives[0] = [Math.min(1,me[0]),0,0]; gives[1] = [0,Math.min(1,other[1]),0]; action=0; }
  return { maker,taker:partner,provider:partner,kind,action,delivery:kind===3?Math.min(3,other[2]):0,gives,nonce:g.seats[maker].offerNonce ?? 0,stage:g.stage };
}
/** UI preflight only; native program remains authoritative. */
export function reviewTerms(g: GameView, p: PactTerms): Text | null {
  if(!Number.isInteger(p.kind)||p.kind<0||p.kind>(g.version===3?3:2)||p.stage!==g.stage||!Number.isInteger(p.nonce)||p.nonce<0)return ["Вид договора, этап или номер предложения изменился.","Pact kind, encounter or offer nonce is invalid."];
  const invalid = p.gives.flat().some(n=>!Number.isInteger(n)||n<0||n>5);
  if(invalid) return ["Количество каждого ресурса: целое число от 0 до 5.","Each resource amount must be an integer from 0 to 5."];
  if(p.maker!==g.seat||p.maker===p.taker||p.taker<0||p.taker>=g.count||![p.maker,p.taker].includes(p.provider)) return ["Выберите участника этой экспедиции.","Choose a participant in this expedition."];
  if(g.phase!==1) return ["Предложения доступны во время обсуждения плана.","Offers are available during planning."];
  if(!g.seats[p.maker].seal||!g.seats[p.taker].seal) return ["Печать одной из сторон уже занята в этой встрече.","One partner's seal is already used at this encounter."];
  if(p.kind===0&&!p.gives.flat().some(Boolean)) return ["Пустой обмен не нужен: добавьте ресурс хотя бы с одной стороны.","Add a resource on at least one side of the exchange."];
  if(p.kind===1) {
    if(g.version===3&&g.stage===5&&p.action!==1)return ['У города заказ работы закрепляет только охрану. Для доставки выберите пакт доставки.','At the city a work order binds guarding only. Choose DeliveryPledge for cargo.'];
    if(![1,2,3].includes(p.action)) return ["Заказ может закрепить охрану, воду или ремонт.","A work order may bind guard, gathering water or repair."];
    if(p.gives[p.provider===p.maker?0:1].some(Boolean)) return ["Исполнитель получает оплату и не отдаёт её встречным платежом.","The provider receives payment without a counterpayment."];
    if(p.delivery<0||p.delivery>(p.action===2?3:0)||!Number.isInteger(p.delivery)) return ["Передача новой воды возможна только при поиске воды, от 0 до 3.","New water may be delivered only by gathering, from 0 to 3."];
  }
  if(p.kind===2) {
    if(![0,2].includes(g.stage)) return ["Совместное производство доступно у колодца и в кладовой.","Joint production is available at the well and cache."];
    const recipe = g.stage===0?[2,1,0]:[1,1,0];
    if(recipe.some((n,i)=>p.gives[0][i]+p.gives[1][i]!==n)) return ["Суммарные вложения должны точно совпадать с рецептом.","Combined contributions must match the recipe exactly."];
    if(p.action!==(g.stage===0?3:4)||p.delivery!==0) return ["Действие проекта должно соответствовать рецепту.","The project action must match its recipe."];
  }
  if(p.kind===3){
    const side=p.provider===p.maker?0:1;
    if(g.version!==3||g.stage!==5||p.action!==5||!Number.isInteger(p.delivery)||p.delivery<1||p.delivery>5)return ['Пакт доставки: только у города, от 1 до 5 заработанного груза.','DeliveryPledge is city-only, for 1 to 5 earned cargo.'];
    if(p.gives[side].some(Boolean)||!p.gives[1-side].some(Boolean))return ['Поставщик резервирует свой груз и получает непустую цену от другой стороны.','The provider reserves owned cargo and receives a nonzero price.'];
    if(g.seats[p.provider].resources.some((n,j)=>n+p.gives[1-side][j]>200))return ['Входящая цена превышает предел запаса исполнителя.','The incoming price exceeds the provider inventory cap.'];
  }
  for(const [index,seat] of [p.maker,p.taker].entries()) {
    const required=[...p.gives[index]];
    if(p.kind===3&&seat===p.provider)required[2]+=p.delivery;
    if(p.kind===1&&seat===p.provider) {
      const incoming=p.gives[1-index], cost=actionContent(g.stage,p.action,0).cost;
      for(let r=0;r<3;r++) required[r]+=Math.max(0,cost[r]-incoming[r]);
    }
    const available=free(g.seats[seat]);
    if(required.some((n,i)=>n>available[i])) return ["Одна из сторон не располагает свободными ресурсами для этих условий.","A partner does not have the free resources required by these terms."];
  }
  return null;
}
