import type { GameView, Receipt } from './model';
import { encounterNames, words } from './content';
import { receiptDelta } from './gameplay';
import { BundleDisplay, resourceNames } from './Resources';
import { expeditionDebrief } from '../../../../packages/engine/src/v2-debrief';
import { expeditionDebrief as debriefV3 } from '../../../../packages/engine/src/v3-debrief';
export default function OutcomeCard({game:g,receipt:r,language,open=false}:{game:GameView;receipt:Receipt;language:string;open?:boolean}){
 const say=(ru:string,en:string)=>language==='en'?en:ru,delta=receiptDelta(g,r);
 const before=r.stage===0?0:g.history.find(h=>h.stage===r.stage-1)?.support[g.seat];
 const contribution=before===undefined?null:r.support[g.seat]-before;
 const explanation=(g.version===3?debriefV3:expeditionDebrief)(g).encounters.find(e=>e.stage===r.stage);
 return <details className="v2-outcome-card" data-guide="receipt" open={open||undefined}>
  <summary>{words(language,encounterNames[r.stage])}: {explanation?words(language,[...explanation.headline]):r.objective?say('цель выполнена','objective fulfilled'):say('цель не выполнена','objective missed')} · {say('что изменилось','what changed')}</summary>
  <div><span className="v2-test-label">{r.proof==='practice'?'Rust/Wasm · OFFCHAIN':`Solana · ${r.proof.toUpperCase()}`}</span>
   <p>{say('Прочность','Hull')}: {r.hullBefore} → {r.hullAfter} · {say('мой запас','my inventory')}: <BundleDisplay value={r.resources[g.seat]} language={language}/></p>
   {explanation?.facts.slice(0,2).map((fact,i)=><p key={i}>{words(language,[...fact])}</p>)}
   {delta&&<p>{say('Изменение с прошлого этапа','Change since the previous stage')}: {delta.map((n,i)=>`${n>=0?'+':''}${n} ${resourceNames[i][language==='en'?1:0]}`).join(' · ')}</p>}
   {contribution!==null&&<p>{say('Мой вклад за встречу','My contribution this encounter')}: {contribution>=0?'+':''}{contribution}. {say('Личный счёт сохраняется при прибытии и без потери зачёта.','Personal score counts on arrival without forfeiture.')}</p>}
   {r.inputs&&r.outputs&&<p>{say('Мои входы работы','My work inputs')}: <BundleDisplay value={r.inputs[g.seat]} language={language} compact/> · {say('выпуск / выделено','produced / allocated')}: <BundleDisplay value={r.outputs[g.seat]} language={language} compact/></p>}
   <small>{say('Итог учитывает обмены, договоры, работу, питьё и потери. Показан сохранённый результат, а не прогноз.','Holdings include swaps, pacts, work, drinking and losses. This is a retained result, not a forecast.')}</small>
   {r.stage===1&&<p>{(r.flags??0)&2?say(`Мост открыт: до 2 мест добычи. Комплектов после этой встречи: ${r.resources.reduce((n,p)=>n+p[1],0)}. На каждое производство нужен комплект.`,`Bridge opened: up to 2 extraction slots. Kits after this encounter: ${r.resources.reduce((n,p)=>n+p[1],0)}. Each project still needs a kit.`):say('Мост не открыт: дальше только 1 место добычи.','Bridge stayed closed: only 1 extraction slot next.')}</p>}
   {r.reasons.length>0&&<p className="v2-warning">{r.reasons.join(' ')}</p>}
  </div>
 </details>;
}
