import type { Bundle, GameView, Move } from "./model";
import { advisoryWorkboard } from "../../../../packages/engine/src/v2-design";
export type Text = [string, string];
export const words = (language: string, value: Text) => value[language === "en" ? 1 : 0];
export const names = ["Вы", "Айша", "Тимур", "Сая", "Нура", "Алан"];
export const EN_NAMES = ["You", "Aisha", "Timur", "Saya", "Nura", "Alan"];
export function seatLabel(name:string,language:string){
 if(language!=='en')return name;
 const i=names.indexOf(name);if(i>=0)return EN_NAMES[i];
 return name.replace(/^Игрок (\d+)$/,'Player $1');
}
export const encounterNames: Text[] = [
  ["Разрушенный колодец", "The broken well"], ["Сломанный мост", "The broken bridge"],
  ["Заброшенная кладовая", "The abandoned cache"], ["Засада", "The ambush"],
  ["Пыльная буря", "The dust storm"], ["Город за туманом", "The city beyond the mist"],
];
export function stageContent(g: GameView, observer=false): { goal: Text; need: Text; alternatives: [Text, Text]; aftermath: Text; routeRelevant: boolean } {
  const n = g.count;
  if(g.version===3&&g.stage===5)return {goal:['У ворот выбираешь одно: доставить груз, охранять или заработать лично.','At the gates choose one: deliver, guard or earn personally.'],need:[`Ворота: ${n} груза. Обход: ${Math.ceil(n/2)} груза и ${Math.ceil(n/2)} разных охранника.`,`Gate: ${n} cargo. Detour: ${Math.ceil(n/2)} cargo and ${Math.ceil(n/2)} distinct guards.`],alternatives:[['Обычный вход: больше груза, остальные могут работать на рынке.','Regular entry: more cargo; other actors can work at the market.'],['Обход: меньше груза, но действия нужны на эскорт.','Detour: less cargo, but escort actions are required.']],aftermath:['Обмен меняет владельца груза. Пакт резервирует чужую доставку и действие; успех всего каравана не гарантирован.','Barter transfers ownership. A pledge reserves a partner’s delivery and action; caravan success is not guaranteed.'],routeRelevant:true};
  const content = [
    { goal: ["Без воды караван не пройдёт дальше. Восстановите колодец вместе.", "The caravan needs water. Restore the well together."], need: ["Нужны 2 воды, 1 инструмент и один исполнитель. Получите 8 воды.", "Bring 2 water, 1 tool and one worker. Produce 8 water."], alternatives: [["Совместный проект: точные вложения, по 4 воды каждому.", "Joint project: fixed inputs, 4 water for each partner."], ["Обход: каждый пьёт 2 воды; колодец остаётся сломанным.", "Bypass: everyone drinks 2 water; the well stays broken."]], aftermath: ["Вода понадобится на мосту и при добыче груза.", "Water supports the bridge crossing and cargo production."] },
    { goal: ["Мост разрушен. Ремонт открывает до двух мест добычи; комплект нужен для каждого.", "The bridge is broken. Repairs permit up to two extraction slots; each still needs a kit."], need: [`Нужно ${Math.ceil(n / 2)} ремонтных действий. Каждое стоит 1 инструмент.`, `Need ${Math.ceil(n / 2)} repairs, costing 1 tool each.`], alternatives: [["Восстановить мост: каждый мастер даёт +2 прочности и +2 вклада.", "Repair: each worker adds 2 hull and 2 contribution."], ["Обход: каждый пьёт 2 воды. В кладовой останется лишь 1 место.", "Bypass: each player drinks 2 water. Only 1 cache slot remains."]], aftermath: ["Открытый мост допускает до 2 мест добычи. Действительный выпуск зависит от оставшихся комплектов и воды.", "An open bridge permits up to 2 slots. Actual production depends on remaining kits and water."] },
    { goal: ["Нужно заработать груз для города. Добыча требует вложений.", "Earn cargo for the city. Production requires inputs."], need: [`Доступно ${g.bridgeOpen ? 2 : 1} места. Один проект стоит 1 воду + 1 инструмент.`, `${g.bridgeOpen ? 2 : 1} slots available. Each project costs 1 water + 1 tool.`], alternatives: [[`Осторожно: 6 груза на проект, угроза ${n - 2}.`, `Safe: 6 cargo per project; threat ${n - 2}.`], [`Риск: 8 груза на проект, угроза ${n}.`, `Risk: 8 cargo per project; threat ${n}.`]], aftermath: ["Принятые проекты занимают место раньше одиночных планов.", "Accepted projects reserve their slots before solo plans."] },
    { goal: ["Нападающие хотят ваш груз. Защита конкурирует с подготовкой к буре.", "Raiders want your cargo. Defense competes with storm preparation."], need: [`Охрана даёт 2 защиты. Безопасная угроза ${n + 2}; рискованная ${n + 4}.`, `Guard adds 2 defense. Safe threat ${n + 2}; risky threat ${n + 4}.`], alternatives: [["Защитить груз: прикрыть караван или нанять охрану.", "Protect cargo: guard the caravan or hire protection."], ["Добыть инструменты: 1 вода → 2 инструмента, максимум 2 места.", "Recover tools: 1 water → 2 tools, at most 2 slots."]], aftermath: ["Неприкрытый урон забирает груз у самых богатых участников.", "Uncovered damage takes cargo from the largest holdings."] },
    { goal: ["Охрана не остановит бурю. Каравану нужно укрытие.", "Guard cannot stop a storm. The caravan needs shelter."], need: [`Нужно ${Math.ceil(n / 3)} ремонтных действий и 2 воды на каждого.`, `Need ${Math.ceil(n / 3)} repairs and 2 water per player.`], alternatives: [["Построить укрытие: 1 инструмент на каждое ремонтное действие.", "Build shelter: each repair costs 1 tool."], ["Пополнить воду: +3 воды, но нехватка укрытий повредит караван.", "Gather water: +3 water, but missing shelter damages the caravan."]], aftermath: ["Инструменты из засады могут решить исход этой встречи.", "Tools recovered from the ambush can decide this encounter."] },
    { goal: ["Город требует общей доставки. Часть личного груза нужно отдать.", "The city requires a shared delivery. Give up part of your cargo."], need: [`Безопасная доставка: ${n} груза. Через опасный проход: ${Math.ceil(n / 2)}.`, `Safe delivery: ${n} cargo. Dangerous entry: ${Math.ceil(n / 2)}.`], alternatives: [["Доставка: выбрать 0–5 груза. Прочность должна остаться выше нуля.", "Deliver 0–5 cargo. Hull must remain above zero."], [`Опасный проход: меньше грузовой платы, но угроза ${n + 4}.`, `Dangerous entry: lower cargo requirement, but threat ${n + 4}.`]], aftermath: ["Личный счёт: 3 × оставшийся груз + доставка + вклад. При провале — 0.", "Score: 3 × remaining cargo + delivery + contribution. Failure scores 0."] },
  ][Math.max(0, Math.min(5, g.stage))];
  if(g.count<4)return {...content,need:["Пригласите участников: для экспедиции нужны 4–6 мест.","Invite participants: an expedition needs 4–6 seats."],routeRelevant:g.stage!==4} as ReturnType<typeof stageContent>;
  if(observer)return {...content,routeRelevant:g.stage!==4} as ReturnType<typeof stageContent>;
  const board=advisoryWorkboard({count:g.count,stage:g.stage,hull:g.hull,flags:g.bridgeOpen?2:0,players:g.seats,deals:g.offers.filter(p=>p.status==="accepted").map(p=>({...p,active:true,job:p.job??255}))},g.seat);
  content.need=[...board.need] as Text;
  const partner=g.seats[g.seat].seal?board.partners.find(p=>p.available&&p.suggestions.length>0):undefined;
  if(partner){const suggestion=partner.suggestions[0],name=g.seats[partner.seat].name;content.aftermath=[`${content.aftermath[0]} ${name}: ${suggestion.reason[0]} ${suggestion.opportunityCost[0]}`,`${content.aftermath[1]} ${name}: ${suggestion.reason[1]} ${suggestion.opportunityCost[1]}`];}
  else if(g.offers.some(p=>p.status==="accepted"&&(p.maker===g.seat||p.taker===g.seat))){
    const guarantee=g.network==="practice"?["Практика моделирует резерв и работу локально; это не подпись Solana.","Practice models reservations and work locally; this is not a Solana signature."]:board.solana;
    content.aftermath=[`${content.aftermath[0]} ${guarantee[0]} Общая победа всё ещё зависит от остальных решений.`,`${content.aftermath[1]} ${guarantee[1]} Shared victory still depends on the remaining decisions.`];
  }
  if(g.stage===0)content.alternatives=[["Колодец: нужна хотя бы одна работа с точными входами. Без неё караван теряет 2 прочности; договор выбирается отдельно.","Well route: execute at least one funded well job. Otherwise lose 2 hull; arrange the pact separately."],["Сухой обход: каждый пьёт 2 воды, ремонт колодца не обязателен.","Dry detour: each player drinks 2 water; well repair is optional."]];
  if(g.stage===3)content.alternatives=[[`Безопасный путь: угроза ${n+2}. Охрана или добыча инструментов выбираются отдельным действием.`,`Safe route: threat ${n+2}. Guarding or recovering tools is a separate action.`],[`Рискованный гребень: угроза ${n+4}, дополнительной награды за маршрут нет.`,`Risky ridge: threat ${n+4}; this route provides no additional reward.`]];
  return {...content,routeRelevant:g.stage!==4} as ReturnType<typeof stageContent>;
}
export function actionContent(stage: number, action: number, route: number, protocol=2): { title: Text; effect: Text; cost: Bundle; available: boolean } {
  if(protocol===3&&stage===5){
    if(action===5)return {title:['Доставить груз','Deliver cargo'],effect:['Груз уходит городу; +1 вклад за действие. Одновременно охранять или работать нельзя.','Cargo goes to the city; +1 contribution per action. Cannot also guard or work.'],cost:[0,0,0],available:true};
    if(action===6)return {title:['Работа у ворот','Work at the gates'],effect:['+1 личного груза. Его нельзя доставить в этой же встрече.','+1 personal cargo. It cannot be delivered in this encounter.'],cost:[0,0,0],available:true};
    if(action!==0&&action!==1)return {title:['Недоступно','Unavailable'],effect:['Выбери доставку, охрану или работу.','Choose delivery, guarding or work.'],cost:[0,0,0],available:false};
  }
  if (action === 0) return { title: ["Переждать", "Rest"], effect: ["Сохранить ресурсы. Питьё всё равно требуется.", "Save resources. Drinking still applies."], cost: [0,0,0], available: true };
  if (action === 1) return { title: ["Охранять", "Guard"], effect: [0,1,4].includes(stage)?["Боевой угрозы нет; +1 вклад. Цель требует другого действия.","No combat threat; +1 contribution. The objective requires another action."]:["+2 защиты · +1 вклад", "+2 defense · +1 contribution"], cost: [0,0,0], available: true };
  if (action === 2) return { title: ["Искать воду", "Gather water"], effect: ["+3 воды", "+3 water"], cost: [0,0,0], available: true };
  if (action === 3) return stage === 0
    ? { title: ["Восстановить колодец", "Restore the well"], effect: ["2 воды + 1 инструмент → 8 воды", "2 water + 1 tool → 8 water"], cost: [2,1,0], available: true }
    : { title: [stage === 4 ? "Строить укрытие" : "Ремонтировать", stage === 4 ? "Build shelter" : "Repair"], effect: ["1 инструмент → +2 прочности · +2 вклад", "1 tool → +2 hull · +2 contribution"], cost: [0,1,0], available: true };
  return stage === 3
    ? { title: ["Добыть инструменты", "Recover tools"], effect: ["1 вода → 2 инструмента · 2 места", "1 water → 2 tools · 2 slots"], cost: [1,0,0], available: true }
    : { title: ["Добыть груз", "Produce cargo"], effect: ["1 вода + 1 инструмент → 6 или 8 груза по общему большинству; ваш голос "+(route?"риск":"безопасно"),"1 water + 1 tool → 6 or 8 cargo by majority route; your vote is "+(route?"risky":"safe")], cost: [1,1,0], available: stage === 2 };
}
export function invalidMove(g: GameView, move: Move): Text | null {
  if(!Number.isInteger(move.action)||move.action<0||move.action>(g.version===3&&g.stage===5?6:4)||!Number.isInteger(move.route)||move.route<0||move.route>1||!Number.isInteger(move.delivery)||move.delivery<0||move.delivery>5)return ["Выберите целое допустимое действие, маршрут и доставку от 0 до 5.","Choose a valid action, route and an integer delivery from 0 to 5."];
  const me = g.seats[g.seat];
  const info = actionContent(g.stage, move.action, move.route,g.version);
  if(g.version===3&&g.stage===5){const q=g.offers.find(p=>p.status==='accepted'&&p.kind===3&&p.provider===g.seat)?.delivery??0;
    if(move.action===5?(q+move.delivery<1||q+move.delivery>5):move.delivery!==0)return ['Доставка занимает отдельное действие. Закреплённая часть + добавка: от1до5.','Delivery uses its own action. Pledged quantity + extra must total1to5.'];
  }
  if (!info.available) return ["Это действие недоступно в этой встрече.", "That action is unavailable at this encounter."];
  if (me.bound !== null && move.action !== me.bound) return ["Действие уже закреплено принятым договором.", "An accepted pact already binds your action."];
  if (me.bound === null && info.cost.some((cost, i) => cost > me.resources[i] - me.reserved[i])) return ["Свободных ресурсов не хватает. Найдите партнёра или выберите другой план.", "Not enough free resources. Find a partner or choose another plan."];
  if (move.delivery && (g.stage !== 5 || move.delivery > me.resources[2] - me.reserved[2])&&!(g.version===3&&(g.revealed&(1<<g.seat)))) return ["Для доставки не хватает свободного груза.", "Not enough free cargo for that delivery."];
  return null;
}
