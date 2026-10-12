import { expeditionDebrief } from '../../../../packages/engine/src/v2-debrief';
import { expeditionDebrief as debriefV3 } from '../../../../packages/engine/src/v3-debrief';
import { v2Rejection } from '../../../../packages/engine/src/v2-design';
import type { GameView } from './model';
import { words } from './content';
import { BundleDisplay } from './Resources';
import ReceiptContracts from './ReceiptContracts';

export default function ExpeditionDebrief({ game: g, language }: { game: GameView; language: string }) {
  const d = (g.version===3?debriefV3:expeditionDebrief)(g), say = (ru: string, en: string) => language === 'en' ? en : ru;
  const name = (seat: number) => g.seats[seat].name;
  const list = (seats: number[]) => seats.map(name).join(', ');
  return <section className="v2-debrief" aria-label={say('Разбор решений экспедиции', 'Expedition decision review')}>
    {Boolean('escortFailure' in d&&d.escortFailure)&&<p className="v2-warning">{say('Обход не состоялся: для эскорта нужны отдельные охранники. Наличие груза и прочности не заменяет это условие.','The detour failed: escort needs distinct guards. Cargo and hull cannot replace that condition.')}</p>}
    {d.gate && <p className="v2-rule">{say(`Доставлено ${d.gate.delivered} из ${d.gate.required} груза. Прочность: ${d.hull}/12.`,
      `Delivered ${d.gate.delivered} of ${d.gate.required} cargo. Hull: ${d.hull}/12.`)}</p>}
    {d.failureCauses.includes('hull') && <p className="v2-warning">{say('Караван потерял всю прочность.', 'The caravan lost all its hull.')}</p>}
    {d.failureCauses.includes('delivery') && <p className="v2-warning">{say(`Для выбранного входа не хватило ${d.gate!.required - d.gate!.delivered} груза.`,
      `The chosen entry was short of ${d.gate!.required - d.gate!.delivered} cargo.`)}</p>}
    {d.failureCauses.includes('missing-result') && <p>{say('По доступным квитанциям причина завершения не установлена. Обновите состояние.',
      'Available receipts do not establish the reason for termination. Refresh the state.')}</p>}
    {d.scores && <><h3>{say('Как получился личный счёт', 'How your personal score was calculated')}</h3><ul className="v2-scores">{d.scores.map(s => {
      const lost = d.encounters.find(r => r.forfeitedSeats.includes(s.seat));
      return <li key={s.seat}><b>{name(s.seat)}</b><span>{say(`3 × ${s.cargo} груза + ${s.delivered} доставки + ${s.contribution} вклада = ${s.cargoPoints + s.delivered + s.contribution}`,
        `3 × ${s.cargo} cargo + ${s.delivered} delivered + ${s.contribution} contribution = ${s.cargoPoints + s.delivered + s.contribution}`)}
        {s.reason === 'no-arrival' && <small>{say('Общего прибытия нет → итог 0.', 'No shared arrival → final score 0.')}</small>}
        {s.reason === 'forfeited' && <small>{say('Личный зачёт утрачен → итог 0.', 'Personal score forfeited → final score 0.')}</small>}
        {g.seats[s.seat].forfeited && lost && <small>{say(`Потеря зачёта уже зафиксирована во встрече ${lost.stage + 1}.`,
          `Forfeiture is already recorded in encounter ${lost.stage + 1}.`)}</small>}
      </span><strong>{s.total}</strong></li>;
    })}</ul></>}
    <h3>{say('Что изменили решения по дороге', 'What the journey decisions changed')}</h3>
    {d.encounters.length === 0 && <p>{say('Завершённых встреч ещё нет.', 'No encounters have resolved yet.')}</p>}
    {d.encounters.map(e => {
      const receipt = g.history.find(r => r.stage === e.stage)!;
      return <details className="v2-debrief-encounter" key={e.stage}><summary><b>{e.stage + 1}. {words(language, [...e.name])}</b><span>{words(language, [...e.headline])}</span></summary>
        <div><p>{say('Прочность', 'Hull')}: {e.hullBefore} → {e.hullAfter}</p>
          {e.facts.map((t, i) => <p key={i}>{words(language, [...t])}</p>)}
          {e.workers.length > 0 && <p>{say('Работу выполнили', 'Work performed by')}: {list(e.workers)}.</p>}
          {e.producers.length > 0 && <p>{say('Добычу выполнили', 'Extraction performed by')}: {list(e.producers)}.</p>}
          {e.pacts.length === 0 ? <p>{say('В этой встрече принятых договоров не было. Ниже сохранён результат свободных действий; пропущенные или отклонённые планы могли стать ожиданием по правилам.',
            'This encounter had no accepted pacts. The result retains unbound actions; missing or rejected plans may have defaulted to rest under the rules.')}</p> : <ReceiptContracts receipt={receipt} game={g} language={language}/>}
          <p>{say('Мой фактический вклад за встречу', 'My actual contribution this encounter')}: {e.personalChanges[g.seat]?.support ?? say('нет предыдущей квитанции', 'previous receipt unavailable')}.</p>
          {e.hullTrace && <details><summary>{say('Почему изменилась прочность', 'Why hull changed')}</summary><p>{e.hullTrace.before} + {e.hullTrace.repairGain} {say('ремонта после ограничения 12', 'repair after the cap of 12')} − {e.hullTrace.combat} {say('нападения', 'combat')} − {e.hullTrace.objectiveDamage} {say('нехватки работ', 'missing work')} − {e.hullTrace.waterShortage} {say('недостающей воды', 'missing water')} → {e.hullTrace.after}.</p></details>}
          {e.resources && <details><summary>{say('Путь моих ресурсов', 'My resource trail')}</summary>{e.resources.filter(t => t.seat === g.seat).map(t => <div key={t.seat}>
            <p>{say('До встречи', 'Before')}: <BundleDisplay value={t.before as [number, number, number]} language={language}/></p>
            <p>{say('Обмен и цена заказа: изменение вода / комплект / груз', 'Swap and job price: water / kit / cargo change')}: {t.transfer.join(' / ')}.</p>
            <p>{say('Потреблено на работу и доставку', 'Work and delivery inputs')}: <BundleDisplay value={t.input as [number, number, number]} language={language}/></p>
            <p>{say('Выпуск и выделенная доля', 'Produced and allocated')}: <BundleDisplay value={t.output as [number, number, number]} language={language}/></p>
            <p>{say(`Выпито ${t.drinking}; недостало ${t.waterShortage} воды. Потеря груза при нападении: ${t.cargoLost}.`, `Drank ${t.drinking}; short of ${t.waterShortage} water. Cargo lost to attack: ${t.cargoLost}.`)}</p>
            <p>{say('После встречи', 'After')}: <BundleDisplay value={t.after as [number, number, number]} language={language}/></p>
          </div>)}</details>}
          {e.missingSeats.length > 0 && <p className="v2-warning">{say('Раскрытие плана не поступило', 'A plan reveal was missing')}: {list(e.missingSeats)}. {say('Принятые обязательства проверяются отдельно.', 'Accepted obligations are checked separately.')}</p>}
          {e.rejected.map(x => <p key={x.seat} className="v2-warning">{name(x.seat)}: {words(language, [...v2Rejection(x.code)])}</p>)}
          <small>{e.proof === 'practice' ? 'Rust/Wasm · OFFCHAIN' : `Solana · ${e.proof.toUpperCase()}`} {e.settlementKey && <code>{e.settlementKey}</code>}</small>
        </div>
      </details>;
    })}
    <p className="v2-fine">{g.network === 'practice' ? say('Практика рассчитана локально. В Solana точное согласие резервирует вклад и закрепляет действие; сохранённый результат можно проверить другим клиентом.',
      'Practice resolves locally. On Solana, exact consent reserves inputs and binds an action; another client can verify the retained outcome.') :
      say('Solana сохраняет принятые условия и результат исполнения. Договор гарантирует конкретный вклад; общий путь и прибытие зависят от остальных решений.',
        'Solana retains accepted terms and execution results. A pact guarantees a specific contribution; the route and arrival depend on the other decisions.')}</p>
  </section>;
}
