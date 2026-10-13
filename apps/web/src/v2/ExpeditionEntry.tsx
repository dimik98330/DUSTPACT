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
import { friendlyError } from "./friendly-error";
import "./ui.css";
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
              <p>{friendlyError(error, language)}</p>
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
              src={`${import.meta.env.BASE_URL}art/dustroad.png`}
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
        <section
          className="entry-solana"
          aria-label={say("Зачем здесь Solana", "Why Solana is here")}
        >
          <span className="dp-kicker">
            {say("Зачем здесь Solana", "Why Solana is here")}
          </span>
          <h2>
            {say(
              "Доверие, которое нельзя переписать задним числом",
              "Trust that cannot be rewritten after the fact",
            )}
          </h2>
          <div className="entry-solana-grid">
            <article>
              <span className="entry-solana-icon">
                <LockKeyhole size={22} />
              </span>
              <b>{say("Печать пакта", "A sealed pact")}</b>
              <p>
                {say(
                  "Принятый договор закрепляет вклады и работу обеих сторон. Передумать в одиночку уже нельзя — программа проверяет те же условия при расчёте.",
                  "An accepted pact binds both sides' supplies and work. Neither side can quietly change it — the program checks the same terms at settlement.",
                )}
              </p>
            </article>
            <article>
              <span className="entry-solana-icon">
                <Wallet size={22} />
              </span>
              <b>{say("Эскроу за работу", "Escrow for work")}</b>
              <p>
                {say(
                  "Оплачиваемые задания держат тестовые USDC в хранилище программы и выплачивают исполнителю только за подтверждённый результат встречи.",
                  "Paid jobs hold test USDC in the program vault and pay the provider only for a recorded encounter result.",
                )}
              </p>
            </article>
            <article>
              <span className="entry-solana-icon">
                <ShieldCheck size={22} />
              </span>
              <b>{say("Проверяемая история", "Verifiable history")}</b>
              <p>
                {say(
                  "Каждая встреча оставляет квитанцию: журнал перепроверяет всю историю независимым расчётом, а матч и программу можно открыть в Solana Explorer.",
                  "Every encounter leaves a receipt: the journal replays the whole history independently, and the match and program open in Solana Explorer.",
                )}
              </p>
            </article>
          </div>
          <p className="entry-solana-note">
            {say(
              "Для кого: команды 4–6 друзей и сообщества, которым нужен проверяемый общий результат. Обучение работает без кошелька. В тестовой Solana-сети средства не имеют денежной стоимости.",
              "For crews of 4–6 friends and communities that want a verifiable shared result. Learning needs no wallet. Assets on the test Solana network have no monetary value.",
            )}
          </p>
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
  const rules = kind === "rules";
  const steps = rules
    ? [
        {
          icon: Route,
          title: say("Посмотри задачу", "Read the situation"),
          body: say(
            "У колодца нужна вода, у моста — ремонт. На каждой встрече новая задача.",
            "The well needs water; the bridge needs repair. Each encounter brings a new problem.",
          ),
        },
        {
          icon: Handshake,
          title: say("Найди партнёра", "Find a partner"),
          body: say(
            "Не хватает запасов? Обменяйся ими или предложи пакт: вклад в обмен на работу и результат.",
            "Short on supplies? Trade, or offer a pact: a contribution in return for work and output.",
          ),
        },
        {
          icon: Check,
          title: say("Подтверди ход", "Confirm your plan"),
          body: say(
            "Выбери действие и нажми «Мой план готов». Если игра просит подписи, подтверди фиксацию и раскрытие хода.",
            "Choose an action and select “My plan is ready”. If the game asks for signatures, confirm the commit and reveal steps.",
          ),
        },
      ]
    : [
        {
          icon: Handshake,
          title: say("Оба согласны", "Both agree"),
          body: say(
            "Пакт действует после принятия условий.",
            "A pact starts when its terms are accepted.",
          ),
        },
        {
          icon: LockKeyhole,
          title: say("Вклад занят", "Inputs reserved"),
          body: say(
            "Ресурсы и действие нельзя потратить дважды.",
            "Supplies and work cannot be spent twice.",
          ),
        },
        {
          icon: ShieldCheck,
          title: say("Результат проверяем", "Output verifiable"),
          body: say(
            "Исполнение следует правилам программы Solana.",
            "Execution follows the Solana program’s rules.",
          ),
        },
      ];
  return (
    <HelpDialog
      close={close}
      eyebrow={
        rules
          ? say("Как играть", "How to play")
          : say("Зачем Solana", "Why Solana")
      }
      title={
        rules
          ? say("Вместе — до города", "Reach the city together")
          : say(
              "Как работает пакт",
              "How a pact works",
            )
      }
    >
      <div
        className={
          rules ? "help-guide help-guide-rules" : "help-guide help-guide-pact"
        }
      >
        {rules ? (
          <>
            <section
              className="help-goal"
              aria-label={say("Цель экспедиции", "Expedition goal")}
            >
              <span className="help-goal-icon">
                <Compass size={30} aria-hidden="true" />
              </span>
              <div>
                <strong>
                  {say(
                    "Сохрани караван. Доставь груз.",
                    "Keep the caravan alive. Deliver cargo.",
                  )}
                </strong>
                <p>
                  {say(
                    "6 встреч, общие опасности и свой интерес у каждого. В начале груза нет — его предстоит добыть.",
                    "Six encounters, shared dangers and your own interests. Start with no cargo and earn it along the way.",
                  )}
                </p>
              </div>
            </section>
            <div
              className="help-resources"
              aria-label={say("Запасы каравана", "Caravan supplies")}
            >
              <span>
                <Droplets size={19} aria-hidden="true" />
                <b>{say("Вода", "Water")}</b>
                {say("для пути", "for the journey")}
              </span>
              <span>
                <Wrench size={19} aria-hidden="true" />
                <b>{say("Инструменты", "Tools")}</b>
                {say("для работ", "for work")}
              </span>
              <span>
                <Box size={19} aria-hidden="true" />
                <b>{say("Груз", "Cargo")}</b>
                {say("для доставки", "for delivery")}
              </span>
            </div>
          </>
        ) : (
          <>
            <p className="help-lead">
              {say(
                "Обещание можно нарушить. Пакт совместного проекта резервирует точные ресурсы и действие партнёра в Solana.",
                "A promise can be broken. A joint-project pact reserves exact supplies and a partner’s action in Solana.",
              )}
            </p>
            <section className="help-deal" aria-labelledby="help-deal-title">
              <div className="help-deal-heading">
                <span className="help-deal-icon">
                  <Droplets size={22} aria-hidden="true" />
                </span>
                <div>
                  <span className="help-kicker">
                    {say("Пример первой сделки", "Your first pact")}
                  </span>
                  <h3 id="help-deal-title">
                    {say("Восстановить колодец", "Restore the well")}
                  </h3>
                </div>
              </div>
              <div className="help-deal-parties">
                <div className="help-deal-party">
                  <span className="help-deal-person">
                    <UserRound size={18} aria-hidden="true" />
                    {say("Ты вкладываешь", "You contribute")}
                  </span>
                  <strong>
                    <Droplets size={24} aria-hidden="true" />
                    {say("2 воды", "2 water")}
                  </strong>
                  <span>{say("В общий проект", "To the joint project")}</span>
                </div>
                <span
                  className="help-deal-plus"
                  aria-label={say("плюс", "plus")}
                >
                  +
                </span>
                <div className="help-deal-party">
                  <span className="help-deal-person">
                    <UserRound size={18} aria-hidden="true" />
                    {say("Тимур вкладывает", "Timur contributes")}
                  </span>
                  <strong>
                    <Wrench size={24} aria-hidden="true" />
                    {say("1 инструмент", "1 tool")}
                  </strong>
                  <span>
                    <Hammer size={16} aria-hidden="true" />
                    {say("И выполняет ремонт", "And performs the repair")}
                  </span>
                </div>
              </div>
              <div className="help-deal-result">
                <ArrowDown size={21} aria-hidden="true" />
                <div>
                  <span>
                    {say("Колодец даёт 8 воды", "The well produces 8 water")}
                  </span>
                  <strong>
                    {say("4 тебе · 4 Тимуру", "4 for you · 4 for Timur")}
                  </strong>
                </div>
                <span className="help-deal-split">
                  <Droplets size={24} aria-hidden="true" />
                </span>
              </div>
            </section>
          </>
        )}
        <ol
          className="help-flow"
          aria-label={
            rules
              ? say("Три шага на каждой встрече", "Three steps each encounter")
              : say("Как работает пакт", "How a pact works")
          }
        >
          {steps.map((step, i) => (
            <li key={step.title}>
              <div className="help-flow-top">
                <span className="help-step-number">0{i + 1}</span>
                <step.icon size={22} aria-hidden="true" />
              </div>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </li>
          ))}
        </ol>
        {rules ? (
          <section className="help-finale" aria-labelledby="help-finale-title">
            <div className="help-section-heading">
              <h3 id="help-finale-title">
                {say(
                  "У ворот — общий риск, личный выбор",
                  "At the gates: shared risk, your choice",
                )}
              </h3>
              <p>
                {say(
                  "Один участник не делает всё сразу.",
                  "One player cannot do everything at once.",
                )}
              </p>
            </div>
            <ul className="help-final-roles">
              <li>
                <Box size={20} aria-hidden="true" />
                <span>
                  <b>{say("Доставить", "Deliver")}</b>
                  {say(
                    "Отдать свой груз городу",
                    "Give your cargo to the city",
                  )}
                </span>
              </li>
              <li>
                <ShieldCheck size={20} aria-hidden="true" />
                <span>
                  <b>{say("Охранять", "Guard")}</b>
                  {say(
                    "Защитить опасный обход",
                    "Protect the dangerous detour",
                  )}
                </span>
              </li>
              <li>
                <Hammer size={20} aria-hidden="true" />
                <span>
                  <b>{say("Заработать", "Earn")}</b>
                  {say("Получить личный груз", "Earn cargo for yourself")}
                </span>
              </li>
            </ul>
          </section>
        ) : (
          <div className="help-assurance">
            <ShieldCheck size={23} aria-hidden="true" />
            <p>
              <strong>
                {say(
                  "Отключение не отменяет принятый вклад.",
                  "Disconnecting does not cancel an accepted contribution.",
                )}
              </strong>
              {say(
                "Другой клиент может завершить исполнение без нашего сервера. Победа каравана всё ещё зависит от команды.",
                "Another client can finish execution without our server. The crew still has to earn its victory.",
              )}
            </p>
          </div>
        )}
        <details className="help-disclosure">
          <summary>
            <span>
              {rules ? (
                <Box size={18} aria-hidden="true" />
              ) : (
                <Wallet size={18} aria-hidden="true" />
              )}
              {rules
                ? say(
                    "Как считается личный результат?",
                    "How is my score calculated?",
                  )
                : say("Что я разрешаю подписью?", "What am I authorizing?")}
            </span>
            <ChevronDown size={18} aria-hidden="true" />
          </summary>
          {rules ? (
            <div>
              <p>
                <b>
                  {say(
                    "3 × оставшийся груз + доставка + вклад в работу.",
                    "3 × remaining cargo + cargo delivered + work contribution.",
                  )}
                </b>
              </p>
              <p>
                {say(
                  "Личный счёт сохраняется, если караван прибыл и ты не пропустил ход. Иначе он равен нулю. Выполненные оплачиваемые задания проверяются отдельно.",
                  "Keep your personal score if the caravan arrives and you have not missed a move. Otherwise it is zero. Completed paid jobs are checked separately.",
                )}
              </p>
            </div>
          ) : (
            <div>
              <p>
                {say(
                  "Подпись одобряет условия договора. Обычный обмен исполняется сразу и не занимает твой ход. Ограниченная игровая сессия действует только в этом матче и не может списывать SOL или USDC кошелька.",
                  "A signature approves the pact terms. A simple trade executes immediately and leaves your action free. A limited game session applies only to this match and cannot debit your wallet’s SOL or USDC.",
                )}
              </p>
              <p>
                {say(
                  "Внести тестовые USDC в оплачиваемую миссию можно только с отдельного согласия владельца. В обучении блокчейн и кошелёк не используются.",
                  "Funding a paid mission with test USDC requires separate owner consent. The tutorial uses neither a blockchain nor a wallet.",
                )}
              </p>
            </div>
          )}
        </details>
        <footer className="help-guide-footer">
          <button
            className="entry-primary help-learn-button"
            type="button"
            onClick={onLearn}
          >
            <BookOpen size={20} aria-hidden="true" />
            {rules
              ? say("Попробовать с подсказками", "Try with guidance")
              : say("Попробовать первый пакт", "Try your first pact")}
            <ArrowRight size={20} aria-hidden="true" />
          </button>
          <span>
            {say(
              "Без кошелька · в своём темпе",
              "No wallet · at your own pace",
            )}
          </span>
        </footer>
      </div>
    </HelpDialog>
  );
}

export function HelpDialog({
  title,
  eyebrow,
  children,
  close,
}: {
  title: string;
  eyebrow?: string;
  children: ReactNode;
  close(): void;
}) {
  const ref = useRef<HTMLDivElement>(null),
    heading = useRef<HTMLHeadingElement>(null),
    previous = useRef<HTMLElement | null>(
      document.activeElement as HTMLElement,
    );
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
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
              "button,a[href],input,select,textarea,summary,[tabindex]",
            ),
          ].filter(
            (el) =>
              el.tabIndex >= 0 &&
              !el.matches(":disabled") &&
              el.getClientRects().length,
          );
          const first = items[0],
            last = items.at(-1);
          if (
            e.shiftKey &&
            (document.activeElement === first ||
              document.activeElement === heading.current)
          ) {
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
        <div>
          {eyebrow && <span className="help-kicker">{eyebrow}</span>}
          <h2 ref={heading} id="entry-help-title" tabIndex={-1}>
            {title}
          </h2>
        </div>
        <button
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
