import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type CSSProperties,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Bot,
  Check,
  CheckCircle2,
  Clipboard,
  Compass,
  Droplets,
  LoaderCircle,
  LockKeyhole,
  MessageCircle,
  Package,
  RefreshCw,
  Settings2,
  ExternalLink,
  UserPlus,
  UserRound,
  Wallet,
  Wrench,
  Zap,
} from "lucide-react";
import { LanguageToggle, useI18n } from "../../../../packages/ui/src/i18n";
import { EntryHelp, HelpDialog } from "./ExpeditionEntry";
import type { GameView } from "./model";
import { lobbyState } from "./lobby-state";
import { GAME_PROGRAM, explorerAccountUrl } from "./solana-links";
export default function CaravanLobby({
  game: g,
  preview,
  invite,
  busy,
  unknown,
  notice,
  transactionText,
  ownerAvailable,
  onReady,
  onStart,
  onSession,
  onWallet,
  onChat,
  onRefresh,
  onExit,
}: {
  game: GameView;
  preview: ReactNode;
  invite: string | null;
  busy: string;
  unknown: boolean;
  notice: string;
  transactionText: string;
  ownerAvailable: boolean;
  onReady(): void;
  onStart(): void;
  onSession(): void;
  onWallet(): void;
  onChat?: () => void;
  onRefresh(): void;
  onExit(): void;
}) {
  const { language } = useI18n(),
    say = (ru: string, en: string) => (language === "en" ? en : ru);
  const state = lobbyState(g),
    [overlay, setOverlay] = useState<"invite" | "session" | "rules" | null>(
      null,
    ),
    [copied, setCopied] = useState(false),
    [copyError, setCopyError] = useState("");
  const host = useRef<HTMLDivElement>(null),
    copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(copyTimer.current), []);
  useEffect(() => {
    if (!overlay) return;
    const nodes = [...host.current!.children].filter(
      (el): el is HTMLElement =>
        el instanceof HTMLElement &&
        !el.classList.contains("lobby-overlay-scope"),
    );
    const prior = nodes.map((n) => n.inert);
    nodes.forEach((n) => {
      n.inert = true;
    });
    return () =>
      nodes.forEach((n, i) => {
        n.inert = prior[i];
      });
  }, [overlay]);
  async function copyInvite() {
    if (!invite) return;
    try {
      await navigator.clipboard.writeText(invite);
      setCopied(true);
      setCopyError("");
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopyError(
        say(
          "Выдели ссылку и скопируй её вручную.",
          "Select the link and copy it manually.",
        ),
      );
      setOverlay("invite");
    }
  }
  const heading = state.missing
    ? say("Собери свой караван", "Gather your caravan")
    : say("Караван собран", "Your caravan is assembled");
  const next =
    state.action === "invite"
      ? say(
          `Нужно ещё ${state.missing} участника`,
          `Invite ${state.missing} more players`,
        )
      : state.action === "ready"
        ? say("Подтверди состав", "Approve your caravan")
        : state.action === "start"
          ? say("Все готовы. Можно в путь.", "Everyone is ready. Time to go.")
          : state.action === "wait-host"
            ? say("Ждём старта хозяина", "Waiting for the host")
            : state.action === "wait-ready"
              ? say(
                  "Ждём остальных участников",
                  "Waiting for the other players",
                )
              : say("Сверяем состояние комнаты", "Checking room state");
  const label =
    state.action === "invite"
      ? copied
        ? say("Ссылка скопирована", "Link copied")
        : say("Копировать приглашение", "Copy invitation")
      : state.action === "ready"
        ? say("Я готов к экспедиции", "I’m ready")
        : state.action === "start"
          ? say("Начать экспедицию", "Start expedition")
          : state.action === "wait-host"
            ? say("Хозяин запускает игру", "The host starts the game")
            : state.action === "wait-ready"
              ? say(
                  `Готовы ${state.readyCount} из ${g.count}`,
                  `${state.readyCount} of ${g.count} ready`,
                )
              : say("Обновить состояние", "Refresh state");
  const disabled =
    !!busy ||
    unknown ||
    state.action === "wait-host" ||
    state.action === "wait-ready" ||
    (state.action === "invite" && !invite);
  const status =
    busy || unknown
      ? busy ||
        say(
          "Отправка пока не подтверждена",
          "Submission has not been confirmed",
        )
      : notice &&
          !notice.startsWith(say("Состояние обновлено", "State updated"))
        ? notice
        : "";
  function primary() {
    if (disabled) return;
    if (state.action === "invite") void copyInvite();
    else if (state.action === "ready") onReady();
    else if (state.action === "start") onStart();
    else if (state.action === "sync") onRefresh();
  }
  return (
    <div className="caravan-lobby" ref={host}>
      <header className="lobby-header">
        <button
          type="button"
          className="lobby-button lobby-back"
          onClick={onExit}
        >
          <ArrowLeft size={19} />
          {say("Назад", "Back")}
        </button>
        <a
          className="lobby-wordmark"
          href="?version=3"
          onClick={(e) => {
            e.preventDefault();
            onExit();
          }}
        >
          <Compass size={25} />
          DUSTPACT
        </a>
        <div className="lobby-header-tools">
          <button
            className="lobby-button lobby-ghost"
            onClick={() => setOverlay("rules")}
          >
            <BookOpen size={18} />
            {say("Правила", "Rules")}
          </button>
          <button
            className="lobby-button lobby-ghost"
            onClick={() => setOverlay("session")}
          >
            <Settings2 size={18} />
            {say("Подписи", "Signing")}
          </button>
          <button
            className="lobby-button lobby-icon"
            aria-label={say("Кошелёк и миссии", "Wallet and missions")}
            onClick={onWallet}
          >
            <Wallet size={20} />
          </button>
          <LanguageToggle />
        </div>
      </header>
      <main className="lobby-content">
        <div className="lobby-heading">
          <div>
            <span className="lobby-eyebrow">
              {say("Перед дорогой", "Before departure")}
            </span>
            <h1>{heading}</h1>
            <p>
              {state.soloWithAgents
                ? say(
                    "Спутники уже здесь. Осталось подтвердить готовность.",
                    "Your companions are here. Confirm that you are ready.",
                  )
                : state.missing
                  ? say(
                      "Пригласи друзей. В путь отправляются от 4 до 6 участников.",
                      "Invite friends. An expedition takes 4–6 players.",
                    )
                  : say(
                      "Проверь состав. Когда все готовы, хозяин запускает экспедицию.",
                      "Review the roster. The host starts once everyone is ready.",
                    )}
            </p>
          </div>
          <span className="lobby-room-label">
            <Compass size={17} />
            {g.network === "local"
              ? say("Локальная партия", "Local party")
              : "Solana Devnet"}
          </span>
        </div>
        <div className="lobby-layout">
          <section
            className="lobby-team"
            aria-label={say("Состав каравана", "Caravan roster")}
          >
            <div className="lobby-section-title">
              <h2>{say("Твои спутники", "Your companions")}</h2>
              <span>
                <CheckCircle2 size={17} />
                {state.readyCount}/{state.target} {say("готовы", "ready")}
              </span>
            </div>
            <div className="lobby-roster-grid">
              {Array.from({ length: state.target }, (_, i) => {
                const seat = g.seats[i];
                return seat ? (
                  <article
                    className={`lobby-player ${i === g.seat ? "lobby-player-me" : ""}`}
                    style={{ "--join-order": i } as CSSProperties}
                    key={seat.owner}
                  >
                    <div className="lobby-player-top">
                      <span className={`lobby-avatar lobby-avatar-${i % 3}`}>
                        {seat.npc ? <Bot size={28} /> : <UserRound size={28} />}
                      </span>
                      <div>
                        <h3>{seat.name}</h3>
                        <span>
                          {i === g.seat
                            ? say("Это ты", "You")
                            : seat.npc
                              ? say("Контрактный агент", "Contract agent")
                              : say("Игрок", "Player")}
                        </span>
                      </div>
                      <span
                        className={`lobby-ready ${seat.ready ? "is-ready" : ""}`}
                        aria-label={
                          seat.ready
                            ? say("Готов", "Ready")
                            : say("Не готов", "Not ready")
                        }
                      >
                        {seat.ready ? (
                          <Check size={15} />
                        ) : (
                          <span className="lobby-ready-dot" />
                        )}
                        {seat.ready
                          ? say("Готов", "Ready")
                          : say("Ожидает", "Waiting")}
                      </span>
                    </div>
                    <div
                      className="lobby-supplies"
                      aria-label={say("Стартовые запасы", "Starting supplies")}
                    >
                      {[Droplets, Wrench, Package].map((Icon, j) => (
                        <div key={j}>
                          <Icon size={19} />
                          <b>{seat.resources[j]}</b>
                          <span>
                            {j === 0
                              ? say("вода", "water")
                              : j === 1
                                ? say("инструменты", "tools")
                                : say("груз", "cargo")}
                          </span>
                        </div>
                      ))}
                    </div>
                  </article>
                ) : (
                  <div className="lobby-empty-seat" key={`empty-${i}`}>
                    <span className="lobby-empty-avatar">
                      <UserPlus size={25} />
                    </span>
                    <div>
                      <strong>{say(`Место ${i + 1}`, `Seat ${i + 1}`)}</strong>
                      <span>
                        {say("Ожидаем участника", "Waiting for a player")}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
            {!state.soloWithAgents && invite && (
              <div className="lobby-invite-line">
                <span>
                  <UserPlus size={19} />
                  {say("Приглашение в комнату", "Room invitation")}
                </span>
                <input
                  aria-label={say("Ссылка приглашения", "Invitation link")}
                  value={invite}
                  readOnly
                  onFocus={(e) => e.currentTarget.select()}
                />
                {!state.missing && (
                  <button
                    className="lobby-button lobby-small-button"
                    onClick={() => void copyInvite()}
                  >
                    {copied ? <Check size={18} /> : <Clipboard size={18} />}
                    <span>
                      {copied
                        ? say("Скопировано", "Copied")
                        : say("Копировать", "Copy")}
                    </span>
                  </button>
                )}
              </div>
            )}
            <div className="lobby-team-actions">
              {state.soloWithAgents && invite && (
                <button
                  className="lobby-button lobby-ghost"
                  onClick={() => setOverlay("invite")}
                >
                  <UserPlus size={18} />
                  {say("Пригласить друга", "Invite a friend")}
                </button>
              )}
              {onChat && (
                <button className="lobby-button lobby-ghost" onClick={onChat}>
                  <MessageCircle size={18} />
                  {say("Обсудить план", "Discuss the plan")}
                </button>
              )}
              {copied && (
                <span className="lobby-copy-feedback" role="status">
                  {say("Ссылка скопирована", "Link copied")}
                </span>
              )}
            </div>
          </section>
          <aside className="lobby-departure">
            <div className="caravan-world">
              {preview}
              <span className="lobby-scene-caption">
                <Compass size={16} />
                {say("Первая встреча · Колодец", "First encounter · The well")}
              </span>
            </div>
            <section className="lobby-launch-card">
              <span className="lobby-eyebrow">
                {say("Следующий шаг", "Next step")}
              </span>
              <h2>{next}</h2>
              {state.action === "ready" && (
                <p>
                  {say(
                    "Это согласие с составом каравана и правилами игры.",
                    "This approves the caravan roster and game rules.",
                  )}
                </p>
              )}
              {state.action === "start" && (
                <p>
                  {say(
                    "Впереди колодец, мост и добыча груза для города.",
                    "The well, bridge and cargo for the city await.",
                  )}
                </p>
              )}
              <button
                className="lobby-button lobby-primary"
                disabled={disabled}
                onClick={primary}
              >
                {busy ? (
                  <LoaderCircle className="lobby-spin" size={21} />
                ) : state.action === "invite" ? (
                  copied ? (
                    <Check size={21} />
                  ) : (
                    <Clipboard size={21} />
                  )
                ) : state.action === "ready" ? (
                  <CheckCircle2 size={21} />
                ) : (
                  <Compass size={21} />
                )}
                <span>
                  {busy ? say("Подтверждаем…", "Confirming…") : label}
                </span>
                {!busy && <ArrowRight size={21} />}
              </button>
              {g.sessionActive && !g.sessionPaused && (
                <span className="lobby-session-active">
                  <Zap size={15} />
                  {say(
                    "Автоотправка одобренных ходов включена",
                    "Approved-move auto-send is enabled",
                  )}
                </span>
              )}
              {g.vault?.active && (
                <button className="lobby-button lobby-ghost" onClick={onWallet}>
                  <Wallet size={16} />
                  {say("TEST-миссия активна", "TEST mission is active")}
                </button>
              )}
              {(status || unknown) && (
                <div className="lobby-operation" role="status">
                  <span>{status}</span>
                  {busy && transactionText && <small>{transactionText}</small>}
                  {unknown && (
                    <button
                      className="lobby-button lobby-small-button"
                      disabled={!!busy}
                      onClick={onRefresh}
                    >
                      <RefreshCw size={17} />
                      {say("Проверить состояние", "Check state")}
                    </button>
                  )}
                </div>
              )}
            </section>
            {g.network !== "practice" && (
              <section className="lobby-chain-card">
                <span className="lobby-eyebrow">
                  {say(
                    "Проверка без доверия серверу",
                    "Verify without trusting the server",
                  )}
                </span>
                <h3>
                  {say(
                    "Матч уже записан в Solana",
                    "This match already lives on Solana",
                  )}
                </h3>
                <p>
                  {say(
                    "Программа фиксирует состав, готовность и результат каждой встречи. Любой может сверить матч и адрес программы в Explorer.",
                    "The program records the roster, readiness and every encounter result. Anyone can verify the match and the program address in Explorer.",
                  )}
                </p>
                <code title={g.match}>{g.match}</code>
                <div className="lobby-chain-links">
                  <a
                    href={explorerAccountUrl(g.match, g.network) ?? "#"}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ExternalLink size={15} />
                    {say("Матч в Explorer", "Match in Explorer")}
                  </a>
                  <a
                    href={
                      explorerAccountUrl(
                        GAME_PROGRAM[g.version],
                        g.network,
                      ) ?? "#"
                    }
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ExternalLink size={15} />
                    {say("Программа игры", "Game program")}
                  </a>
                </div>
              </section>
            )}
          </aside>
        </div>
      </main>
      {overlay && (
        <div className="v3-entry lobby-overlay-scope">
          <div
            className="entry-help-backdrop"
            onClick={(e) => {
              if (e.target === e.currentTarget) setOverlay(null);
            }}
          >
            {overlay === "rules" ? (
              <EntryHelp
                kind="rules"
                language={language}
                close={() => setOverlay(null)}
                onLearn={() =>
                  location.assign("?version=3&mode=practice&tutorial=1")
                }
              />
            ) : (
              <HelpDialog
                close={() => setOverlay(null)}
                title={
                  overlay === "invite"
                    ? say("Пригласи друга", "Invite a friend")
                    : say("Как подписывать ходы", "How to sign moves")
                }
              >
                {overlay === "invite" ? (
                  <div className="lobby-share-dialog">
                    <label>
                      {say("Ссылка на эту комнату", "This room’s link")}
                      <input
                        value={invite ?? ""}
                        readOnly
                        onFocus={(e) => e.currentTarget.select()}
                      />
                    </label>
                    <button
                      className="entry-primary"
                      onClick={() => void copyInvite()}
                    >
                      {copied ? <Check size={20} /> : <Clipboard size={20} />}{" "}
                      {copied
                        ? say("Скопировано", "Copied")
                        : say("Копировать ссылку", "Copy link")}
                    </button>
                    {copyError && <p role="status">{copyError}</p>}
                  </div>
                ) : (
                  <div className="lobby-signing-dialog">
                    <div className="lobby-signing-option">
                      <UserRound size={26} />
                      <div>
                        <h3>{say("Вручную", "Manually")}</h3>
                        <p>
                          {say(
                            "Каждое закрепление и раскрытие подписываешь сам.",
                            "Sign each commitment and reveal yourself.",
                          )}
                        </p>
                      </div>
                    </div>
                    <div className="lobby-signing-option">
                      <Zap size={27} />
                      <div>
                        <h3>{say("Ограниченная сессия", "Bounded session")}</h3>
                        <p>
                          {say(
                            "Отправляет только тот ход, который ты выбрал и одобрил.",
                            "Sends only the exact move you selected and approved.",
                          )}
                        </p>
                        <span className="lobby-session-limits">
                          {say(
                            "2 часа · до 128 действий",
                            "2 hours · up to 128 actions",
                          )}
                        </span>
                      </div>
                    </div>
                    <p className="lobby-signing-note">
                      <LockKeyhole size={18} />
                      {say(
                        "Без доступа к токенам кошелька.",
                        "No access to wallet tokens.",
                      )}
                    </p>
                    <button
                      className="entry-primary"
                      disabled={
                        !!busy ||
                        unknown ||
                        g.sessionActive ||
                        !ownerAvailable ||
                        g.network !== "local"
                      }
                      onClick={onSession}
                    >
                      {busy ? (
                        <LoaderCircle className="lobby-spin" size={20} />
                      ) : (
                        <Zap size={20} />
                      )}{" "}
                      {g.sessionPaused
                        ? say("Отзыв сессии проверяется", "Checking revocation")
                        : g.sessionActive
                          ? say("Сессия включена", "Session enabled")
                          : say("Разрешить сессию", "Authorize session")}
                    </button>
                    {g.network !== "local" && (
                      <p className="lobby-signing-note">
                        {say(
                          "В этой сети подписи пока вручную. Автоотправка доступна в локальной партии.",
                          "Sign manually on this network. Automatic submission is available in local games.",
                        )}
                      </p>
                    )}
                    {status && <p role="status">{status}</p>}
                    {unknown && (
                      <button
                        className="lobby-button lobby-ghost"
                        disabled={!!busy}
                        onClick={onRefresh}
                      >
                        <RefreshCw size={17} />
                        {say("Проверить состояние", "Check state")}
                      </button>
                    )}
                    {!ownerAvailable && (
                      <p>
                        {say(
                          "Для разрешения нужен профиль владельца.",
                          "The owner’s profile is required to authorize.",
                        )}
                      </p>
                    )}
                    <button
                      className="lobby-button lobby-ghost"
                      onClick={() => {
                        setOverlay(null);
                        setTimeout(onWallet, 0);
                      }}
                    >
                      <Wallet size={18} />
                      {say(
                        "Кошелёк, отзыв сессии и TEST-миссии",
                        "Wallet, revoke session and TEST missions",
                      )}
                    </button>
                  </div>
                )}
              </HelpDialog>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
