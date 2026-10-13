import {
  ArrowRight,
  Check,
  Clock,
  Droplets,
  Flag,
  Handshake,
  LockKeyhole,
  Package,
  Shield,
  Wrench,
} from "lucide-react";
import { useI18n } from "../../../../packages/ui/src/i18n";
import type { Bundle, GameView, PactTerms } from "./model";
import { actionContent, words } from "./content";
import { pactPresentation } from "./pact-presentation";
import { pactCityPreview } from "./city-preview";
const resourceIcons = [Droplets, Wrench, Package];
export function NamedSupplies({
  value,
  language,
  empty = true,
}: {
  value: Bundle;
  language: string;
  empty?: boolean;
}) {
  const names =
    language === "en"
      ? ["Water", "Tools", "Cargo"]
      : ["Вода", "Инструменты", "Груз"];
  return (
    <div className="play-supplies">
      {value.map((n, i) => {
        const Icon = resourceIcons[i];
        return n > 0 ? (
          <span key={i}>
            <Icon size={19} />
            {names[i]}: <b>{n}</b>
          </span>
        ) : null;
      })}
      {empty && !value.some(Boolean) && (
        <span className="play-no-supplies">
          {language === "en" ? "No supplies" : "Без ресурсов"}
        </span>
      )}
    </div>
  );
}
export default function PactTermsCard({
  pact: p,
  game: g,
  compact = false,
}: {
  pact: PactTerms;
  game: GameView;
  compact?: boolean;
}) {
  const { language } = useI18n(),
    say = (ru: string, en: string) => (language === "en" ? en : ru),
    m = pactPresentation(g, p),
    city = pactCityPreview(g, p);
  const provider = g.seats[p.provider],
    peer = g.seats[m.other],
    kind = p.kind;
  const title =
    kind === 2
      ? g.stage === 0
        ? say("Восстановить колодец вместе", "Restore the well together")
        : say("Вместе добыть груз", "Extract cargo together")
      : kind === 3
        ? say("Закрепить доставку в город", "Secure delivery to the city")
        : kind === 0
          ? say("Обменять запасы", "Trade supplies")
          : p.action === 1
            ? say("Договориться об охране", "Arrange a guard")
            : p.action === 2
              ? say("Заказать воду", "Arrange a water supply")
              : say("Договориться о ремонте", "Arrange a repair");
  const action = words(
    language,
    actionContent(g.stage, p.action, 0, g.version).title,
  );
  return (
    <div className={`play-terms-card${compact ? " is-compact" : ""}`}>
      <div className="play-deal-title">
        <span className="play-deal-icon">
          {kind === 3 ? (
            <Flag />
          ) : kind === 0 ? (
            <ArrowRight />
          ) : kind === 2 ? (
            <Droplets />
          ) : p.action === 1 ? (
            <Shield />
          ) : (
            <Wrench />
          )}
        </span>
        <div>
          <span className="dp-kicker">
            {say("Смысл договора", "What this pact does")}
          </span>
          <h3>{title}</h3>
        </div>
        <span className="play-seal-badge">
          {g.network === "practice"
            ? say("Практика · без блокчейна", "Practice · offchain")
            : say(
                `Печать Solana · ${g.network === "devnet" ? "devnet" : "local"}`,
                `Solana seal · ${g.network}`,
              )}
        </span>
      </div>
      <div className="play-deal-sides">
        <section>
          <span className="play-side-label">{say("Ты", "You")}</span>
          <h4>
            {kind === 2
              ? say("Вкладываешь в проект", "Invest in the project")
              : m.mine.some(Boolean)
                ? say("Передаёшь партнёру", "Pay your partner")
                : kind === 0
                  ? say("Получаешь запасы", "Receive supplies")
                  : m.ownActionBound
                    ? kind === 3
                      ? say("Доставляешь свой груз", "Deliver your cargo")
                      : say("Выполняешь работу", "Perform the work")
                    : say("Договариваешься о работе", "Arrange the work")}
          </h4>
          {m.mine.some(Boolean) && (
            <NamedSupplies value={m.mine} language={language} />
          )}
          {m.ownActionBound && kind !== 2 && (
            <div className="play-work-reserve">
              <span>
                {say(
                  "Из твоих запасов в резерв",
                  "Reserved from your supplies",
                )}
              </span>
              <NamedSupplies value={m.mineReserved} language={language} />
            </div>
          )}
          {m.ownActionBound && (
            <p className="play-bound-work">
              <Wrench size={18} />
              <b>{action}</b>
              {kind === 3 ? ` · ${p.delivery} ${say("груза", "cargo")}` : ""}
            </p>
          )}
          {!m.ownActionBound && (
            <p className="play-free-action">
              <Check size={17} />
              {say(
                "Свой ход выбираешь отдельно",
                "Choose your own action separately",
              )}
            </p>
          )}
        </section>
        <Handshake className="play-exchange-mark" size={25} />
        <section>
          <span className="play-side-label">{peer.name}</span>
          <h4>
            {kind === 2
              ? say("Вкладывает в проект", "Invests in the project")
              : m.theirs.some(Boolean)
                ? say("Передаёт тебе", "Pays you")
                : kind === 0
                  ? say("Без встречного ресурса", "No supplies in return")
                  : p.provider === m.other
                    ? say("Выполняет работу", "Performs the work")
                    : say("Заказывает работу", "Orders work")}
          </h4>
          {m.theirs.some(Boolean) && (
            <NamedSupplies value={m.theirs} language={language} />
          )}
          {p.provider === m.other && kind !== 0 && kind !== 2 && (
            <div className="play-work-reserve">
              <span>
                {say("Из его запасов в резерв", "Reserved from their supplies")}
              </span>
              <NamedSupplies value={m.theirReserved} language={language} />
            </div>
          )}
          {kind !== 0 && p.provider === m.other && (
            <p className="play-bound-work">
              <Wrench size={18} />
              <b>{action}</b>
              {kind === 3 ? ` · ${p.delivery} ${say("груза", "cargo")}` : ""}
            </p>
          )}
          {kind !== 0 && p.provider !== m.other && (
            <p className="play-free-action">
              {say(
                "Его свободный ход не закреплён",
                "Their free action is not bound",
              )}
            </p>
          )}
        </section>
      </div>
      <div className="play-deal-benefit">
        <span className="play-benefit-icon">
          {kind === 2 ? <Package /> : kind === 3 ? <Flag /> : <Check />}
        </span>
        <div>
          <span className="dp-kicker">
            {say("Что получишь", "What you get")}
          </span>
          {kind === 2 ? (
            <>
              <strong>
                +{m.share}{" "}
                {g.stage === 0
                  ? say("новой воды тебе", "new water for you")
                  : say("груза тебе", "cargo for you")}
              </strong>
              <p>
                {g.stage === 0
                  ? say(
                      "Ещё 4 воды получает партнёр. Это выпуск проекта до питья и остальных действий.",
                      "Your partner also receives 4 water. Project output is before drinking and other actions.",
                    )
                  : say(
                      "Партнёр получает столько же. Общий маршрут определяет выпуск: 6 или 8 груза.",
                      "Your partner receives the same. The shared route determines output: 6 or 8 cargo.",
                    )}
              </p>
            </>
          ) : kind === 0 ? (
            <>
              <NamedSupplies value={m.theirs} language={language} />
              <p>
                {say(
                  "Обмен сразу меняет запасы при принятии. Действия игроков остаются свободными.",
                  "The trade changes supplies immediately on acceptance. Players keep their free actions.",
                )}
              </p>
            </>
          ) : kind === 3 ? (
            <>
              <strong>
                {p.delivery}{" "}
                {say("груза закреплено для города", "cargo bound for the city")}
              </strong>
              <p>
                {say(
                  `${provider.name} занимает действие доставкой. Охранять или работать на рынке одновременно нельзя.`,
                  `${provider.name} uses their action to deliver. They cannot also guard or work at the market.`,
                )}
              </p>
              {m.ownActionBound && m.theirs.some(Boolean) && (
                <NamedSupplies value={m.theirs} language={language} />
              )}
            </>
          ) : (
            <>
              <strong>
                {m.ownActionBound
                  ? say(
                      "Оплата за принятый заказ",
                      "Payment for the accepted order",
                    )
                  : p.action === 2 && p.delivery
                    ? say(
                        `${p.delivery} новой воды от партнёра`,
                        `${p.delivery} new water from your partner`,
                      )
                    : say(
                        `Действие партнёра: ${action}`,
                        `Partner action: ${action}`,
                      )}
              </strong>
              {m.ownActionBound && (
                <NamedSupplies value={m.theirs} language={language} />
              )}
              <p>
                {say(
                  "Цена переводится при исполнении. Результат встречи зависит и от остальных участников.",
                  "Payment transfers on execution. The encounter outcome also depends on other players.",
                )}
              </p>
            </>
          )}
        </div>
      </div>
      <div className="play-reserve-note">
        <LockKeyhole size={18} />
        <p>
          {compact
            ? g.network === "practice"
              ? say(
                  "Учебный расчёт в браузере. Подпись не требуется.",
                  "Learning runs in the browser. No signature required.",
                )
              : say(
                  "После принятия отменить пакт нельзя. Общая победа не гарантирована.",
                  "Accepted pacts cannot be cancelled. Shared victory is not guaranteed.",
                )
            : kind === 0
              ? say(
                  "Каждая сторона использует свой один пакт на эту встречу.",
                  "Each side uses their one pact for this encounter.",
                )
              : g.network === "practice"
                ? say(
                    "В обучении ресурсы и работа резервируются в браузере. В Solana-экспедиции те же условия проверяет программа.",
                    "In learning, supplies and work are reserved in the browser. In a Solana expedition the program checks these terms.",
                  )
                : say(
                    "После принятия Solana закрепляет ресурсы и работу. Пакт нельзя отменить; общая победа не гарантирована.",
                    "After acceptance Solana binds supplies and work. The pact cannot be cancelled; shared victory is not guaranteed.",
                  )}
        </p>
      </div>
      {city && city.normal.cargoShortfall > 0 && (
        <p className="dp-alert">
          {say(
            `После этой цены обычному входу не хватает ${city.normal.cargoShortfall} доступной доставки. Обход требует ${city.emergency.goal} груза и ${city.emergency.escortGoal} разных охранников.`,
            `After this price, regular entry lacks ${city.normal.cargoShortfall} available delivery. Detour needs ${city.emergency.goal} cargo and ${city.emergency.escortGoal} distinct guards.`,
          )}
        </p>
      )}
      {"job" in p && (p.job === 0 || p.job === 1) && (
        <p className="dp-alert">
          10 TEST USDC → {provider.name}.{" "}
          {say(
            "За подтверждённый ремонт; тестовые средства без стоимости. Получатель — владелец места исполнителя.",
            "For recorded repair; valueless test assets. Recipient is the provider’s seat owner.",
          )}
        </p>
      )}
      <details className="play-exact-terms">
        <summary>
          {say("Точный резерв и ограничения", "Exact reservations and limits")}
        </summary>
        <div className="play-reserve-columns">
          <div>
            <b>
              {say("Из твоих свободных запасов", "From your free supplies")}
            </b>
            <NamedSupplies value={m.mineReserved} language={language} />
          </div>
          <div>
            <b>
              {say(
                "Из свободных запасов партнёра",
                "From your partner’s free supplies",
              )}
            </b>
            <NamedSupplies value={m.theirReserved} language={language} />
          </div>
        </div>
        <p>
          {say(
            "По одному пакту на сторону в этой встрече. Резерв работы может использовать часть оплаты. Отключение исполнителя не отменяет принятое обязательство.",
            "One pact per side in this encounter. Work inputs may use part of the payment. Disconnection does not cancel the accepted obligation.",
          )}
        </p>
        {kind !== 0 && (
          <p>
            <Clock size={16} />{" "}
            {say(
              "Исполнение — при расчёте встречи. Общий маршрут выбирается большинством.",
              "Execution occurs at encounter settlement. The shared route is chosen by majority.",
            )}
          </p>
        )}
      </details>
    </div>
  );
}
