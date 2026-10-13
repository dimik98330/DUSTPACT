import {
  Check,
  Flag,
  Info,
  Package,
  Shield,
  TriangleAlert,
} from "lucide-react";
import type { GameView, Receipt } from "./model";
import { expeditionDebrief } from "../../../../packages/engine/src/v3-debrief";
import { words } from "./content";
import ReceiptContracts from "./ReceiptContracts";
type Encounter = ReturnType<typeof expeditionDebrief>["encounters"][number];
export default function ResultEncounter({
  encounter: e,
  receipt: r,
  game: g,
  language,
}: {
  encounter: Encounter;
  receipt: Receipt;
  game: GameView;
  language: string;
}) {
  const say = (ru: string, en: string) => (language === "en" ? en : ru),
    label = [
      say("Работы у колодца", "Well work"),
      say("Ремонты моста", "Bridge repairs"),
      say("Действия добычи", "Extraction actions"),
      say("Защита / угроза", "Defense / threat"),
      say("Работы по укрытию", "Shelter work"),
      say("Груз для города", "Cargo for the city"),
    ][e.stage];
  return (
    <article className="play-result-encounter">
      <header>
        <span className={`play-result-status ${e.objective ? "is-met" : ""}`}>
          {e.objective ? <Check size={18} /> : <Info size={18} />}{" "}
          {say(`Встреча ${e.stage + 1}`, `Encounter ${e.stage + 1}`)}
        </span>
        <h3>{words(language, [...e.headline])}</h3>
      </header>
      <div className="play-result-numbers">
        <div>
          <Package size={22} />
          <span>{label}</span>
          <b>
            {e.progress ?? "—"} <small>/ {e.goal}</small>
          </b>
        </div>
        <div>
          <Shield size={22} />
          <span>{say("Прочность каравана", "Caravan hull")}</span>
          <b>
            {e.hullBefore} → {e.hullAfter}
          </b>
        </div>
      </div>
      <div className="play-result-explanation">
        <h4>{say("Что это изменило", "What changed")}</h4>
        {e.facts.map((f, i) => (
          <p key={i}>
            <span>{i + 1}</span>
            {e.stage === 5 && r.route === 0 && f[0].startsWith("Эскорт:")
              ? say(
                  "Выбран вход через ворота: обязательный эскорт не нужен.",
                  "The caravan chose the gates: mandatory escorts are not required.",
                )
              : words(language, [...f])}
          </p>
        ))}
      </div>
      {e.missingSeats.length > 0 && (
        <p className="play-missed-result">
          <TriangleAlert size={19} />
          <span>
            {say("Не раскрыли ход", "Did not reveal")}:{" "}
            <b>
              {e.missingSeats.map((i) => g.seats[i]?.name ?? "?").join(", ")}
            </b>
            .{" "}
            {say(
              "Это влияет на личный зачёт. Принятые пакты учитываются отдельно.",
              "This affects personal scoring. Accepted pacts are evaluated separately.",
            )}
          </span>
        </p>
      )}
      <div className="play-result-pacts">
        <HandshakeLabel count={e.pacts.length} language={language} />
        {e.pacts.length > 0 ? (
          <ReceiptContracts receipt={r} game={g} language={language} />
        ) : (
          <p>
            {say(
              "Участники выбирали действия без принятых договоров.",
              "Players acted without accepted pacts.",
            )}
          </p>
        )}
      </div>
    </article>
  );
}
function HandshakeLabel({
  count,
  language,
}: {
  count: number;
  language: string;
}) {
  return (
    <h4>
      <Flag size={18} />
      {language === "en"
        ? `Accepted pacts: ${count}`
        : `Принятые пакты: ${count}`}
    </h4>
  );
}
