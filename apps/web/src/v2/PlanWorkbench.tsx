import {
  ArrowRight,
  Check,
  Clock,
  Coins,
  Droplets,
  Flag,
  Handshake,
  LockKeyhole,
  Package,
  Route,
  Shield,
  Wrench,
} from "lucide-react";
import type { GameView, Move } from "./model";
import { free } from "./model";
import { actionContent, invalidMove, stageContent, words } from "./content";
import {
  reviewedPlanFrozen,
  revealChoiceState,
  workboardFor,
} from "./gameplay";
import { NamedSupplies } from "./PactTermsCard";
import CityContribution from "./CityContribution";
import { routePresentation } from "./route-presentation";
import { pactPresentation } from "./pact-presentation";
const actionIcons = [Clock, Shield, Droplets, Wrench, Package, Flag, Coins];
export default function PlanWorkbench({
  game: g,
  language,
  move,
  chosen,
  busy,
  unknown,
  canSubmit,
  actionLabel,
  onAction,
  onRoute,
  onDelivery,
  onSubmit,
  onPacts,
  onRecover,
  onRevise,
}: {
  game: GameView;
  language: string;
  move: Move;
  chosen: boolean;
  busy: boolean;
  unknown: boolean;
  canSubmit: boolean;
  actionLabel: string;
  onAction(id: number): void;
  onRoute(route: number): void;
  onDelivery(amount: number): void;
  onSubmit(): void;
  onPacts(): void;
  onRecover(): void;
  onRevise?: () => void;
}) {
  const say = (ru: string, en: string) => (language === "en" ? en : ru),
    me = g.seats[g.seat],
    content = stageContent(g),
    frozen = reviewedPlanFrozen(g),
    error = invalidMove(g, move),
    board = workboardFor(g),
    reveal = revealChoiceState(g);
  const boundPact = g.offers.find(
    (p) => p.status === "accepted" && p.kind !== 0 && p.provider === g.seat,
  );
  const action = actionContent(g.stage, move.action, move.route, g.version);
  const phase =
    g.network === "practice" ? 0 : Math.max(0, Math.min(3, g.phase - 1));
  const phaseText = [
    say("Выбери путь и один свой вклад", "Choose a route and one contribution"),
    say("Закрепи свой скрытый план", "Commit your hidden plan"),
    say("Раскрой сохранённый план", "Reveal the saved plan"),
    say("Получи результат встречи", "Resolve the encounter"),
  ][phase];
  return (
    <div className="play-plan">
      <div
        className="play-phase-track"
        aria-label={say("Ход встречи", "Encounter progress")}
      >
        {[
          say("Подготовка", "Planning"),
          say("Фиксация", "Commit"),
          say("Раскрытие", "Reveal"),
          say("Результат", "Outcome"),
        ].map((label, i) => (
          <span key={i} aria-current={phase === i ? "step" : undefined}>
            <b>{i + 1}</b>
            {label}
          </span>
        ))}
      </div>
      <div className="play-plan-heading">
        <h3>{phaseText}</h3>
        <p>
          {g.network === "practice"
            ? say(
                "Обучение: после готовности ход сразу рассчитывается локально.",
                "Learning: your move resolves locally once you are ready.",
              )
            : say(
                `До конца этапа: ${Math.max(0, g.seconds)} сек. Меню не останавливает таймер.`,
                `${Math.max(0, g.seconds)}s left in this phase. Menus do not pause the timer.`,
              )}
        </p>
      </div>
      <div className="play-plan-layout">
        <aside className="play-objective-card">
          <span className="dp-kicker">
            {say("Общая задача", "Shared objective")}
          </span>
          <h4>
            {say(
              [
                "Получить воду для дороги",
                "Открыть путь к кладовой",
                "Добыть груз для города",
                "Сохранить добытый груз",
                "Пережить бурю",
                "Доставить груз и прибыть вместе",
              ][g.stage],
              [
                "Produce water for the road",
                "Open access to the cache",
                "Earn cargo for the city",
                "Protect your cargo",
                "Survive the storm",
                "Deliver cargo and arrive together",
              ][g.stage],
            )}
          </h4>
          <p>{words(language, content.need)}</p>
          <div className="play-own-stock">
            <b>{say("Можно потратить сейчас", "Available to spend now")}</b>
            <NamedSupplies value={free(me)} language={language} />
          </div>
          <div className="play-guarantee">
            <LockKeyhole size={20} />
            <p>
              {g.stage === 5
                ? say(
                    `Пактами закреплено ${board.guaranteed} груза для города.`,
                    `Pacts bind ${board.guaranteed} cargo for the city.`,
                  )
                : g.stage === 2
                  ? say(
                      `Пактами занято ${board.guaranteed} из ${board.threshold} доступных мест добычи.`,
                      `Pacts occupy ${board.guaranteed} of ${board.threshold} available extraction slots.`,
                    )
                  : say(
                      `Пактами закреплено ${board.guaranteed} из ${board.threshold} нужных ${g.stage === 3 ? "единиц защиты" : "работ"}.`,
                      `Pacts bind ${board.guaranteed} of ${board.threshold} required ${g.stage === 3 ? "defense units" : "jobs"}.`,
                    )}
            </p>
          </div>
          <button disabled={g.phase !== 1 || busy} onClick={onPacts}>
            <Handshake size={19} />
            {say("Найти помощь у партнёра", "Find a partner’s help")}
          </button>
          <p className="play-small">
            {say(
              "Свободные планы других игроков могут измениться. Пакт закрепляет только принятый вклад.",
              "Other players can change unbound plans. A pact binds only the agreed contribution.",
            )}
          </p>
        </aside>
        <div className="play-plan-choices">
          <section className="play-route-section">
            <div className="play-section-label">
              <span>1</span>
              <h4>
                {say(
                  "За какой путь голосуешь?",
                  "Which route do you vote for?",
                )}
              </h4>
            </div>
            {content.routeRelevant ? (
              <div className="play-route-picks">
                {routePresentation(g).map((route, i) => (
                  <button
                    key={i}
                    disabled={busy || frozen}
                    aria-pressed={move.route === i}
                    onClick={() => onRoute(i)}
                  >
                    <div>
                      <Route size={19} />
                      <b>{words(language, route.title)}</b>
                      {move.route === i && <Check size={18} />}
                    </div>
                    <p>{words(language, route.effect)}</p>
                  </button>
                ))}
              </div>
            ) : (
              <p className="play-neutral-note">
                {say(
                  "В буре маршрут не меняет результат. Сейчас нужны укрытие и вода.",
                  "The route does not change the storm outcome. Shelter and water matter here.",
                )}
              </p>
            )}
            <small>
              {say(
                "Общий путь определяется большинством голосов.",
                "The majority decides the shared route.",
              )}
            </small>
          </section>
          <section>
            <div className="play-section-label">
              <span>2</span>
              <h4>{say("Что сделаешь ты?", "What will you do?")}</h4>
            </div>
            {me.bound !== null && (
              <p className="play-bound-notice">
                <LockKeyhole size={19} />
                {say(
                  "Работа уже закреплена твоим пактом. Осталось проверить путь и готовность.",
                  "Your pact already binds your action. Review your route and readiness.",
                )}
              </p>
            )}
            <div className="play-action-picks" data-guide="personal-action">
              {(g.stage === 5 ? [0, 1, 5, 6] : [0, 1, 2, 3, 4])
                .filter(
                  (id) =>
                    actionContent(g.stage, id, move.route, g.version).available,
                )
                .map((id) => {
                  const info = actionContent(
                      g.stage,
                      id,
                      move.route,
                      g.version,
                    ),
                    Icon = actionIcons[id] ?? Clock;
                  return (
                    <button
                      key={id}
                      data-guide-action={id}
                      disabled={
                        busy || frozen || (me.bound !== null && me.bound !== id)
                      }
                      aria-pressed={chosen && move.action === id}
                      onClick={() => onAction(id)}
                    >
                      <span className="play-action-icon">
                        <Icon size={25} />
                      </span>
                      <strong>{words(language, info.title)}</strong>
                      <p>
                        {boundPact && me.bound === id
                          ? boundPact.kind === 2
                            ? say(
                                `Совместная работа по пакту. Твоя доля: ${pactPresentation(g, boundPact).share} ${g.stage === 0 ? "воды" : "груза"}. Вложения уже в резерве.`,
                                `Joint work under your pact. Your share: ${pactPresentation(g, boundPact).share} ${g.stage === 0 ? "water" : "cargo"}. Inputs are already reserved.`,
                              )
                            : say(
                                "Условия и необходимые вложения уже закреплены принятым пактом.",
                                "The accepted pact already binds the terms and required inputs.",
                              )
                          : words(language, info.effect)}
                      </p>
                      {!(boundPact && me.bound === id) &&
                        info.cost.some(Boolean) && (
                          <NamedSupplies
                            value={info.cost}
                            language={language}
                          />
                        )}
                      <span className="play-action-mark">
                        {chosen && move.action === id ? (
                          <>
                            <Check size={16} />
                            {say("Выбрано", "Selected")}
                          </>
                        ) : me.bound !== null && me.bound !== id ? (
                          say("Действие занято пактом", "Bound by a pact")
                        ) : (
                          say("Выбрать", "Choose")
                        )}
                      </span>
                    </button>
                  );
                })}
            </div>
          </section>
          {g.stage === 5 && (
            <CityContribution
              game={g}
              move={move}
              disabled={busy || frozen}
              language={language}
              onChange={onDelivery}
            />
          )}
        </div>
      </div>
      {reveal === "uncommitted" && (
        <p data-missed-plan tabIndex={-1} className="dp-alert">
          {say(
            "Ты не успел закрепить план. Раскрыть новый выбор нельзя; программа применит правила пропуска. Принятые пакты сохраняются.",
            "Your plan was not committed in time. A new choice cannot be revealed; missing-plan rules apply. Accepted pacts remain binding.",
          )}
        </p>
      )}
      {reveal === "needs-copy" && (
        <div className="play-recovery-prompt">
          <div>
            <h4>
              {say(
                "Нужна исходная копия хода",
                "The original move copy is needed",
              )}
            </h4>
            <p>
              {say(
                "Новый выбор не раскроет прежнюю фиксацию. Импортируй сохранённый файл.",
                "A new choice cannot reveal the old commitment. Import the saved file.",
              )}
            </p>
          </div>
          <button onClick={onRecover}>
            {say("Восстановить ход", "Recover the move")}
            <ArrowRight size={18} />
          </button>
        </div>
      )}
      {g.network !== "practice" && g.phase === 1 && me.ready && (
        <div className="play-recovery-prompt">
          <p>
            {say(
              "План уже одобрен. Чтобы изменить его, сначала сними готовность.",
              "Your plan is approved. Withdraw readiness before changing it.",
            )}
          </p>
          {onRevise && (
            <button disabled={busy || unknown} onClick={onRevise}>
              {say("Изменить мой план", "Edit my plan")}
            </button>
          )}
        </div>
      )}
      <footer className="play-plan-footer">
        <div>
          <span className="dp-kicker">{say("Твой выбор", "Your choice")}</span>
          <strong>
            {chosen
              ? words(language, action.title)
              : say("Сначала выбери действие", "Choose an action first")}
          </strong>
          {chosen && error && (
            <p role="status" className="play-input-error">
              {words(language, error)}
            </p>
          )}
          {!error && chosen && (
            <p>
              {say(
                "Результат появится после расчёта встречи.",
                "The outcome appears after encounter settlement.",
              )}
            </p>
          )}
          {g.phase === 2 && (g.committed & (1 << g.seat)) !== 0 && (
            <p>
              {say(
                "План уже закреплён. Ждём этап раскрытия.",
                "Already committed. Waiting for the reveal phase.",
              )}
            </p>
          )}
          {reveal === "revealed" && (
            <p>
              {say(
                "Ход раскрыт. Ждём расчёта встречи.",
                "Move revealed. Waiting for settlement.",
              )}
            </p>
          )}
        </div>
        <button
          data-guide="submit-plan"
          className="dp-primary"
          disabled={!canSubmit}
          onClick={onSubmit}
        >
          {actionLabel}
          <ArrowRight size={21} />
        </button>
      </footer>
      {g.network !== "practice" && (
        <p className="play-signature-help">
          {g.sessionActive && !g.sessionPaused && g.automaticPlanApproved
            ? say(
                "Ограниченная сессия отправит только этот одобренный ход в разрешённые фазы.",
                "Your bounded session sends only this approved move during the permitted phases.",
              )
            : say(
                "Фиксация и раскрытие требуют отдельных подписей. Не пропускай раскрытие: от него зависит личный зачёт.",
                "Commitment and reveal require separate signatures. Missing reveal forfeits personal scoring.",
              )}
        </p>
      )}
    </div>
  );
}
