import {
  lazy,
  Suspense,
  useState,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import {
  ArrowRight,
  ArrowDown,
  BookOpen,
  Box,
  Check,
  ChevronDown,
  Compass,
  Gamepad2,
  Handshake,
  Hammer,
  Droplets,
  LockKeyhole,
  LoaderCircle,
  Route,
  ShieldCheck,
  Sparkles,
  Users,
  UserRound,
  Wallet,
  Wrench,
  X,
} from "lucide-react";
import { LanguageToggle, useI18n } from "../../../../packages/ui/src/i18n";
import "./entry.css";
const Preview = lazy(() => import("./Scene"));
export type EntryMode = "agents" | "friends" | "learn";
export default function ExpeditionEntry({
  mode,
  onMode,
  network,
  match,
  starting,
  status,
  error,
  onStart,
  onWallet,
  onOpenExisting,
  walletConnected,
  deploymentReady,
}: {
  mode: EntryMode;
  onMode(mode: EntryMode): void;
  network: "local" | "devnet";
  match?: string;
  starting: boolean;
  status: string;
  error: string;
  onStart(): void;
  onWallet(): void;
  onOpenExisting?(): void;
  walletConnected: boolean;
  deploymentReady: boolean;
}) {
  const { language } = useI18n(),
    say = (ru: string, en: string) => (language === "en" ? en : ru);
  const [help, setHelp] = useState<"rules" | "solana" | null>(null);
  const page = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!help) return;
    const nodes = [...page.current!.children].filter(
      (el): el is HTMLElement =>
        el instanceof HTMLElement &&
        !el.classList.contains("entry-help-backdrop"),
    );
    const previous = nodes.map((el) => el.inert);
    nodes.forEach((el) => {
      el.inert = true;
    });
    return () =>
      nodes.forEach((el, i) => {
        el.inert = previous[i];
      });
  }, [help]);
  const modes = [
    {
      id: "agents" as const,
      icon: Gamepad2,
      title: say("С агентами", "With agents"),
      detail: say("Ты + 3 спутника", "You + 3 companions"),
    },
    {
      id: "friends" as const,
      icon: Users,
      title: say("С друзьями", "With friends"),
      detail: say("4–6 игроков", "4–6 players"),
    },
    {
      id: "learn" as const,
      icon: BookOpen,
      title: say("Обучение", "Learn to play"),
      detail: say("Без кошелька", "No wallet"),
    },
  ].filter((m) => network === "local" || m.id !== "agents");
  const needsWallet =
    network === "devnet" && mode !== "learn" && !walletConnected;
  const unavailable =
    network === "devnet" && mode !== "learn" && !deploymentReady;
  const context = match
    ? say(
        "Откроем сохранённую экспедицию. Состав и условия проверятся в Solana.",
        "Open the retained expedition. Solana verifies its roster and terms.",
      )
    : mode === "learn"
      ? say(
          "Первая сделка с подсказками. Всё рассчитывается в браузере — без блокчейна.",
          "Your first deal, with guidance. Everything resolves in your browser, offchain.",
        )
      : mode === "friends"
        ? say(
            "Создай комнату и отправь ссылку друзьям. Начнёте, когда соберутся 4–6 участников.",
            "Create a room and invite friends with its link. Start when 4–6 players are ready.",
          )
        : say(
            "Играй один с тремя контрактными агентами. У каждого свои запасы и интересы.",
            "Play solo with three contract agents. Each has their own inventory and interests.",
          );
  const startLabel =
    mode === "learn"
      ? say("Пройти обучение", "Start the tutorial")
      : match
        ? say("Открыть этот матч", "Open this match")
        : mode === "friends"
          ? say("Создать комнату", "Create a room")
          : say("Начать экспедицию", "Start expedition");
  return (
    <div className="v3-entry" ref={page}>
      <header className="entry-header">
        <a className="entry-wordmark" href="?version=3" aria-label="DUSTPACT">
          <Compass aria-hidden="true" />
          <span>DUSTPACT</span>
        </a>
        <nav aria-label={say("Об игре", "About the game")}>
          <button type="button" onClick={() => setHelp("rules")}>
            {say("Как играть", "How to play")}
          </button>
          <button type="button" onClick={() => setHelp("solana")}>
            {say("Зачем Solana", "Why Solana")}
          </button>
        </nav>
        <LanguageToggle />
      </header>
      <main className="entry-main">
        <section className="entry-copy" aria-labelledby="entry-title">
          <div className="entry-kicker">
            <span className="entry-kicker-line" />
            {say(
              "Социальная стратегия · 3D-экспедиция",
              "Social strategy · 3D expedition",
            )}
          </div>
          <h1 id="entry-title">
            {say("Один караван.", "One caravan.")}
            <br />
            <em>{say("Разные интересы.", "Different interests.")}</em>
          </h1>
          <p className="entry-intro">
            {say(
              "Довезите груз до города. Добывайте ресурсы, торгуйтесь и решайте, кому доверить общее дело.",
              "Bring your cargo to the city. Gather supplies, negotiate, and decide who you can trust with the expedition.",
            )}
          </p>
          <div className="entry-facts">
            <span>
              <Users size={17} />
              {say("4–6 участников", "4–6 players")}
            </span>
            <span>
              <Route size={17} />
              {say("6 разных встреч", "6 distinct encounters")}
            </span>
            <span>
              <Box size={17} />
              {say("Общая цель · личный счёт", "Shared goal · personal score")}
            </span>
          </div>
          {match ? (
            <div className="entry-invitation">
              <Users size={22} />
              <div>
                <b>
                  {say("Тебя ждут в экспедиции", "An expedition is waiting")}
                </b>
                <code>
                  {match.slice(0, 8)}…{match.slice(-8)}
                </code>
              </div>
            </div>
          ) : (
            <fieldset className="entry-mode-field">
              <legend>
                {say("Как отправимся в путь?", "How will you travel?")}
              </legend>
              <div className="entry-modes">
                {modes.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    className="entry-mode"
                    aria-pressed={mode === m.id}
                    disabled={starting}
                    onClick={() => onMode(m.id)}
                  >
                    <span className="entry-mode-top">
                      <m.icon size={23} />
                      {mode === m.id && (
                        <Check size={18} className="entry-selected" />
                      )}
                    </span>
                    <b>{m.title}</b>
                    <span>{m.detail}</span>
                  </button>
                ))}
              </div>
            </fieldset>
          )}
          <p className="entry-context" id="entry-context">
            {context}
          </p>
          <div className="entry-launch">
            <button
              type="button"
              className="entry-primary"
              disabled={starting || needsWallet || unavailable}
              onClick={onStart}
              aria-describedby="entry-context entry-launch-state"
            >
              {starting ? (
                <>
                  <LoaderCircle className="entry-spin" size={23} />
                  {say("Готовим экспедицию…", "Preparing expedition…")}
                </>
              ) : (
                <>
                  {startLabel}
                  <ArrowRight size={23} />
                </>
              )}
            </button>
            {mode !== "learn" && !match && (
              <a
                className="entry-try"
                href="?version=3&mode=practice&tutorial=0"
              >
                {say("Попробовать без подписей", "Try without signing")}
                <ArrowRight size={17} />
              </a>
            )}
          </div>
          <div
            id="entry-launch-state"
            className="entry-launch-state"
            role="status"
            aria-live="polite"
          >
            {starting
              ? status ||
                say(
                  "Проверяем сеть и готовим игровые профили. Это может занять несколько подтверждений.",
                  "Checking the network and game profiles. This can take several confirmations.",
                )
              : unavailable
                ? say(
                    "Публичный Devnet ещё не настроен. Можно пройти обучение или открыть Localnet.",
                    "Public Devnet is not configured yet. Choose the tutorial or Localnet.",
                  )
                : needsWallet
                  ? say(
                      "Для Devnet подключи кошелёк ниже. Обучение доступно сразу.",
                      "Connect a wallet below for Devnet. The tutorial is available now.",
                    )
                  : null}
          </div>
          {error && (
            <div className="entry-error" role="alert">
              <b>
                {say(
                  "Не получилось открыть экспедицию",
                  "Could not open the expedition",
                )}
              </b>
              <p>{error}</p>
              <span>
                {say(
                  "Проверь подключение и попробуй ещё раз. Обучение работает без сервера.",
                  "Check your connection and retry. The tutorial works without a server.",
                )}
              </span>
              {onOpenExisting && (
                <button
                  type="button"
                  className="entry-wallet"
                  disabled={starting}
                  onClick={onOpenExisting}
                >
                  {say(
                    "Открыть комнату без дополнения спутников",
                    "Open the room without adding companions",
                  )}
                  <ArrowRight size={18} />
                </button>
              )}
            </div>
          )}
          {network === "devnet" && mode !== "learn" && deploymentReady && (
            <button
              type="button"
              className="entry-wallet"
              disabled={starting}
              onClick={onWallet}
            >
              <Wallet size={19} />
              {walletConnected
                ? say("Кошелёк подключён", "Wallet connected")
                : say("Подключить кошелёк", "Connect wallet")}
            </button>
          )}
          {network === "devnet" && (
            <a className="entry-local-link" href="?version=3&cluster=local">
              {say("Открыть локальную Solana", "Open local Solana")}
              <ArrowRight size={16} />
            </a>
          )}
        </section>
        <section
          className="entry-visual"
          aria-label={say("Мир экспедиции", "The expedition world")}
        >
          <div className="entry-visual-top">
            <span>
              <Sparkles size={16} />
              {say("Внутри DUSTPACT", "Inside DUSTPACT")}
            </span>
            <span>{say("Превью мира · 3D", "World preview · 3D")}</span>
          </div>
          <div className="entry-world">
            <img
              className="entry-art-fallback"
              src="/art/dustroad.png"
              alt=""
            />
            <Suspense fallback={null}>
              <Preview
                paused
                viewOnly
                onInteract={() => {}}
                onNearby={() => {}}
              />
            </Suspense>
            <span className="entry-world-tag">
              <Compass size={16} />
              {say("Колодец → мост → город", "Well → bridge → city")}
            </span>
          </div>
        </section>
      </main>
      {help && (
        <div
          className="entry-help-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setHelp(null);
          }}
        >
          <EntryHelp
            kind={help}
            language={language}
            close={() => setHelp(null)}
            onLearn={() =>
              location.assign("?version=3&mode=practice&tutorial=1")
            }
          />
        </div>
      )}
    </div>
  );
}
export function EntryHelp({
  kind,
  language,
  close,
  onLearn,
}: {
  kind: "rules" | "solana";
  language: string;
  close(): void;
  onLearn(): void;
}) {
  const say = (ru: string, en: string) => (language === "en" ? en : ru);
  const steps =
    kind === "rules"
      ? [
          {
            icon: Box,
            title: say("Собери ресурсы", "Gather supplies"),
            body: say(
              "Вода помогает выжить, инструменты — строить. Груз добудешь по пути.",
              "Water keeps you alive; tools let you build. Earn cargo along the way.",
            ),
          },
          {
            icon: Handshake,
            title: say("Договорись о помощи", "Agree on help"),
            body: say(
              "Обменяйся запасами или закрепи чужой вклад пактом.",
              "Swap supplies or bind a partner’s contribution with a pact.",
            ),
          },
          {
            icon: Route,
            title: say("Выбери свой ход", "Choose your action"),
            body: say(
              "Одно действие за встречу: добыча, ремонт, охрана или доставка.",
              "One action per encounter: gather, repair, guard or deliver.",
            ),
          },
        ]
      : [
          {
            icon: Handshake,
            title: say("Приняли условия", "Agree"),
            body: say(
              "Каждый подтвердил свой вклад и результат.",
              "Both confirm their inputs and output.",
            ),
          },
          {
            icon: LockKeyhole,
            title: say("Вклады в резерве", "Reserve"),
            body: say(
              "Эти ресурсы и работа уже заняты пактом.",
              "The pact locks those supplies and work.",
            ),
          },
          {
            icon: ShieldCheck,
            title: say("Работа закреплена", "Execute"),
            body: say(
              "Другой клиент может завершить исполнение.",
              "Another client can complete execution.",
            ),
          },
        ];
  return (
    <HelpDialog
      close={close}
      title={
        kind === "rules"
          ? say("Довези караван до города", "Bring the caravan to the city")
          : say("Пакт закрепляет помощь", "A pact binds cooperation")
      }
    >
      {kind === "rules" ? (
        <div className="help-objective">
          <span className="help-objective-icon">
            <Compass size={31} />
          </span>
          <div>
            <span>{say("Общая цель", "Shared goal")}</span>
            <strong>
              {say(
                "Караван доехал. Груз доставлен.",
                "Caravan alive. Cargo delivered.",
              )}
            </strong>
          </div>
          <span className="help-encounters">
            {say("6 встреч", "6 encounters")}
          </span>
        </div>
      ) : (
        <section
          className="help-example"
          aria-label={say("Пример пакта у колодца", "Example well pact")}
        >
          <div className="help-example-heading">
            <Droplets size={19} />
            <span>
              {say("Пример: восстановить колодец", "Example: restore the well")}
            </span>
          </div>
          <div className="help-parties">
            <div className="help-party">
              <span className="help-person">
                <UserRound size={20} />
                {say("Ты", "You")}
              </span>
              <div className="help-supply">
                <Droplets size={29} />
                <strong>2</strong>
                <span>{say("воды", "water")}</span>
              </div>
            </div>
            <span className="help-combine" aria-label={say("плюс", "plus")}>
              +
            </span>
            <div className="help-party">
              <span className="help-person">
                <UserRound size={20} />
                {say("Тимур", "Timur")}
              </span>
              <div className="help-supply">
                <Wrench size={27} />
                <strong>1</strong>
                <span>{say("инструмент", "tool")}</span>
              </div>
              <span className="help-work">
                <Hammer size={15} />
                {say("выполняет ремонт", "performs the repair")}
              </span>
            </div>
          </div>
          <div className="help-production">
            <ArrowDown size={20} />
            <div>
              <span>{say("Результат производства", "Production output")}</span>
              <strong>
                {say("4 воды тебе + 4 Тимуру", "4 water for you + 4 for Timur")}
              </strong>
            </div>
            <Droplets size={28} />
          </div>
        </section>
      )}
      <ol
        className={`help-step-list ${kind === "solana" ? "help-step-list-compact" : ""}`}
      >
        {steps.map((step, i) => (
          <li key={i}>
            <span className="help-step-icon">
              <step.icon size={24} />
              <small>{i + 1}</small>
            </span>
            <div>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </div>
          </li>
        ))}
      </ol>
      {kind === "rules" ? (
        <>
          <div className="help-city-choice">
            <span>
              {say("У городских ворот выбери одно", "At the city, choose one")}
            </span>
            <div>
              <span>
                <Box size={19} />
                {say("Доставить", "Deliver")}
              </span>
              <b aria-hidden="true">/</b>
              <span>
                <ShieldCheck size={19} />
                {say("Охранять", "Guard")}
              </span>
              <b aria-hidden="true">/</b>
              <span>
                <Hammer size={19} />
                {say("Заработать", "Earn")}
              </span>
            </div>
          </div>
          <div className="help-score">
            <span>
              {say("Личный счёт при прибытии", "Your score on arrival")}
            </span>
            <div>
              <span>
                <b>3 ×</b>
                <Box size={17} />
                {say("груз", "cargo")}
              </span>
              <b>+</b>
              <span>{say("доставка", "delivery")}</span>
              <b>+</b>
              <span>{say("вклад", "contribution")}</span>
            </div>
          </div>
          <p className="help-short-note">
            {say(
              "Караван не прибыл или ты пропустил ход — личный счёт 0.",
              "If the caravan fails or you miss a move, your personal score is 0.",
            )}
          </p>
          <button
            className="entry-primary help-learn-button"
            type="button"
            onClick={onLearn}
          >
            <BookOpen size={20} />
            {say("Пройти обучение", "Start the tutorial")}
            <ArrowRight size={21} />
          </button>
        </>
      ) : (
        <>
          <div className="help-guarantee">
            <ShieldCheck size={25} />
            <div>
              <strong>
                {say(
                  "Партнёр отключился? Работа остаётся.",
                  "Partner disconnected? The work remains.",
                )}
              </strong>
              <span>
                {say(
                  "Пакт закрепляет вклад, но не гарантирует победу каравана.",
                  "A pact binds a contribution, not a caravan victory.",
                )}
              </span>
            </div>
          </div>
          <details className="help-wallet-detail">
            <summary>
              <Wallet size={18} />
              {say("Что разрешает подпись?", "What does a signature allow?")}
              <ChevronDown size={17} />
            </summary>
            <p>
              {say(
                "Она одобряет условия пакта. Игровая сессия не может списывать токены кошелька. Оплачиваемое задание требует отдельного согласия.",
                "It approves the pact terms. A game session cannot debit wallet tokens. Paid missions require separate consent.",
              )}
            </p>
          </details>
        </>
      )}
    </HelpDialog>
  );
}

