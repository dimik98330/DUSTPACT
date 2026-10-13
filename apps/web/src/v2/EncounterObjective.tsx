import { ArrowRight } from "lucide-react";
import type { GameView } from "./model";
import { encounterNames, words } from "./content";
import OutcomeCard from "./OutcomeCard";
export default function EncounterObjective({
  game: g,
  language,
  guided,
  onPlan,
  onHistory,
}: {
  game: GameView;
  language: string;
  guided: boolean;
  onPlan(): void;
  onHistory(): void;
}) {
  const say = (ru: string, en: string) => (language === "en" ? en : ru);
  const tasks = [
    say(
      "Объедините воду и инструмент, чтобы восстановить колодец.",
      "Combine water and a tool to restore the well.",
    ),
    say(
      "Почините мост или потратьте воду на обход.",
      "Repair the bridge or spend water on a detour.",
    ),
    say(
      "Вложите воду и инструмент — получите груз для города.",
      "Invest water and a tool to earn cargo for the city.",
    ),
    say(
      "Распределите охрану: неприкрытый караван теряет груз.",
      "Assign guards: an unprotected caravan loses cargo.",
    ),
    say(
      "Постройте укрытие и пополните воду.",
      "Build shelter and replenish water.",
    ),
    say(
      "Решите, кто доставит груз, а кто прикроет караван.",
      "Decide who delivers cargo and who guards the caravan.",
    ),
  ];
  return (
    <aside data-guide="objective" className="v2-goal hud-objective">
      <div className="hud-encounter-step">
        <span>
          {say("Встреча", "Encounter")} {g.stage + 1} / 6
        </span>
        <div aria-hidden="true">
          {Array.from({ length: 6 }, (_, i) => (
            <i key={i} className={i <= g.stage ? "is-passed" : ""} />
          ))}
        </div>
      </div>
      <h1>{words(language, encounterNames[g.stage])}</h1>
      <p className="hud-task">{tasks[g.stage]}</p>
      <button className="hud-plan-button" onClick={onPlan}>
        {say("Выбрать действие", "Choose an action")}
        <ArrowRight size={18} aria-hidden="true" />
      </button>
      {g.history.at(-1) && (
        <OutcomeCard
          game={g}
          receipt={g.history.at(-1)!}
          language={language}
          open={guided}
          onHistory={onHistory}
        />
      )}
    </aside>
  );
}
