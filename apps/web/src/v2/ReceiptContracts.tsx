import type { Bundle, GameView, Receipt } from './model';
import { BundleDisplay } from './Resources';
import { actionContent, words } from './content';
import { expeditionDebrief } from '../../../../packages/engine/src/v2-debrief';
import { expeditionDebrief as debriefV3 } from '../../../../packages/engine/src/v3-debrief';

/** Exact retained terms and execution; production totals are not individual pact allocations. */
export default function ReceiptContracts({ receipt: r, game: g, language }: { receipt: Receipt; game: GameView; language: string }) {
  const say = (ru: string, en: string) => language === 'en' ? en : ru;
  const row = (g.version===3?debriefV3:expeditionDebrief)({ ...g, history: [r] }).encounters[0];
  if (!row?.pacts.length) return null;
  return <details><summary>{say('Кто вложил → кто выполнил → что получил', 'Who funded → who worked → who received')}</summary>
    {row.pacts.map((p, index) => <article key={`${p.maker}:${p.nonce ?? index}`} className="v2-pact-preview">
      <strong>{g.seats[p.maker].name} ↔ {g.seats[p.taker].name}</strong>
      {p.kind===3&&<p>{say(`Пакт доставки: закреплено ${r.pledged?.[p.provider]??p.delivery}, свободная добавка ${r.voluntary?.[p.provider]??0}, всего исполнено ${r.deliveries?.[p.provider]??0}. Цена показана отдельно ниже.`,`Delivery pledge: bound ${r.pledged?.[p.provider]??p.delivery}, voluntary extra ${r.voluntary?.[p.provider]??0}, total delivered ${r.deliveries?.[p.provider]??0}. Price is shown separately below.`)}</p>}
      <p>{p.kind === 0 ? say('Обмен исполнен при принятии. Действие не закреплялось.', 'The swap executed on acceptance. No action was bound.') :
        p.kind === 2 ? say('Совместный проект с заранее заданным разделом.', 'A joint project with an agreed output split.') :
          say('Заказ конкретной работы.', 'An order for specific work.')}</p>
      {[p.maker, p.taker].map((seat, side) => <p key={seat}>{g.seats[seat].name} {say('даёт', 'gives')}: <BundleDisplay value={p.gives[side] as Bundle} language={language}/></p>)}
      {p.kind !== 0 && <><p>{say('Закреплённый исполнитель', 'Bound provider')}: {g.seats[p.provider].name}. {words(language, actionContent(r.stage, p.action, r.route,g.version).title)}.</p>
        <p>{p.execution === 'performed' ? say('Квитанция подтверждает: работа выполнена.', 'The receipt confirms: work performed.') :
          p.execution === 'unperformed' ? say('Квитанция показывает: работа не выполнена.', 'The receipt shows: work not performed.') :
            say('Подтверждение выполнения в доступных данных отсутствует.', 'Execution evidence is unavailable in these data.')}</p></>}
      {p.allocation && <p>{say('Доля именно этого проекта', 'This project’s own share')}: {p.allocation.each} {p.allocation.resource === 0 ? say('воды', 'water') : say('груза', 'cargo')} {say('каждому партнёру. Личная добыча показана отдельно в общем выпуске.', 'per partner. Personal gathering is included separately in total output.')}</p>}
      {p.waterDelivery && <p>{say('Поставка новой воды заказчику', 'New water delivery to the buyer')} {g.seats[p.waterDelivery.recipient].name}: {say(`согласовано ${p.waterDelivery.agreed};`, `agreed ${p.waterDelivery.agreed};`)} {p.waterDelivery.actual === null ?
        say('фактическая передача по доступным данным не подтверждена.', 'actual transfer is not confirmed by the available data.') :
        say(`исполнено ${p.waterDelivery.actual}. Это передача из поиска партнёра, отдельно от твоего действия.`, `performed ${p.waterDelivery.actual}. This comes from the provider’s gathering, separately from your action.`)}</p>}
      {p.kind !== 0 && r.stage === 1 && r.route === 1 && p.execution === 'performed' && <p>{say('Работа исполнена, но большинство выбрало обход. Договор не обещал открытие моста.', 'Work performed, but the majority chose the detour. The pact did not promise an open bridge.')}</p>}
      {p.job !== null && <p>{say('TEST-задание', 'TEST job')} #{p.job + 1}: {p.execution === 'performed' ? say('исполнение сохраняет право выплаты; получение токенов проверяется в кошельке.', 'execution retains payout entitlement; token receipt is checked in the wallet.') :
        say('статус работы и средств проверяется отдельно в кошельке.', 'work and funds are checked separately in the wallet.')}</p>}
    </article>)}
    {r.inputs && r.outputs && <details><summary>{say('Общий выпуск участников, включая личные действия', 'Participant totals, including personal actions')}</summary>
      {g.seats.map((s, i) => <div key={s.owner} className="v2-pact-preview"><strong>{s.name}</strong>
        <p>{say('Входы работы и доставки', 'Work and delivery inputs')}: <BundleDisplay value={r.inputs![i]} language={language}/></p>
        <p>{say('Выпуск / выделено', 'Produced / allocated')}: <BundleDisplay value={r.outputs![i]} language={language}/></p>
      </div>)}
    </details>}
  </details>;
}
