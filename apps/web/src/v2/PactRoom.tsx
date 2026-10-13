import type { ReactNode } from "react";
import {
  Bot,
  ChevronRight,
  Droplets,
  Handshake,
  MessageCircle,
  Package,
  Wrench,
  Clock,
} from "lucide-react";
import type { GameView } from "./model";
import { stageContent, words } from "./content";
export default function PactRoom({
  game: g,
  language,
  partner,
  onPartner,
  onTalk,
  onPlan,
  busy = false,
  children,
}: {
  game: GameView;
  language: string;
  partner: number;
  onPartner(seat: number): void;
  onTalk?: () => void;
  onPlan?: () => void;
  busy?: boolean;
  children: ReactNode;
}) {
  const say = (ru: string, en: string) => (language === "en" ? en : ru),
    content = stageContent(g),
    accepted = g.offers.find(
      (p) => p.status === "accepted" && [p.maker, p.taker].includes(g.seat),
    );
  return (
    <div className="play-pact-room">
      <div className="play-situation">
        <Handshake size={23} />
        <div>
          <b>{say("Зачем искать партнёра", "Why find a partner")}</b>
          <p>{words(language, content.need)}</p>
        </div>
        <span>
          {accepted
            ? say("Твой пакт уже принят", "Your pact is accepted")
            : say("1 пакт на эту встречу", "1 pact this encounter")}
        </span>
        {g.network !== "practice" && (
          <div
            className={`pact-phase${g.phase !== 1 || g.seconds <= 0 ? " is-expired" : ""}`}
            role="status"
            aria-live="off"
          >
            <Clock size={16} />
            {g.phase === 1 && g.seconds > 0
              ? say(
                  `Обсуждение · ${Math.floor(g.seconds / 60)}:${String(g.seconds % 60).padStart(2, "0")}`,
                  `Planning · ${Math.floor(g.seconds / 60)}:${String(g.seconds % 60).padStart(2, "0")}`,
                )
              : say("Обсуждение завершено", "Planning has ended")}
          </div>
        )}
      </div>
      {(g.phase !== 1 || (g.network !== "practice" && g.seconds <= 0)) && (
        <div className="dp-alert" role="status">
          <p>
            {say(
              "Новые договоры сейчас недоступны. Перейди к своему ходу, чтобы проверить фиксацию и раскрытие.",
              "New pacts are unavailable now. Open your move to review commitment and reveal.",
            )}
          </p>
          {onPlan && (
            <button disabled={busy} onClick={onPlan}>
              {say("Перейти к ходу", "Open my move")}
              <ChevronRight size={18} />
            </button>
          )}
        </div>
      )}
      <div className="play-pact-layout">
        <aside className="play-partners">
          <span className="dp-kicker">
            {say("Выбери партнёра", "Choose a partner")}
          </span>
          <nav aria-label={say("Партнёры", "Partners")}>
            {g.seats.map((s, i) => {
              if (i === g.seat) return null;
              const offers = g.offers.filter(
                (p) =>
                  p.status === "open" && p.maker === i && p.taker === g.seat,
              ).length;
              return (
                <button
                  key={s.owner || i}
                  aria-pressed={partner === i}
                  onClick={() => onPartner(i)}
                  disabled={busy}
                >
                  <span className="play-avatar">
                    {s.npc ? <Bot size={23} /> : <Handshake size={23} />}
                  </span>
                  <span>
                    <b>{s.name}</b>
                    <small>
                      {offers
                        ? say("Есть предложение", "Offer available")
                        : s.npc
                          ? say("Игровой агент", "Game agent")
                          : say("Игрок", "Player")}
                    </small>
                    <span className="play-peer-stock">
                      <span className="play-stock-chip">
                        <Droplets size={14} />
                        <b>{s.resources[0]}</b>
                        <small>{say("вода", "water")}</small>
                      </span>
                      <span className="play-stock-chip">
                        <Wrench size={14} />
                        <b>{s.resources[1]}</b>
                        <small>{say("инстр.", "tools")}</small>
                      </span>
                      <span className="play-stock-chip">
                        <Package size={14} />
                        <b>{s.resources[2]}</b>
                        <small>{say("груз", "cargo")}</small>
                      </span>
                    </span>
                  </span>
                  <ChevronRight size={17} />
                </button>
              );
            })}
          </nav>
          <p>
            {say(
              "Цифры — все запасы спутника. Точный доступный вклад виден в условиях договора.",
              "Numbers show total supplies. The exact available contribution appears in the pact terms.",
            )}
          </p>
          {onTalk && (
            <button className="play-talk-link" onClick={onTalk} disabled={busy}>
              <MessageCircle size={18} />
              {say("Обсудить без договора", "Discuss without a pact")}
            </button>
          )}
        </aside>
        <div className="play-pact-content">{children}</div>
      </div>
    </div>
  );
}
