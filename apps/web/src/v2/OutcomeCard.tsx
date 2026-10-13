import {
  ArrowUpRight,
  Check,
  ChevronDown,
  Droplets,
  Package,
  Shield,
  Wrench,
} from "lucide-react";
import type { GameView, Receipt } from "./model";
import { encounterNames, words } from "./content";
import { receiptDelta } from "./gameplay";
import { expeditionDebrief } from "../../../../packages/engine/src/v2-debrief";
import { expeditionDebrief as debriefV3 } from "../../../../packages/engine/src/v3-debrief";
const icons = [Droplets, Wrench, Package];
export default function OutcomeCard({
  game: g,
  receipt: r,
  language,
  open = false,
  onHistory,
}: {
  game: GameView;
  receipt: Receipt;
  language: string;
  open?: boolean;
  onHistory?(): void;
}) {
  const say = (ru: string, en: string) => (language === "en" ? en : ru),
    delta = receiptDelta(g, r);
  const previous =
    r.stage === 0
      ? 0
      : g.history.find((h) => h.stage === r.stage - 1)?.support[g.seat];
  const contribution =
    previous === undefined ? 0 : r.support[g.seat] - previous;
  const explanation = (g.version === 3 ? debriefV3 : expeditionDebrief)(
    g,
  ).encounters.find((e) => e.stage === r.stage);
  return (
    <details
      className="v2-outcome-card hud-receipt"
      data-guide="receipt"
      open={open || undefined}
    >
      <summary>
        <span className="hud-receipt-mark" aria-hidden="true">
          {r.objective ? <Check size={17} /> : <Shield size={17} />}
        </span>
        <span>
          <small>{say("Прошлая встреча", "Last encounter")}</small>
          <b>{words(language, encounterNames[r.stage])}</b>
        </span>
        <ChevronDown size={17} className="hud-chevron" aria-hidden="true" />
      </summary>
      <div className="hud-receipt-body">
        <h3>
          {explanation
            ? words(language, [...explanation.headline])
            : r.objective
              ? say("Цель выполнена", "Objective met")
              : say("Цель не выполнена", "Objective missed")}
        </h3>
        <div className="hud-hull-change">
          <Shield size={17} aria-hidden="true" />
          <span>{say("Прочность", "Hull")}</span>
          <b>
            {r.hullBefore} → {r.hullAfter}
          </b>
        </div>
        <span className="hud-stock-label">
          {say(
            "Твои запасы после встречи",
            "Your supplies after the encounter",
          )}
        </span>
        <div className="hud-receipt-stock">
          {r.resources[g.seat].map((value, i) => {
            const Icon = icons[i],
              n = delta?.[i];
            return (
              <div key={i}>
                <span>
                  <Icon size={16} aria-hidden="true" />
                  {say(
                    ["Вода", "Инструм.", "Груз"][i],
                    ["Water", "Tools", "Cargo"][i],
                  )}
                </span>
                <b>{value}</b>
                <small>
                  {n === undefined
                    ? "—"
                    : n === 0
                      ? say("без изменений", "unchanged")
                      : `${n > 0 ? "+" : ""}${n}`}
                </small>
              </div>
            );
          })}
        </div>
        {contribution > 0 && (
          <div className="hud-contribution">
            <span>{say("Вклад за встречу", "Encounter contribution")}</span>
            <b>+{contribution}</b>
          </div>
        )}
        {onHistory && !open && (
          <button className="hud-detail-link" onClick={onHistory}>
            {say("Разобрать встречу", "Review encounter")}
            <ArrowUpRight size={17} aria-hidden="true" />
          </button>
        )}
      </div>
    </details>
  );
}
