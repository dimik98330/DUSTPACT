import { useState } from "react";
import {
  Users,
  Eye,
  Check,
  Link,
  UserRound,
  Monitor,
  Bot,
  LockKeyhole,
} from "lucide-react";
import type { GameView } from "./model";
import { CopyField } from "./PanelParts";
import { canInvitePlayer } from "./lobby-state";
export default function InvitePanel({
  game: g,
  language,
  invite,
  spectator,
}: {
  game: GameView;
  language: string;
  invite: string | null;
  spectator: string | null;
}) {
  const canJoin = canInvitePlayer(g);
  const say = (ru: string, en: string) => (language === "en" ? en : ru),
    [kind, setKind] = useState<"friends" | "watch">(
      canJoin && invite ? "friends" : "watch",
    ),
    watch = kind === "watch",
    url = (watch ? spectator : invite) ?? "",
    isLocal = url
      ? ["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname)
      : false,
    remaining = Math.max(0, 6 - g.count);
  return (
    <section className="iv-layout">
      <div className="iv-main">
        <span className="dp-kicker">
          {say("Пригласить в экспедицию", "Invite to the expedition")}
        </span>
        <h3>{say("Играть или наблюдать?", "Play or watch?")}</h3>
        <p>
          {say(
            "Это разные ссылки. Выбери, какую отправить другу.",
            "These are different links. Choose which one to share.",
          )}
        </p>
        <div
          className="iv-link-types"
          role="group"
          aria-label={say("Кого пригласить", "Who to invite")}
        >
          {invite && (
            <button aria-pressed={!watch} onClick={() => setKind("friends")}>
              <Users size={24} />
              <span>
                <b>{say("Участник", "Player")}</b>
                <small>
                  {canJoin
                    ? say(
                        "Своё место, запасы и решения",
                        "Their own seat, supplies and decisions",
                      )
                    : say(
                        "Вернуться на уже занятое место",
                        "Return to an existing seat",
                      )}
                </small>
              </span>
              {!watch && <Check size={19} />}
            </button>
          )}
          {spectator && (
            <button aria-pressed={watch} onClick={() => setKind("watch")}>
              <Eye size={24} />
              <span>
                <b>{say("Зритель", "Spectator")}</b>
                <small>
                  {say(
                    "Смотреть без места и кошелька",
                    "Watch without a seat or wallet",
                  )}
                </small>
              </span>
              {watch && <Check size={19} />}
            </button>
          )}
        </div>
        <div className="iv-share-box">
          <div>
            <Link size={19} />
            <b>
              {watch
                ? say("Ссылка для наблюдения", "Spectator link")
                : say("Ссылка участнику", "Player link")}
            </b>
          </div>
          <CopyField
            key={kind}
            value={url}
            label={say(
              "Скопируй и отправь другу",
              "Copy and share with your friend",
            )}
            language={language}
            href={watch ? url : undefined}
          />
          <p>
            {watch
              ? say(
                  "Ссылка не даёт права играть за участников или распоряжаться их запасами.",
                  "The link cannot play for participants or control their supplies.",
                )
              : canJoin
                ? say(
                    "Каждый открывает её своим профилем и отдельно подтверждает готовность.",
                    "Each player opens it with their own profile and separately confirms readiness.",
                  )
                : say(
                    "Новых мест в этой комнате нет. Ссылка подходит уже вошедшим участникам.",
                    "No new seats are available in this room. This link is for existing participants.",
                  )}
          </p>
        </div>
        {isLocal && (
          <div className="iv-local-note">
            <Monitor size={20} />
            <div>
              <b>{say("Сейчас ссылка локальная", "This link is local")}</b>
              <p>
                {say(
                  "Работает на этом компьютере. Для друга на другом устройстве нужен общий доступный адрес игры.",
                  "It works on this computer. Friends on other devices need a shared, reachable game address.",
                )}
              </p>
            </div>
          </div>
        )}
      </div>
      <aside className="iv-guide">
        <div className="iv-guide-heading">
          <span className="iv-guide-icon">
            {watch ? <Eye size={28} /> : <Users size={28} />}
          </span>
          <div>
            <span className="dp-kicker">
              {say("После открытия ссылки", "After opening the link")}
            </span>
            <h4>
              {watch
                ? say("Друг станет зрителем", "Your friend becomes a spectator")
                : canJoin
                  ? say(
                      "Друг войдёт в караван",
                      "Your friend joins the caravan",
                    )
                  : say(
                      "Участник вернётся в матч",
                      "A player returns to the match",
                    )}
            </h4>
          </div>
        </div>
        <ol>
          {(watch
            ? [
                [
                  say("Открывает ссылку", "Open the link"),
                  say(
                    "Без подключения кошелька и занятия места.",
                    "No wallet or player seat required.",
                  ),
                ],
                [
                  say("Видит общее состояние", "See the shared state"),
                  say(
                    "Состав каравана и публичные результаты встреч.",
                    "The caravan roster and public encounter results.",
                  ),
                ],
                [
                  say("Следит за путешествием", "Follow the journey"),
                  say(
                    "Не выбирает ходы и не заключает пакты.",
                    "Cannot choose moves or accept pacts.",
                  ),
                ],
              ]
            : canJoin
              ? [
                  [
                    say("Открывает своим профилем", "Open with their profile"),
                    say(
                      "Получает свободное место и собственные запасы.",
                      "Take an open seat with their own supplies.",
                    ),
                  ],
                  [
                    say("Подтверждает состав", "Approve the roster"),
                    say(
                      "Каждый участник отдельно нажимает «Готов».",
                      "Each player separately presses Ready.",
                    ),
                  ],
                  [
                    say("Хозяин запускает путь", "The host starts the journey"),
                    say(
                      "Нужно 4–6 участников и готовность всего состава.",
                      "The roster needs 4–6 players, all ready.",
                    ),
                  ],
                ]
              : [
                  [
                    say(
                      "Открывает прежним профилем",
                      "Open with the original profile",
                    ),
                    say(
                      "Право на место проверяется по владельцу.",
                      "Seat access is checked against its owner.",
                    ),
                  ],
                  [
                    say("Получает текущее состояние", "Load the current state"),
                    say(
                      "Увидит встречу, свои запасы и договоры.",
                      "See the encounter, their supplies and pacts.",
                    ),
                  ],
                  [
                    say("Продолжает свой ход", "Continue their move"),
                    say(
                      "При неизвестной отправке сначала нужна сверка.",
                      "Reconcile any unknown submission outcome first.",
                    ),
                  ],
                ]
          ).map(([title, text], i) => (
            <li key={i}>
              <b>{i + 1}</b>
              <div>
                <h5>{title}</h5>
                <p>{text}</p>
              </div>
            </li>
          ))}
        </ol>
        <div className="iv-room">
          <header>
            <b>{say("Сейчас в караване", "Current caravan")}</b>
            <span>{g.count} / 6</span>
          </header>
          <div>
            {g.seats.map((s, i) => (
              <span
                className={s.npc ? "iv-agent" : "iv-human"}
                key={s.owner || i}
                title={s.name}
              >
                {s.npc ? <Bot size={20} /> : <UserRound size={20} />}
                <small>
                  {s.name}
                  {s.npc ? say(" · агент", " · agent") : ""}
                </small>
              </span>
            ))}
            {Array.from({ length: remaining }, (_, i) => (
              <span
                className="iv-empty-seat"
                key={`empty-${i}`}
                aria-label={
                  canJoin
                    ? say("Свободное место", "Open seat")
                    : say("Новым участникам закрыто", "Closed to new players")
                }
              >
                {canJoin ? <Users size={19} /> : <LockKeyhole size={19} />}
                <small>
                  {canJoin ? say("Место", "Open") : say("Закрыто", "Closed")}
                </small>
              </span>
            ))}
          </div>
          <p>
            {g.phase === 0
              ? g.count < 4
                ? say(
                    `Для старта нужно ещё ${4 - g.count} участника.`,
                    `Need ${4 - g.count} more players to start.`,
                  )
                : say(
                    "Минимальный состав собран. Осталось проверить готовность.",
                    "The minimum roster is assembled. Check everyone’s readiness.",
                  )
              : say(
                  "Экспедиция уже началась. Доступ новых участников закрыт.",
                  "The expedition has started. New seats are closed.",
                )}
          </p>
        </div>
      </aside>
    </section>
  );
}
