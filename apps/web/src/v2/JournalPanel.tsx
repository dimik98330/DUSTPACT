import { useState } from "react";
import {
  Droplets,
  Wrench,
  Package,
  Swords,
  Wind,
  Flag,
  Check,
  Shield,
  Route,
  Handshake,
  ScanLine,
  Clock,
  ArrowRight,
  FileCheck2,
  Info,
} from "lucide-react";
import type { GameView } from "./model";
import { expeditionDebrief as debriefV2 } from "../../../../packages/engine/src/v2-debrief";
import { expeditionDebrief as debriefV3 } from "../../../../packages/engine/src/v3-debrief";
import { actionContent, words } from "./content";
import { BundleDisplay } from "./Resources";
import { CopyField, PanelNav } from "./PanelParts";
const icons = [Droplets, Wrench, Package, Swords, Wind, Flag];
export default function JournalPanel({
  game: g,
  language,
  onWallet,
}: {
  game: GameView;
  language: string;
  onWallet(): void;
}) {
  const say = (ru: string, en: string) => (language === "en" ? en : ru),
    d = (g.version === 3 ? debriefV3 : debriefV2)(g),
    [stage, setStage] = useState(d.encounters.at(-1)?.stage ?? 0),
    [view, setView] = useState<"outcome" | "players" | "pacts" | "proof">(
      "outcome",
    );
  const e = d.encounters.find((e) => e.stage === stage) ?? d.encounters.at(-1),
    r = g.history.find((r) => r.stage === e?.stage);
  return (
    <div className="jr-journal">
      <aside className="jr-index">
        <div className="jr-index-heading">
          <span className="dp-kicker">
            {say("Дневник каравана", "Caravan journal")}
          </span>
          <b>
            {d.encounters.length} <span>/ 6 {say("встреч", "encounters")}</span>
          </b>
        </div>
        <nav aria-label={say("Встречи экспедиции", "Expedition encounters")}>
          {d.encounters.map((x) => {
            const Icon = icons[x.stage] ?? Flag;
            return (
              <button
                key={x.stage}
                aria-current={e?.stage === x.stage ? "step" : undefined}
                onClick={() => {
                  setStage(x.stage);
                  setView("outcome");
                }}
              >
                <span className="jr-level-icon">
                  <Icon size={21} />
                </span>
                <span>
                  <small>
                    {say(`Встреча ${x.stage + 1}`, `Encounter ${x.stage + 1}`)}
                  </small>
                  <b>{words(language, [...x.name])}</b>
                </span>
                {x.objective ? (
                  <Check className="jr-done" size={18} />
                ) : (
                  <span
                    className="jr-incomplete"
                    aria-label={say(
                      "Цель не выполнена",
                      "Objective unfulfilled",
                    )}
                  />
                )}
              </button>
            );
          })}
        </nav>
        <div className="jr-index-note">
          <Info size={18} />
          <p>
            {say(
              "Выбери встречу: увидишь решения игроков, оставшиеся запасы и исполненные пакты.",
              "Select an encounter to see player decisions, remaining supplies and executed pacts.",
            )}
          </p>
        </div>
      </aside>
      <div className="jr-detail">
        {!e || !r ? (
          <div className="jr-empty">
            <Clock size={38} />
            <h3>
              {say(
                "Первая запись ещё впереди",
                "The first entry is still ahead",
              )}
            </h3>
            <p>
              {say(
                "После расчёта встречи здесь появятся действия участников и их последствия. Сейчас можно вернуться в экспедицию и подготовить план.",
                "Once an encounter resolves, player actions and their consequences appear here. Return to the expedition to prepare your plan.",
              )}
            </p>
          </div>
        ) : (
          <>
            <header className="jr-detail-heading">
              <div>
                <span className="dp-kicker">
                  {say(
                    `Встреча ${e.stage + 1} · результат`,
                    `Encounter ${e.stage + 1} · outcome`,
                  )}
                </span>
                <h3>{words(language, [...e.name])}</h3>
              </div>
              <span
                className={`jr-proof-label ${r.proof === "finalized" ? "jr-finalized" : ""}`}
              >
                <FileCheck2 size={16} />
                {r.proof === "practice"
                  ? say("Учебный расчёт", "Learning simulation")
                  : r.proof === "finalized"
                    ? say("Solana · окончательно", "Solana · finalized")
                    : say("Solana · подтверждено", "Solana · confirmed")}
              </span>
            </header>
            <PanelNav<"outcome" | "players" | "pacts" | "proof">
              value={view}
              onChange={setView}
              label={say("Детали встречи", "Encounter details")}
              items={[
                {
                  id: "outcome",
                  label: say("Что произошло", "What happened"),
                  icon: <Route size={18} />,
                },
                {
                  id: "players",
                  label: say("Участники", "Players"),
                  icon: <Flag size={18} />,
                },
                {
                  id: "pacts",
                  label: say(
                    `Пакты · ${e.pacts.length}`,
                    `Pacts · ${e.pacts.length}`,
                  ),
                  icon: <Handshake size={18} />,
                },
                {
                  id: "proof",
                  label: say("Проверка", "Verification"),
                  icon: <ScanLine size={18} />,
                },
              ]}
            />
            {view === "outcome" && (
              <>
                <div
                  className={`jr-outcome ${e.objective ? "jr-outcome-met" : ""}`}
                >
                  <span className="jr-outcome-icon">
                    {e.objective ? <Check size={24} /> : <Info size={24} />}
                  </span>
                  <div>
                    <h4>{words(language, [...e.headline])}</h4>
                    {e.facts.map((f, i) => (
                      <p key={i}>{words(language, [...f])}</p>
                    ))}
                  </div>
                </div>
                <div className="jr-stats">
                  <div>
                    <Shield size={21} />
                    <span>{say("Прочность каравана", "Caravan hull")}</span>
                    <b>
                      {r.hullBefore} <ArrowRight size={17} /> {r.hullAfter}
                      <small>/12</small>
                    </b>
                  </div>
                  <div>
                    <Route size={21} />
                    <span>{say("Выбранный путь", "Chosen route")}</span>
                    <b>
                      {r.route === 0
                        ? say("Основной", "Main")
                        : say("Обход", "Detour")}
                    </b>
                  </div>
                  <div>
                    <Handshake size={21} />
                    <span>{say("Принятые пакты", "Accepted pacts")}</span>
                    <b>{e.pacts.length}</b>
                  </div>
                </div>
                <section className="jr-own-outcome">
                  <div>
                    <span className="dp-kicker">
                      {say("Твой фактический ход", "Your resolved action")}
                    </span>
                    <h4>
                      {words(
                        language,
                        actionContent(
                          r.stage,
                          r.actions[g.seat] ?? 0,
                          r.route,
                          g.version,
                        ).title,
                      )}
                    </h4>
                    <p>
                      {e.missingSeats.includes(g.seat)
                        ? say(
                            "План не был раскрыт: применено действие по правилам пропуска.",
                            "Your plan was not revealed: missing-plan rules determined your action.",
                          )
                        : say(
                            "Это исполненное действие, сохранённое в квитанции.",
                            "This is the executed action retained in the receipt.",
                          )}
                    </p>
                  </div>
                  <div>
                    <span className="dp-kicker">
                      {say(
                        "Твои запасы после встречи",
                        "Your supplies after the encounter",
                      )}
                    </span>
                    <div className="jr-own-resources">
                      {[Droplets, Wrench, Package].map((Icon, j) => (
                        <div key={j}>
                          <span>
                            <Icon size={19} />
                            <b>{r.resources[g.seat]?.[j] ?? "—"}</b>
                          </span>
                          <small>
                            {say(
                              ["Вода", "Инструменты", "Груз"][j],
                              ["Water", "Tools", "Cargo"][j],
                            )}
                          </small>
                        </div>
                      ))}
                    </div>
                    <button onClick={() => setView("players")}>
                      {say("Решения всех участников", "All player decisions")}
                      <ArrowRight size={17} />
                    </button>
                  </div>
                </section>
              </>
            )}
            {view === "players" && (
              <>
                <section className="jr-players">
                  <div className="jr-section-heading">
                    <h4>{say("Решения и запасы", "Decisions and supplies")}</h4>
                    <span>
                      {say(
                        "Запасы после встречи · вклад за эту встречу",
                        "Supplies after the encounter · contribution this encounter",
                      )}
                    </span>
                  </div>
                  <div
                    role="table"
                    aria-label={say("Действия участников", "Player actions")}
                  >
                    <div className="jr-player-row jr-player-head" role="row">
                      <span role="columnheader">
                        {say("Участник", "Player")}
                      </span>
                      <span role="columnheader">
                        {say("Действие", "Action")}
                      </span>
                      <span role="columnheader">
                        <Droplets size={15} />
                        {say("Вода", "Water")}
                      </span>
                      <span role="columnheader">
                        <Wrench size={15} />
                        {say("Инстр.", "Tools")}
                      </span>
                      <span role="columnheader">
                        <Package size={15} />
                        {say("Груз", "Cargo")}
                      </span>
                      <span role="columnheader">
                        {say("Вклад", "Contribution")}
                      </span>
                    </div>
                    {g.seats.map((s, i) => (
                      <div
                        role="row"
                        className={`jr-player-row ${i === g.seat ? "jr-own-player" : ""}`}
                        key={s.owner || i}
                      >
                        <div role="cell">
                          <b>{s.name}</b>
                          <small>
                            {e.missingSeats.includes(i)
                              ? say("План не раскрыт", "Reveal missing")
                              : s.npc
                                ? say("Агент", "Agent")
                                : i === g.seat
                                  ? say("Это ты", "You")
                                  : say("Игрок", "Player")}
                          </small>
                        </div>
                        <span role="cell" className="jr-player-action">
                          {words(
                            language,
                            actionContent(
                              r.stage,
                              r.actions[i] ?? 0,
                              r.route,
                              g.version,
                            ).title,
                          )}
                        </span>
                        {[0, 1, 2].map((j) => (
                          <span
                            key={j}
                            role="cell"
                            data-label={say(
                              ["Вода", "Инструменты", "Груз"][j],
                              ["Water", "Tools", "Cargo"][j],
                            )}
                          >
                            {r.resources[i]?.[j] ?? "—"}
                          </span>
                        ))}
                        <span
                          role="cell"
                          data-label={say("Вклад", "Contribution")}
                        >
                          {e.personalChanges[i]?.support ?? "—"}
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
                {r.stage === 5 && (
                  <p className="jr-footnote">
                    {say(
                      "Отдано городу за встречу",
                      "Delivered to the city this encounter",
                    )}
                    :{" "}
                    {g.seats
                      .map((s, i) => `${s.name}: ${r.deliveries?.[i] ?? "—"}`)
                      .join(" · ")}
                  </p>
                )}
                {r.reasons.length > 0 && (
                  <details className="dp-details">
                    <summary>
                      {say(
                        "Почему некоторые планы изменились",
                        "Why some plans changed",
                      )}
                    </summary>
                    {r.reasons.map((x, i) => (
                      <p key={i}>{x}</p>
                    ))}
                  </details>
                )}
              </>
            )}
            {view === "pacts" && (
              <div className="jr-contracts">
                {e.pacts.length ? (
                  e.pacts.map((p, i) => (
                    <article
                      className="jr-contract"
                      key={`${p.maker}:${p.nonce ?? i}`}
                    >
                      <header>
                        <div>
                          <span className="dp-kicker">
                            {say(
                              [
                                "Обмен",
                                "Заказ работы",
                                "Совместный проект",
                                "Пакт доставки",
                              ][p.kind] ?? "Пакт",
                              [
                                "Barter",
                                "Work order",
                                "Joint project",
                                "Delivery pledge",
                              ][p.kind] ?? "Pact",
                            )}
                          </span>
                          <h4>
                            {g.seats[p.maker].name} <span>↔</span>{" "}
                            {g.seats[p.taker].name}
                          </h4>
                        </div>
                        <span className="jr-proof-label">
                          {p.execution === "performed" ||
                          p.execution === "swapped-on-acceptance"
                            ? say("Исполнено", "Executed")
                            : p.execution === "unperformed"
                              ? say("Не исполнено", "Not performed")
                              : say("Нет подтверждения", "Unverified")}
                        </span>
                      </header>
                      <div className="jr-contract-inputs">
                        {[p.maker, p.taker].map((seat, side) => (
                          <div key={seat}>
                            <span>
                              {g.seats[seat].name} ·{" "}
                              {say("вклад", "contribution")}
                            </span>
                            <BundleDisplay
                              value={p.gives[side] as [number, number, number]}
                              language={language}
                            />
                          </div>
                        ))}
                      </div>
                      {p.kind !== 0 && (
                        <p>
                          <b>
                            {say("Исполнитель", "Provider")}:{" "}
                            {g.seats[p.provider].name}
                          </b>{" "}
                          ·{" "}
                          {words(
                            language,
                            actionContent(r.stage, p.action, r.route, g.version)
                              .title,
                          )}
                        </p>
                      )}
                      {p.allocation && (
                        <div className="jr-contract-output">
                          <Package size={20} />
                          {say(
                            `Результат проекта: по ${p.allocation.each} ${p.allocation.resource === 0 ? "воды" : "груза"} каждому партнёру.`,
                            `Project allocation: ${p.allocation.each} ${p.allocation.resource === 0 ? "water" : "cargo"} to each partner.`,
                          )}
                        </div>
                      )}
                      {p.kind === 3 && (
                        <p>
                          {say(
                            `Закреплено ${r.pledged?.[p.provider] ?? p.delivery} груза; дополнительно доставлено ${r.voluntary?.[p.provider] ?? 0}.`,
                            `Bound ${r.pledged?.[p.provider] ?? p.delivery} cargo; voluntarily delivered ${r.voluntary?.[p.provider] ?? 0} extra.`,
                          )}
                        </p>
                      )}
                      {p.waterDelivery && (
                        <p>
                          {say("Поставка воды", "Water delivery")}:{" "}
                          {p.waterDelivery.actual === null
                            ? say("не подтверждена", "unverified")
                            : `${p.waterDelivery.actual} / ${p.waterDelivery.agreed}`}
                          .
                        </p>
                      )}
                      {r.stage === 1 &&
                        r.route === 1 &&
                        p.execution === "performed" && (
                          <p>
                            {say(
                              "Ремонт исполнен, но большинство выбрало обход. Пакт не гарантировал выбор общего пути.",
                              "Repair executed, but the majority chose the detour. The pact did not guarantee the shared route.",
                            )}
                          </p>
                        )}
                      {p.job !== null && (
                        <button onClick={onWallet}>
                          {say("Проверить TEST-выплату", "Check TEST payout")}
                          <ArrowRight size={18} />
                        </button>
                      )}
                    </article>
                  ))
                ) : (
                  <div className="jr-empty">
                    <Handshake size={36} />
                    <h3>
                      {say(
                        "Эта встреча — без пактов",
                        "No pacts this encounter",
                      )}
                    </h3>
                    <p>
                      {say(
                        "Участники действовали свободно. Их фактические действия сохранены во вкладке «Что произошло».",
                        "Players acted without accepted pacts. Their actual actions are retained under “What happened”.",
                      )}
                    </p>
                  </div>
                )}
              </div>
            )}
            {view === "proof" && (
              <div className="jr-verification">
                <div
                  className={`jr-outcome ${r.proof === "finalized" ? "jr-outcome-met" : ""}`}
                >
                  <ScanLine size={27} />
                  <div>
                    <h4>
                      {r.proof === "practice"
                        ? say("Рассчитано локально", "Resolved locally")
                        : r.proof === "finalized"
                          ? say(
                              "Результат сохранён в Solana",
                              "Result retained on Solana",
                            )
                          : say("Ожидаем окончательности", "Awaiting finality")}
                    </h4>
                    <p>
                      {r.proof === "practice"
                        ? say(
                            "Это обучение без блокчейна. Квитанция показывает расчёт Rust/Wasm, а не транзакцию Solana.",
                            "This is offchain learning. The receipt shows a Rust/Wasm calculation, not a Solana transaction.",
                          )
                        : r.proof === "finalized"
                          ? say(
                              "Окончательная квитанция фиксирует действия и результат этой встречи. Выплата TEST-токенов проверяется отдельно.",
                              "The finalized receipt retains this encounter’s actions and outcome. Check TEST token payout separately.",
                            )
                          : say(
                              "Транзакция подтверждена, но ещё не окончательна. Статус может измениться до finalized.",
                              "The transaction is confirmed but not finalized. Status may change before finalization.",
                            )}
                    </p>
                  </div>
                </div>
                <section className="jr-proof-card">
                  <h4>{say("Проверка правил", "Rules verification")}</h4>
                  <p>
                    {g.replay
                      ? g.replay.valid
                        ? say(
                            `Rust/Wasm: проверено ${g.replay.checkedStages} встреч в доступной истории.`,
                            `Rust/Wasm: verified ${g.replay.checkedStages} encounters in the available history.`,
                          )
                        : say(
                            "Независимая проверка истории не прошла. Не считай её подтверждённой.",
                            "Independent history verification failed. Do not treat it as verified.",
                          )
                      : say(
                          "Независимая проверка истории пока недоступна.",
                          "Independent history verification is not available yet.",
                        )}
                  </p>
                  {g.replay?.error && (
                    <p className="dp-alert">{g.replay.error}</p>
                  )}
                  <dl>
                    <div>
                      <dt>{say("Протокол", "Protocol")}</dt>
                      <dd>{g.version}</dd>
                    </div>
                    <div>
                      <dt>{say("Сеть", "Network")}</dt>
                      <dd>{g.network}</dd>
                    </div>
                    <div>
                      <dt>{say("Ревизия матча", "Match revision")}</dt>
                      <dd>{g.revision}</dd>
                    </div>
                  </dl>
                  {g.network !== "practice" && (
                    <CopyField
                      value={g.match}
                      label={say("Адрес матча", "Match address")}
                      language={language}
                    />
                  )}
                  {r.settlementKey && g.network !== "practice" && (
                    <CopyField
                      value={r.settlementKey}
                      label={say("Квитанция встречи", "Encounter receipt")}
                      language={language}
                    />
                  )}
                </section>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
