import { useState } from "react";
import {
  CheckCircle2,
  Compass,
  Package,
  Shield,
  Route,
  Flag,
  ArrowRight,
  History,
  Wallet,
  TriangleAlert,
} from "lucide-react";
import { expeditionDebrief as debriefV2 } from "../../../../packages/engine/src/v2-debrief";
import { expeditionDebrief as debriefV3 } from "../../../../packages/engine/src/v3-debrief";
import type { GameView } from "./model";
import { words } from "./content";
import { PanelNav } from "./PanelParts";
import ResultEncounter from "./ResultEncounter";
export default function ResultPanel({
  game: g,
  language,
  onHistory,
  onWallet,
  onExit,
  onRefresh,
  busy,
}: {
  game: GameView;
  language: string;
  onHistory(): void;
  onWallet(): void;
  onExit(): void;
  onRefresh(): void;
  busy: boolean;
}) {
  const say = (ru: string, en: string) => (language === "en" ? en : ru),
    d = (g.version === 3 ? debriefV3 : debriefV2)(g),
    [section, setSection] = useState<"score" | "route">("score"),
    [stage, setStage] = useState(d.encounters.at(-1)?.stage ?? 0);
  const e = d.encounters.find((e) => e.stage === stage),
    receipt = g.history.find((r) => r.stage === stage);
  const causes = [
    ...(d.failureCauses.includes("hull")
      ? [
          say(
            "Прочность каравана упала до нуля.",
            "The caravan lost all its hull.",
          ),
        ]
      : []),
    ...(d.failureCauses.includes("delivery") && d.gate
      ? [
          say(
            `До входа в город не довезли ${Math.max(0, d.gate.required - d.gate.delivered)} груза.`,
            `Delivery was ${Math.max(0, d.gate.required - d.gate.delivered)} cargo short of the city requirement.`,
          ),
        ]
      : []),
    ...("escortFailure" in d && d.escortFailure
      ? [
          say(
            "Для обхода не хватило отдельных охранников.",
            "The detour lacked distinct guards.",
          ),
        ]
      : []),
  ];
  return (
    <div className="dp-results play-results">
      <div className="dp-result-layout">
        <aside className="dp-result-summary">
          <div
            className={`dp-result-banner ${g.arrived ? "dp-result-success" : "dp-result-failed"}`}
          >
            <div className="dp-result-symbol">
              {g.arrived ? <CheckCircle2 size={35} /> : <Compass size={35} />}
            </div>
            <div>
              <span className="dp-kicker">
                {say("Общий результат", "Shared outcome")}
              </span>
              <h3>
                {g.arrived
                  ? say("Караван прибыл", "The caravan reached the city")
                  : say("Караван не дошёл", "The expedition did not succeed")}
              </h3>
              {g.arrived ? (
                <p>
                  {say(
                    "Груз доставлен, караван уцелел. Личный счёт сохранён у участников без потери зачёта.",
                    "Cargo delivered and caravan intact. Players without a forfeiture keep their personal score.",
                  )}
                </p>
              ) : causes.length ? (
                <ul>
                  {causes.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              ) : (
                <p>
                  {say(
                    "В доступных квитанциях нет подтверждённой причины. Обнови состояние.",
                    "Available receipts do not establish the cause. Refresh the state.",
                  )}
                </p>
              )}
            </div>
            {!g.arrived && !causes.length && (
              <button disabled={busy} onClick={onRefresh}>
                {say("Обновить состояние", "Refresh state")}
              </button>
            )}
          </div>
          <div className="dp-result-metrics">
            <article>
              <Package />
              <div>
                <b>
                  {d.gate ? `${d.gate.delivered} / ${d.gate.required}` : "—"}
                </b>
                <span>
                  {say("груза у входа в город", "cargo at the city gate")}
                </span>
              </div>
            </article>
            <article>
              <Shield />
              <div>
                <b>{g.hull} / 12</b>
                <span>{say("прочность каравана", "caravan hull")}</span>
              </div>
            </article>
            <article>
              <Flag />
              <div>
                <b>{d.encounters.length} / 6</b>
                <span>{say("завершено встреч", "resolved encounters")}</span>
              </div>
            </article>
          </div>
        </aside>
        <div className="dp-result-review">
          <PanelNav<"score" | "route">
            value={section}
            onChange={setSection}
            label={say("Разбор экспедиции", "Expedition review")}
            items={[
              {
                id: "score",
                label: say("Личный результат", "Personal results"),
                icon: <Flag size={19} />,
              },
              {
                id: "route",
                label: say("Решения по дороге", "Journey decisions"),
                icon: <Route size={19} />,
              },
            ]}
          />
          {section === "score" && (
            <section className="dp-card dp-score-card">
              <div className="dp-section-heading">
                <div>
                  <h3>
                    {say(
                      "Вклад каждого участника",
                      "Each player’s contribution",
                    )}
                  </h3>
                  <p>
                    {say(
                      "Груз × 3 + доставлено + вклад",
                      "Cargo × 3 + delivered + work contribution",
                    )}
                  </p>
                </div>
              </div>
              {!g.arrived && (
                <p className="dp-alert">
                  <TriangleAlert size={20} />
                  {say(
                    "Общее прибытие — условие личного зачёта. Караван не дошёл, поэтому итог у всех — 0.",
                    "Arrival is required for personal scoring. The caravan failed, so everyone’s final score is 0.",
                  )}
                </p>
              )}
              {d.scores ? (
                <div
                  className="dp-score-table"
                  role="table"
                  aria-label={say("Итоговые очки", "Final scores")}
                >
                  <div className="dp-score-row dp-score-head" role="row">
                    <span role="columnheader">{say("Участник", "Player")}</span>
                    <span role="columnheader">
                      {say("Груз × 3", "Cargo × 3")}
                    </span>
                    <span role="columnheader">
                      {say("Доставка", "Delivered")}
                    </span>
                    <span role="columnheader">
                      {say("Вклад", "Contribution")}
                    </span>
                    <span role="columnheader">{say("Итог", "Total")}</span>
                  </div>
                  {d.scores.map((s) => (
                    <div
                      className={`dp-score-row ${s.seat === g.seat ? "dp-score-you" : ""}`}
                      role="row"
                      key={s.seat}
                    >
                      <div role="cell">
                        <b>{g.seats[s.seat]?.name ?? "?"}</b>
                        <span>
                          {g.seats[s.seat]?.forfeited
                            ? say(
                                "Зачёт потерян: пропущено раскрытие",
                                "Forfeited: reveal missed",
                              )
                            : s.seat === g.seat
                              ? say("Это ты", "You")
                              : g.seats[s.seat]?.npc
                                ? say("Агент", "Agent")
                                : say("Игрок", "Player")}
                        </span>
                      </div>
                      <span
                        role="cell"
                        data-label={say("Груз × 3", "Cargo × 3")}
                      >
                        {s.cargoPoints}
                      </span>
                      <span
                        role="cell"
                        data-label={say("Доставка", "Delivered")}
                      >
                        {s.delivered}
                      </span>
                      <span
                        role="cell"
                        data-label={say("Вклад", "Contribution")}
                      >
                        {s.contribution}
                      </span>
                      <strong role="cell" data-label={say("Итог", "Total")}>
                        {s.total}
                      </strong>
                    </div>
                  ))}
                </div>
              ) : (
                <p>
                  {say(
                    "Личный счёт появится после завершения экспедиции.",
                    "Personal scores appear once the expedition ends.",
                  )}
                </p>
              )}
            </section>
          )}
          {section === "route" && (
            <div className="dp-route-review">
              <nav
                className="dp-route-nav"
                aria-label={say("Выбрать встречу", "Choose an encounter")}
              >
                {d.encounters.map((x) => (
                  <button
                    key={x.stage}
                    aria-current={stage === x.stage ? "step" : undefined}
                    onClick={() => setStage(x.stage)}
                  >
                    <b>{x.stage + 1}</b>
                    <span>{words(language, [...x.name])}</span>
                    <small>
                      {x.hullBefore} → {x.hullAfter}
                    </small>
                  </button>
                ))}
              </nav>
              {e && receipt ? (
                <ResultEncounter
                  encounter={e}
                  receipt={receipt}
                  game={g}
                  language={language}
                />
              ) : (
                <section className="dp-card">
                  <p>
                    {say(
                      "Завершённых встреч ещё нет.",
                      "No resolved encounters yet.",
                    )}
                  </p>
                </section>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="dp-result-actions">
        <div>
          {(g.network === "practice" || g.vault?.funded) && (
            <p>
              {g.network === "practice"
                ? say(
                    "Учебная экспедиция: без токенов и выплат.",
                    "Learning expedition: no tokens or payouts.",
                  )
                : say(
                    "Выполненная TEST-работа оплачивается отдельно от личного счёта.",
                    "Completed TEST work is paid separately from personal scores.",
                  )}
            </p>
          )}
          {g.network !== "practice" && g.vault?.funded && (
            <button onClick={onWallet}>
              <Wallet size={19} />
              {say("Проверить выплаты", "Check payouts")}
            </button>
          )}
          <button onClick={onHistory}>
            <History size={19} />
            {say("Квитанции встреч", "Encounter receipts")}
          </button>
        </div>
        <button className="dp-primary" onClick={onExit}>
          {say("Новая экспедиция", "New expedition")}
          <ArrowRight size={19} />
        </button>
      </div>
    </div>
  );
}
