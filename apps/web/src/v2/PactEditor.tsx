import { useEffect, useMemo, useState } from "react";
import { Handshake, LockKeyhole, ArrowRight, Check } from "lucide-react";
import { useI18n } from "../../../../packages/ui/src/i18n";
import type { Bundle, GameView, Pact, PactTerms } from "./model";
import { actionContent, words } from "./content";
import { defaultTerms, reviewTerms } from "./terms";
import { BundleDisplay, resourceNames } from "./Resources";
import { pactHeadline, workboardFor } from './gameplay';
import {v2BridgePreference} from '../../../../packages/engine/src/v2-npc';
import {pactCityPreview} from './city-preview';
export function PactPreview({ pact, game }: {pact: PactTerms; game: GameView}) {
  const {language}=useI18n(); const say=(ru:string,en:string)=>words(language,[ru,en]);
  const maker=game.seats[pact.maker], taker=game.seats[pact.taker], provider=game.seats[pact.provider];
  const city=pactCityPreview(game,pact);
  return <div className="v2-pact-preview">
    <strong><LockKeyhole size={20}/>{pact.kind===0?say("Обмен при принятии","Exchange on acceptance"):pact.kind===3?say('Пакт доставки','Delivery pledge'):pact.kind===1?say("Обязательство с резервом","Reserved work order"):say("Совместное производство","Joint production")}</strong>
    {pact.gives.map((bundle,i)=>bundle.some(Boolean)&&<div key={i}><span>{i===0?maker.name:taker.name}</span><BundleDisplay value={bundle} language={language} compact/><ArrowRight size={18}/><span>{pact.kind===2?say('в общий проект','into the project'):i===0?taker.name:maker.name}</span></div>)}
    {pact.kind!==0&&<p><b>{provider.name}</b>: {words(language,actionContent(game.stage,pact.action,0,game.version).title)}. {pact.kind===3?say(`Резерв: ${pact.delivery} собственного груза. Доставит его городу даже при пропуске раскрытия.`,`Reserves ${pact.delivery} owned cargo and delivers it to the city even after a missed reveal.`):pact.kind===2 ? game.stage===0?say("Результат: по 4 воды каждому.","Output: 4 water for each partner."):say("Результат делится пополам по выбранному общему маршруту.","Output is split equally according to the agreed route."):pact.delivery?say(`Передаст заказчику ${pact.delivery} новой воды.`,`Will deliver ${pact.delivery} new water to the payer.`):say("Цена переводится при исполнении.","Payment transfers when work executes.")}</p>}
    {pact.kind===3&&<p>{say('Занимает действие доставки: этот исполнитель не охраняет и не работает на рынке. Цена исполняется отдельно; свободная добавка не гарантирована.','Uses the delivery action: this provider cannot guard or work at the market. Price settles separately; voluntary extra is not guaranteed.')}</p>}
    {city&&city.normal.cargoShortfall>0&&<p className="v2-warning">{say(`После этой цены обычному входу не хватает ${city.normal.cargoShortfall} доступной доставки. Для обхода нужны ${city.emergency.goal} груза и ${city.emergency.escortGoal} отдельных охранника.`,`After this price, regular entry lacks ${city.normal.cargoShortfall} available delivery. The detour needs ${city.emergency.goal} cargo and ${city.emergency.escortGoal} distinct guards.`)}</p>}
    {pact.kind===1&&actionContent(game.stage,pact.action,0).cost.some(Boolean)&&<p>{say('Работа расходует','Work consumes')}: <BundleDisplay value={actionContent(game.stage,pact.action,0).cost} language={language} compact/>. {say('Входы резервируются вместе с действием; оплата может покрывать их часть.','Inputs are reserved with the action; payment may cover part of them.')}</p>}
    {'job' in pact&&(pact.job===0||pact.job===1)&&<p><b>{say('Оплаченное задание','Funded job')} #{Number(pact.job)+1}: 10 TEST USDC</b> → <code>{provider.owner}</code>. {say('За подтверждённый ремонт. Даже при пропущенном раскрытии или общем провале; комиссия оплачивается отдельно. Только тестовые средства без денежной стоимости.','For recorded repair, even after a missed reveal or shared failure. Network fees are separate. Test assets have no monetary value.')}</p>}
    <small>{pact.kind===0?say("Сразу меняет запасы. Дальнейших обещаний не гарантирует.","Changes inventories immediately. Does not guarantee later promises."):say("Резервирует ресурсы и действие. Отключение исполнителя не снимает обязательство. Общая победа не гарантирована.","Reserves inputs and the action. Disconnection does not cancel the obligation. Does not guarantee a shared victory.")}</small>
    <small>{say('У каждой стороны одна печать на встречу. Этот договор занимает обе.','Each partner has one seal per encounter. This pact uses both.')}</small>
  </div>;
}
function BundleInput({ value,onChange,label,language,disabled=false }: {value:Bundle;onChange(value:Bundle):void;label:string;language:string;disabled?:boolean}) {
  return <fieldset className="v2-bundle-input"><legend>{label}</legend><div>{value.map((n,i)=><label key={i}>{resourceNames[i][language==="en"?1:0]}<input type="number" min={0} max={5} step={1} value={Number.isFinite(n)?n:""} disabled={disabled} onChange={e=>{const next=[...value] as Bundle;next[i]=e.currentTarget.value===""?NaN:Number(e.currentTarget.value);onChange(next);}}/></label>)}</div></fieldset>;
}
export default function PactEditor({ game,partner,busy,onOffer,onAccept,onCancel,onTalk }: {game:GameView;partner:number;busy:boolean;onOffer(terms:PactTerms,bountySlot?:number):void;onAccept(pact:Pact):void;onCancel():void;onTalk?:()=>void}) {
  const {language}=useI18n(); const say=(ru:string,en:string)=>words(language,[ru,en]);
  const initialKind=[0,2].includes(game.stage)?2:game.stage===5?(game.version===3?3:0):1;
  const [draft,setDraft]=useState(()=>defaultTerms(game,partner,initialKind));
  const [bounty,setBounty]=useState<number|undefined>();
  const terms=useMemo(()=>({...draft,stage:game.stage,nonce:game.seats[game.seat].offerNonce??draft.nonce}),[draft,game.stage,game.seats[game.seat].offerNonce]);
  const paidChoiceValid=game.stage===1&&terms.kind===1&&terms.action===3&&game.vault?.active&&!game.seats[terms.provider].npc&&game.vault.slots.some(s=>s.id===bounty&&s.status==='open');
  useEffect(()=>{if(bounty!==undefined&&!paidChoiceValid)setBounty(undefined);},[bounty,paidChoiceValid]);
  const error=reviewTerms(game,terms), incoming=game.offers.filter(p=>p.status==="open"&&p.maker===partner&&p.taker===game.seat);
  const own=game.offers.find(p=>p.status==="open"&&p.maker===game.seat), accepted=game.offers.find(p=>p.status==="accepted"&&[p.maker,p.taker].includes(game.seat));
  const partnerSeat=game.seats[partner];
  const advice=workboardFor(game).partners.find(p=>p.seat===partner);
  return <div className="v2-pact-editor">
    {onTalk&&<button onClick={onTalk}>{say('Обсудить план без печати','Discuss an unsealed plan')}</button>}
    <p><b>{partnerSeat.name}</b> · {partnerSeat.npc?say("Контрактный агент · собственные запасы и политика","Contract agent · own inventory and policy"):say("Другой игрок","Another player")}</p>
    {game.stage===1&&partnerSeat.npc&&<p className="v2-rule">{words(language,[...v2BridgePreference(partner)])}</p>}
    <div className="v2-pact-peer"><span>{say("Всего у партнёра","Partner's total")}</span><BundleDisplay value={partnerSeat.resources} language={language}/><span>{say("В резерве","Reserved")}</span><BundleDisplay value={partnerSeat.reserved} language={language}/></div>
    {accepted&&<section data-guide="deal"><p className="v2-positive"><Check size={20}/>{say("Ваша печать уже закрепляет этот договор.","Your seal already binds this pact.")}</p><PactPreview pact={accepted} game={game}/></section>}
    {incoming.map(p=><section data-guide="deal" className="v2-incoming" key={`${p.maker}:${p.nonce}`}><h3>{partnerSeat.name}: {words(language,pactHeadline(p,game))}</h3><PactPreview pact={p} game={game}/><button className="v2-primary" disabled={busy||game.phase!==1||!game.seats[game.seat].seal} onClick={()=>onAccept(structuredClone(p))}><Handshake size={21}/>{say("Принять эти условия","Accept these terms")}</button></section>)}
    {!accepted&&<>
      {!incoming.length&&!own&&<section className="v2-pact-options"><h3>{say('Как вы можете помочь друг другу','How you can help each other')}</h3>{advice?.available&&advice.suggestions.length?advice.suggestions.map((suggestion,i)=>{
        const p:PactTerms={...suggestion,maker:game.seat,taker:partner,nonce:game.seats[game.seat].offerNonce??0,stage:game.stage,gives:structuredClone(suggestion.gives)},invalid=reviewTerms(game,p);
        return <article key={i}><h4>{words(language,pactHeadline(p,game))}</h4><p>{words(language,[...suggestion.reason])}</p><PactPreview pact={p} game={game}/>{invalid&&<p className="v2-warning">{words(language,invalid)}</p>}<button className="v2-primary" disabled={busy||!!invalid} onClick={()=>onOffer(structuredClone(p))}>{say('Предложить этот договор','Propose this pact')}</button></article>;
      }):<p>{advice?.unavailableReason?words(language,[...advice.unavailableReason]):say('Общего проекта сейчас нет. Выберите другого спутника или обсудите свои условия ниже.','No shared project is available now. Choose another companion or discuss custom terms below.')}</p>}<p className="v2-fine">{say('Это возможные условия, не согласие партнёра. Агент может отказать; игрок решает сам.','These are possible terms, not a partner’s agreement. Agents may decline; players choose for themselves.')}</p></section>}
      {own&&<section><h3>{say('Ваше предложение ждёт ответа','Your offer is awaiting a response')}</h3><PactPreview pact={own} game={game}/><button disabled={busy} onClick={onCancel}>{say('Отменить открытое предложение','Cancel open offer')}</button></section>}
      <details className="v2-custom-terms"><summary>{say('Другие условия · конструктор договора','Other terms · pact builder')}</summary>
      <div className="v2-tabs" role="group" aria-label={say("Вид договора","Pact type")}>{[[0,say("Обмен","Barter")],[1,say("Заказать работу","Work order")],[2,say("Совместный проект","Joint project")],[3,say("Пакт доставки","Delivery pledge")]].filter(([kind])=>(kind!==2||[0,2].includes(game.stage))&&(kind!==3||game.version===3&&game.stage===5)).map(([kind,title])=><button key={kind} aria-pressed={terms.kind===kind} onClick={()=>{setDraft(defaultTerms(game,partner,Number(kind)));setBounty(undefined);}}>{title}</button>)}</div>
      {terms.kind!==0&&<label className="v2-field">{say("Кто выполняет работу","Who performs the work")}<select value={terms.provider} onChange={e=>{const provider=Number(e.target.value);setDraft(p=>({...p,provider,gives:(p.kind===1||p.kind===3)?provider===p.maker?[[0,0,0],[1,0,0]]:[[1,0,0],[0,0,0]]:p.gives}));setBounty(undefined);}}><option value={game.seat}>{game.seats[game.seat].name}</option><option value={partner}>{partnerSeat.name}</option></select></label>}
      {terms.kind===1&&<><label className="v2-field">{say("Работа","Work")}<select value={terms.action} onChange={e=>setDraft(p=>({...p,action:Number(e.target.value),delivery:0}))}>{(game.version===3&&game.stage===5?[1]:[1,2,3]).map(id=><option key={id} value={id}>{words(language,actionContent(game.stage,id,0,game.version).title)}</option>)}</select></label>{terms.action===2&&<label className="v2-field">{say("Новая вода заказчику (0–3)","New water to payer (0–3)")}<input type="number" min={0} max={3} value={terms.delivery} onChange={e=>setDraft(p=>({...p,delivery:Number(e.target.value)}))}/></label>}</>}
      {terms.kind===3&&<label className="v2-field">{say('Закрепить собственного груза исполнителя (1–5)','Pledge provider-owned cargo (1–5)')}<input type="number" min={1} max={5} step={1} value={terms.delivery} onChange={e=>setDraft(p=>({...p,delivery:Number(e.target.value)}))}/></label>}
      {terms.kind===2&&<p className="v2-rule">{game.stage===0?say("Вместе: 2 воды + 1 инструмент → 8 воды. Каждый получит 4.","Together: 2 water + 1 tool → 8 water. Each receives 4."):say("Вместе: 1 вода + 1 инструмент → 6 или 8 груза. Каждый получит половину.","Together: 1 water + 1 tool → 6 or 8 cargo. Each receives half.")}</p>}
      <BundleInput value={terms.gives[0]} language={language} label={say("Ваш вклад / платёж","Your contribution / payment")} disabled={(terms.kind===1||terms.kind===3)&&terms.provider===terms.maker} onChange={value=>setDraft(p=>({...p,gives:[value,p.gives[1]]}))}/>
      <BundleInput value={terms.gives[1]} language={language} label={say("Вклад / платёж партнёра","Partner contribution / payment")} disabled={(terms.kind===1||terms.kind===3)&&terms.provider===terms.taker} onChange={value=>setDraft(p=>({...p,gives:[p.gives[0],value]}))}/>
      {game.stage===1&&terms.kind===1&&terms.action===3&&game.vault?.funded&&game.vault.active&&!game.seats[terms.provider].npc&&<label className="v2-field">{say("Оплачиваемое задание (необязательно)","Paid job (optional)")}<select value={bounty??""} onChange={e=>setBounty(e.target.value===""?undefined:Number(e.target.value))}><option value="">{say("Без USDC · обычный игровой договор","No USDC · game pact only")}</option>{game.vault.slots.filter(s=>s.status==="open").map(s=><option value={s.id} key={s.id}>{say(`Задание ${s.id+1} · 10 тестовых USDC`,`Job ${s.id+1} · 10 test USDC`)}</option>)}</select></label>}
      <PactPreview pact={terms} game={game}/>
      {error&&<p className="v2-warning" role="status">{words(language,error)}</p>}
      <button className="v2-primary" disabled={busy||!!error||!!own} onClick={()=>onOffer(structuredClone(terms),bounty)}>{say("Предложить эти условия","Offer these terms")}</button>
      {own&&<><p>{say("У вас уже есть открытое предложение. Сначала отмените его.","You already have an open offer. Cancel it before making another.")}</p><button disabled={busy} onClick={onCancel}>{say("Отменить открытое предложение","Cancel open offer")}</button></>}
      <p className="v2-fine">{say("Свободное обещание можно обсудить без печати. Печать закрепляет точные условия; у каждой стороны одна печать на встречу.","You may discuss a promise without a seal. A seal binds exact terms; each partner has one per encounter.")}</p>
      </details>
    </>}
  </div>;
}