export function HelpDialog({
  title,
  children,
  close,
}: {
  title: string;
  children: ReactNode;
  close(): void;
}) {
  const ref = useRef<HTMLDivElement>(null),
    button = useRef<HTMLButtonElement>(null),
    previous = useRef<HTMLElement | null>(
      document.activeElement as HTMLElement,
    );
  useEffect(() => {
    button.current?.focus();
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = old;
      queueMicrotask(() => {
        if (previous.current?.isConnected) previous.current.focus();
      });
    };
  }, []);
  const { language } = useI18n();
  return (
    <div
      ref={ref}
      className="entry-help"
      role="dialog"
      aria-modal="true"
      aria-labelledby="entry-help-title"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          close();
        }
        if (e.key === "Tab") {
          const items = [
            ...ref.current!.querySelectorAll<HTMLElement>(
              "button,a[href],input,summary",
            ),
          ].filter((el) => el.getClientRects().length);
          const first = items[0],
            last = items.at(-1);
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last?.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first?.focus();
          }
        }
      }}
    >
      <header>
        <h2 id="entry-help-title">{title}</h2>
        <button
          ref={button}
          type="button"
          className="entry-help-close"
          aria-label={language === "en" ? "Close" : "Закрыть"}
          onClick={close}
        >
          <X size={23} />
        </button>
      </header>
      {children}
    </div>
  );
}
