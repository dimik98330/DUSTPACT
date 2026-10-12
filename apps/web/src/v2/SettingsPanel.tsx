import { useState } from "react";
import {
  BookOpen,
  Compass,
  History,
  Keyboard,
  MessageCircle,
  RefreshCw,
  Users,
  Wallet,
  ArrowRight,
  LogOut,
} from "lucide-react";
import { LanguageToggle } from "../../../../packages/ui/src/i18n";
import type { GameView } from "./model";
import { encounterNames, words } from "./content";
import { OperationNotice } from "./PanelParts";
import HelpHandbook from "./HelpHandbook";
import InvitePanel from "./InvitePanel";
export default function SettingsPanel({
  game: g,
  language,
  invite,
  spectator,
  hasCommunity,
  busy,
  unknown,
  message,
  transaction,
  onRefresh,
  onChat,
  onHistory,
  onWallet,
  onExit,
  onCity,
  onPacts,
}: {
  game: GameView;
  language: string;
  invite: string | null;
  spectator: string | null;
  hasCommunity: boolean;
  busy: string;
  unknown: boolean;
  message: string;
  transaction: string;
  onRefresh(): void;
  onChat(): void;
  onHistory(): void;
  onWallet(): void;
  onExit(): void;
  onCity(): void;
  onPacts(): void;
}) {
  const say = (ru: string, en: string) => (language === "en" ? en : ru),
    [section, setSection] = useState<"general" | "invite" | "help">("general");
  const entries = [
    {
      id: "general" as const,
      icon: Compass,
      label: say("Экспедиция", "Expedition"),
      hint: say("Управление и язык", "Controls and language"),
    },
    ...(invite || spectator
      ? [
          {
            id: "invite" as const,
            icon: Users,
            label: say("Приглашения", "Invitations"),
            hint: say("Участники и зрители", "Players and spectators"),
          },
        ]
      : []),
    {
      id: "help" as const,
      icon: BookOpen,
      label: say("Как играть", "How to play"),
      hint: say("Цель, пакты и ходы", "Goals, pacts and moves"),
    },
  ];
  return (
    <div className="dp-settings dp-settings-workspace">
      <div className="sw-status-strip">
        <Compass size={18} />
        <b>
          {g.phase === 0
            ? say("Сбор каравана", "Gathering the caravan")
            : g.phase >= 5
              ? say("Экспедиция завершена", "Expedition ended")
              : say(
                  "Встреча " + (g.stage + 1) + " из 6",
                  "Encounter " + (g.stage + 1) + " of 6",
                )}
        </b>
        <span>
          {g.phase === 0
            ? say(g.count + " участников", g.count + " players")
            : words(language, encounterNames[g.stage])}
        </span>
        <small>
          {g.network === "practice"
            ? say("Обучение", "Learning")
            : g.network === "local"
              ? say("Локальная партия", "Local game")
              : "Solana Devnet"}
        </small>
      </div>
      <OperationNotice
        busy={busy}
        unknown={unknown}
        message={message}
        transaction={transaction}
        onRefresh={onRefresh}
        language={language}
      />
      <div className="sw-layout">
        <aside className="sw-sidebar">
          <span className="dp-kicker">DUSTPACT</span>
          <nav aria-label={say("Меню экспедиции", "Expedition menu")}>
            {entries.map((item) => (
              <button
                key={item.id}
                aria-current={section === item.id ? "page" : undefined}
                onClick={() => setSection(item.id)}
              >
                <item.icon size={21} />
                <span>
                  <b>{item.label}</b>
                  <small>{item.hint}</small>
                </span>
              </button>
            ))}
          </nav>
          <button className="sw-exit" onClick={onExit}>
            <LogOut size={18} />
            {say("К выбору игры", "Game selection")}
          </button>
        </aside>
        <div className="sw-content">
          <div className="dp-settings-grid">
            {section === "general" && (
              <>
                <section className="dp-card">
                  <div className="dp-card-heading">
                    <Compass />
                    <h3>{say("Экспедиция", "Expedition")}</h3>
                  </div>
                  <div className="dp-menu-list">
                    <button disabled={!!busy} onClick={onRefresh}>
                      <RefreshCw />
                      <span>
                        <b>{say("Обновить состояние", "Refresh state")}</b>
                        <small>
                          {say(
                            "Сверить ход и отправленные действия",
                            "Reconcile your move and submitted actions",
                          )}
                        </small>
                      </span>
                      <ArrowRight />
                    </button>
                    <button onClick={onHistory}>
                      <History />
                      <span>
                        <b>{say("История встреч", "Encounter history")}</b>
                        <small>
                          {say(
                            "Решения, ресурсы и исполненные договоры",
                            "Decisions, resources and executed pacts",
                          )}
                        </small>
                      </span>
                      <ArrowRight />
                    </button>
                    <button onClick={onWallet}>
                      <Wallet />
                      <span>
                        <b>
                          {say(
                            "Кошелёк и разрешения",
                            "Wallet and permissions",
                          )}
                        </b>
                        <small>
                          {say(
                            "Подписи, TEST-выплаты и восстановление",
                            "Signing, TEST payouts and recovery",
                          )}
                        </small>
                      </span>
                      <ArrowRight />
                    </button>
                    {hasCommunity && (
                      <button onClick={onChat}>
                        <MessageCircle />
                        <span>
                          <b>{say("Обсудить план", "Discuss your plan")}</b>
                          <small>
                            {say(
                              "Переговоры с участниками без заключения пакта",
                              "Talk to players without sealing a pact",
                            )}
                          </small>
                        </span>
                        <ArrowRight />
                      </button>
                    )}
                  </div>
                </section>
                <section className="dp-card">
                  <div className="dp-card-heading">
                    <Keyboard />
                    <h3>{say("Управление и язык", "Controls and language")}</h3>
                  </div>
                  <div className="dp-control-guide">
                    <div>
                      <kbd>W A S D</kbd>
                      <span>
                        {say(
                          "Ходить · можно стрелками",
                          "Walk · arrows also work",
                        )}
                      </span>
                    </div>
                    <div>
                      <kbd>{say("Мышь", "Mouse")}</kbd>
                      <span>
                        {say(
                          "Перетаскивай, чтобы вращать камеру",
                          "Drag to orbit the camera",
                        )}
                      </span>
                    </div>
                    <div>
                      <kbd>E</kbd>
                      <span>
                        {say(
                          "Взаимодействовать с объектом рядом",
                          "Interact with a nearby object",
                        )}
                      </span>
                    </div>
                  </div>
                  <p className="dp-caption">
                    {say(
                      "На телефоне вращай камеру пальцем. Все действия доступны и кнопками интерфейса.",
                      "On mobile, drag to orbit. Every action is also available through interface buttons.",
                    )}
                  </p>
                  <div className="dp-language-setting">
                    <span>{say("Язык интерфейса", "Interface language")}</span>
                    <LanguageToggle />
                  </div>
                </section>
              </>
            )}
            {section === "invite" && (
              <InvitePanel
                game={g}
                language={language}
                invite={invite}
                spectator={spectator}
              />
            )}
            {section === "help" && (
              <HelpHandbook
                game={g}
                language={language}
                onPacts={onPacts}
                onCity={onCity}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
