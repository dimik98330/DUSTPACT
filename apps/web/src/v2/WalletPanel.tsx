import { useState } from "react";
import {
  Wallet,
  ShieldCheck,
  Coins,
  Download,
  Upload,
  KeyRound,
  ExternalLink,
  ArrowRight,
  CheckCircle2,
  LockKeyhole,
  RefreshCw,
} from "lucide-react";
import type { GameController, GameView, Operation } from "./model";
import { CopyField, OperationNotice, PanelNav } from "./PanelParts";
import RecoverySteps from "./RecoverySteps";
export type WalletSection = "profile" | "fees" | "mission" | "recovery";
type Props = {
  game: GameView;
  controller: GameController;
  language: string;
  section: WalletSection;
  onSection(value: WalletSection): void;
  busy: string;
  unknown: boolean;
  message: string;
  transaction: string;
  run(label: string, action: () => Promise<Operation>): Promise<void>;
  onRefresh(): void;
  onWallet(): void;
  recovery: string | null;
  exportRecovery(): Promise<void>;
  exportMove(): void;
  importMove(file?: File): Promise<void>;
};
export default function WalletPanel({
  game: g,
  controller: c,
  language,
  section,
  onSection,
  busy,
  unknown,
  message,
  transaction,
  run,
  onRefresh,
  onWallet,
  recovery,
  exportRecovery,
  exportMove,
  importMove,
}: Props) {
  const say = (ru: string, en: string) => (language === "en" ? en : ru),
    me = g.seats[g.seat],
    [review, setReview] = useState(false),
    blocked = !!busy || unknown;
  const sessionAllowed =
    g.network === "local" && c.ownerAvailable && !g.sessionActive;
  return (
    <div className="dp-wallet">
      <div className="dp-page-intro">
        <span className="dp-kicker">
          {g.network === "practice"
            ? "OFFCHAIN"
            : g.network === "local"
              ? "SOLANA · LOCALNET"
              : "SOLANA · DEVNET"}
        </span>
        <p>
          {say(
            "Профиль, игровые разрешения и тестовые выплаты — каждый раздел отдельно.",
            "Your profile, game permissions and test payouts, in separate sections.",
          )}
        </p>
      </div>
      <PanelNav
        value={section}
        onChange={onSection}
        label={say("Разделы кошелька", "Wallet sections")}
        items={[
          {
            id: "profile",
            label: say("Профиль и подписи", "Profile & signing"),
            icon: <Wallet size={19} />,
          },
          {
            id: "fees",
            label: say("Комиссии", "Fees"),
            icon: <Coins size={19} />,
          },
          {
            id: "mission",
            label: say("TEST-миссия", "TEST mission"),
            icon: <ShieldCheck size={19} />,
          },
          {
            id: "recovery",
            label: say("Восстановление", "Recovery"),
            icon: <Download size={19} />,
          },
        ]}
      />
      <OperationNotice
        busy={busy}
        message={message}
        transaction={transaction}
        unknown={unknown}
        language={language}
        onRefresh={onRefresh}
      />
      {section === "profile" && (
        <div className="dp-two-columns">
          <section className="dp-card">
            <div className="dp-card-heading">
              <Wallet />
              <div>
                <span className="dp-kicker">
                  {say("Твой игровой профиль", "Your game profile")}
                </span>
                <h3>{me.name}</h3>
              </div>
            </div>
            <p>
              {g.network === "practice"
                ? say(
                    "Обучение работает без подключения кошелька.",
                    "Learning works without a wallet.",
                  )
                : say(
                    "За этим адресом закреплены твоё место и право на выплату.",
                    "This address owns your seat and any earned payout.",
                  )}
            </p>
            {g.network !== "practice" && (
              <>
                <CopyField
                  value={me.owner}
                  label={say("Адрес владельца", "Owner address")}
                  language={language}
                />
                <button onClick={onWallet}>
                  <Wallet size={19} />
                  {say("Подключить другой кошелёк", "Connect another wallet")}
                </button>
              </>
            )}
          </section>
          <section className="dp-card">
            <div className="dp-card-heading">
              <KeyRound />
              <div>
                <span className="dp-kicker">
                  {say("Как отправляются ходы", "How moves are sent")}
                </span>
                <h3>
                  {g.sessionPaused
                    ? say(
                        "Автоотправка остановлена",
                        "Automatic submission paused",
                      )
                    : g.sessionActive
                      ? say("Сессия включена", "Session enabled")
                      : say("Ручные подписи", "Manual signing")}
                </h3>
              </div>
            </div>
            <p>
              {g.sessionPaused
                ? say(
                    "Проверь состояние и заверши отзыв разрешения. Автоматические действия остановлены.",
                    "Reconcile the state and complete revocation. Automatic actions are stopped.",
                  )
                : g.sessionActive
                  ? say(
                      `Осталось до ${me.sessionQuota ?? 128} игровых действий. Ключ хранится в памяти этой вкладки.`,
                      `Up to ${me.sessionQuota ?? 128} game actions remain. The key lives in this tab’s memory.`,
                    )
                  : say(
                      "Без сессии ты сам подписываешь фиксацию и раскрытие выбранного хода.",
                      "Without a session, sign the commitment and reveal of your selected move yourself.",
                    )}
            </p>
            <div className="dp-limits">
              <span>2 {say("часа", "hours")}</span>
              <span>128 {say("действий", "actions")}</span>
              <span>{say("Только этот матч", "This match only")}</span>
            </div>
            <p className="dp-safe-note">
              <LockKeyhole size={18} />
              {say(
                "Сессия не может списывать SOL или USDC кошелька.",
                "A session cannot debit wallet SOL or USDC.",
              )}
            </p>
            {g.sessionActive ? (
              <button
                disabled={blocked || !c.ownerAvailable}
                onClick={() =>
                  void run(say("Отозвать сессию", "Revoke session"), () =>
                    c.revokeSession(),
                  )
                }
              >
                {say("Отозвать разрешение", "Revoke permission")}
              </button>
            ) : (
              <button
                className="dp-primary"
                disabled={blocked || !sessionAllowed}
                onClick={() =>
                  void run(say("Разрешить сессию", "Authorize session"), () =>
                    c.enableSession(),
                  )
                }
              >
                {say("Разрешить игровую сессию", "Authorize game session")}
                <ArrowRight size={19} />
              </button>
            )}
            {g.network !== "local" && !g.sessionActive && (
              <p className="dp-caption">
                {g.network === "practice"
                  ? say(
                      "В обучении подписи и сессия не нужны.",
                      "Learning needs neither signatures nor a session.",
                    )
                  : say(
                      "В Devnet автоотправка пока недоступна. Подписывай ходы вручную.",
                      "Devnet automatic submission is not available yet. Sign moves manually.",
                    )}
              </p>
            )}
            {!c.ownerAvailable && g.network !== "practice" && (
              <p className="dp-caption">
                {say(
                  "Для изменения разрешений нужен профиль владельца.",
                  "Permission changes require the owner profile.",
                )}
              </p>
            )}
          </section>
        </div>
      )}
      {section === "fees" && (
        <section className="dp-card dp-reading-width">
          <span className="dp-kicker">
            {say("Сетевая комиссия", "Network fee")}
          </span>
          <h3>
            {g.network === "practice"
              ? say("В обучении комиссий нет", "No fees in learning")
              : g.fees?.enabled
                ? say("Оплачивает организатор", "Paid by the organizer")
                : say("Оплачиваешь ты", "Paid by your signer")}
          </h3>
          <p>
            {say(
              "Комиссия — тестовые SOL за отправку действия в Solana. Это отдельный расход от депозита миссии.",
              "A fee is test SOL for submitting an action to Solana. It is separate from the mission deposit.",
            )}
          </p>
          {g.network !== "practice" && (
            <>
              <div className="dp-fact-list">
                <div>
                  <CheckCircle2 size={20} />
                  <p>
                    {say(
                      "Ты подписываешь ход и сохраняешь управление своим местом.",
                      "You sign the move and retain control of your seat.",
                    )}
                  </p>
                </div>
                <div>
                  <LockKeyhole size={20} />
                  <p>
                    {say(
                      "Поддержка комиссии не оплачивает 20 TEST USDC и создание новых счетов.",
                      "Fee support does not pay the 20 TEST USDC or new-account deposits.",
                    )}
                  </p>
                </div>
              </div>
              {c.enableFeeSupport && c.disableFeeSupport ? (
                g.fees?.enabled ? (
                  <>
                    {g.fees.payer && (
                      <CopyField
                        value={g.fees.payer}
                        label={say("Адрес плательщика", "Fee payer address")}
                        language={language}
                      />
                    )}
                    <p className="dp-caption">
                      {say(
                        "Переход на свои комиссии отзовёт активную сессию подписью владельца.",
                        "Switching to self-pay revokes an active session with the owner’s signature.",
                      )}
                    </p>
                    <button
                      disabled={blocked}
                      onClick={() =>
                        void run(say("Свои комиссии", "Self-pay fees"), () =>
                          c.disableFeeSupport!(),
                        )
                      }
                    >
                      {say("Оплачивать самостоятельно", "Use self-pay")}
                    </button>
                  </>
                ) : (
                  <>
                    <p className="dp-caption">
                      {say(
                        "Потребуется отдельный вход в сервис комиссий. Он не получает доступа к токенам и не выбирает ходы.",
                        "A separate fee-service sign-in is required. It cannot access tokens or choose moves.",
                      )}
                    </p>
                    <button
                      className="dp-primary"
                      disabled={blocked}
                      onClick={() =>
                        void run(say("Поддержка комиссий", "Fee support"), () =>
                          c.enableFeeSupport!(),
                        )
                      }
                    >
                      {say("Включить поддержку комиссии", "Enable fee support")}
                      <ArrowRight size={19} />
                    </button>
                  </>
                )
              ) : (
                <p>
                  {say(
                    "Поддержка комиссии для этого режима недоступна.",
                    "Fee support is unavailable in this mode.",
                  )}
                </p>
              )}
            </>
          )}
        </section>
      )}
      {section === "mission" && (
        <section className="dp-card">
          <span className="dp-badge">
            TEST · {say("без денежной стоимости", "no monetary value")}
          </span>
          <div className="dp-mission-heading">
            <div>
              <h3>{say("Два ремонта моста", "Two bridge repairs")}</h3>
              <p>
                {say(
                  "Необязательная миссия. Вход в игру бесплатный, ставки не нужны.",
                  "An optional mission. Free game entry, no player wagers.",
                )}
              </p>
            </div>
            <div className="dp-amount">
              20 <span>TEST USDC</span>
            </div>
          </div>
          <div className="dp-fact-list dp-inline-facts">
            <div>
              <Coins />
              <p>
                {say(
                  "По 10 за каждый выполненный ремонт",
                  "10 per completed repair",
                )}
              </p>
            </div>
            <div>
              <ShieldCheck />
              <p>
                {say(
                  "Получатель — владелец места исполнителя",
                  "Paid to the provider’s seat owner",
                )}
              </p>
            </div>
            <div>
              <CheckCircle2 />
              <p>
                {say(
                  "Выплата сохраняется при провале каравана",
                  "Earned payment survives caravan failure",
                )}
              </p>
            </div>
          </div>
          <p className="dp-caption">
            {g.network === "local"
              ? say(
                  "Localnet: симулированные тестовые токены, не выпущены Circle.",
                  "Localnet: simulated test tokens, not issued by Circle.",
                )
              : g.network === "practice"
                ? say(
                    "В обучении нет токенов и выплат.",
                    "Learning has no tokens or payouts.",
                  )
                : say(
                    "Devnet: тестовые USDC без денежной стоимости. Комиссия и создание счетов требуют тестовых SOL.",
                    "Devnet: test USDC with no monetary value. Fees and account rent need test SOL.",
                  )}
          </p>
          {g.vault?.funded ? (
            <>
              {!g.vault.active && (
                <p className="dp-alert">
                  {say(
                    "Условия комнаты изменились. Миссия неактивна; проверь возможность возврата.",
                    "Room terms changed. The mission is inactive; check refund availability.",
                  )}
                </p>
              )}
              <div className="dp-job-grid">
                {g.vault.slots.map((s) => (
                  <article className="dp-job" key={s.id}>
                    <span className="dp-kicker">
                      {say(`Ремонт ${s.id + 1}`, `Repair ${s.id + 1}`)}
                    </span>
                    <h4>10 TEST USDC</h4>
                    <p>
                      {say(
                        {
                          open: "Свободно",
                          reserved: "Принято исполнителем",
                          earned: "Работа выполнена",
                          paid: "Выплачено",
                          refunded: "Возвращено заказчику",
                        }[s.status],
                        {
                          open: "Open",
                          reserved: "Accepted",
                          earned: "Work completed",
                          paid: "Paid",
                          refunded: "Refunded to sponsor",
                        }[s.status],
                      )}
                      {s.provider !== undefined
                        ? ` · ${g.seats[s.provider]?.name ?? "?"}`
                        : ""}
                    </p>
                    {s.status === "earned" && (
                      <button
                        className="dp-primary"
                        disabled={blocked}
                        onClick={() =>
                          void run(
                            say("Получить выплату", "Claim payout"),
                            () => c.claim(s.id),
                          )
                        }
                      >
                        {say("Получить 10 TEST USDC", "Claim 10 TEST USDC")}
                      </button>
                    )}
                    {s.status === "refunded" && g.vault?.sponsor && (
                      <CopyField
                        value={g.vault.sponsor}
                        label={say("Получатель возврата", "Refund recipient")}
                        language={language}
                      />
                    )}
                  </article>
                ))}
              </div>
              {g.vault.refundable && (
                <button
                  disabled={blocked}
                  onClick={() =>
                    void run(
                      say("Вернуть незанятые средства", "Refund unused funds"),
                      () => c.refund(),
                    )
                  }
                >
                  {say("Вернуть незанятые средства", "Refund unused funds")}
                </button>
              )}
            </>
          ) : g.network !== "practice" &&
            g.phase === 0 &&
            g.testFunding &&
            g.testFunding.status !== "ready" ? (
            <div className="dp-safe-note" role="status">
              <div>
                <h4>
                  {g.testFunding.status === "checking"
                    ? say("Проверяем тестовую оплату", "Checking test payments")
                    : say(
                        "Тестовая оплата недоступна",
                        "Test payments unavailable",
                      )}
                </h4>
                <p>
                  {g.testFunding.status === "checking"
                    ? say(
                        "Читаем доступность средств напрямую из Solana.",
                        "Reading test-fund availability directly from Solana.",
                      )
                    : g.testFunding.reason === "mint"
                      ? say(
                          "В этой сети тестовые USDC ещё не подготовлены. Экспедиция доступна без оплачиваемой миссии.",
                          "Test USDC is not prepared on this network. You can play without a paid mission.",
                        )
                      : g.testFunding.reason === "balance"
                        ? say(
                            "На этом тестовом профиле недостаточно средств для депозита 20 TEST USDC. Экспедиция доступна бесплатно.",
                            "This test profile lacks the funds for a 20 TEST USDC deposit. The expedition is free to play.",
                          )
                        : say(
                            "Не удалось проверить средства. Повтори проверку соединения.",
                            "Could not verify test funds. Check the connection again.",
                          )}
                </p>
                <button
                  disabled={blocked || g.testFunding.status === "checking"}
                  onClick={onRefresh}
                >
                  <RefreshCw size={18} />
                  {say("Проверить доступность", "Check availability")}
                </button>
              </div>
            </div>
          ) : g.network !== "practice" && g.phase === 0 && c.canFundMission ? (
            <>
              {!review ? (
                <button
                  className="dp-primary"
                  disabled={blocked}
                  onClick={() => setReview(true)}
                >
                  {say("Посмотреть условия депозита", "Review deposit terms")}
                  <ArrowRight size={19} />
                </button>
              ) : (
                <div className="dp-deposit-review">
                  <h4>
                    {say(
                      "Отдельное согласие на депозит",
                      "Separate deposit consent",
                    )}
                  </h4>
                  <p>
                    <b>20 TEST USDC → PactVault</b>{" "}
                    {say(
                      "этой экспедиции. Игровые запасы не списываются.",
                      "of this expedition. Game inventory is not debited.",
                    )}
                  </p>
                  <p>
                    {say(
                      "Незанятые задания возвращаются после срока. Принятые средства ждут результата программы; выполненная работа оплачивается даже при общем провале.",
                      "Unfilled jobs refund after their deadline. Accepted funds await the program’s result; completed work pays even after shared failure.",
                    )}
                  </p>
                  <p className="dp-caption">
                    {say(
                      "Депозит не гарантирует победу. Комиссия и новые счета оплачиваются отдельно.",
                      "The deposit does not guarantee victory. Fees and new accounts are separate costs.",
                    )}
                  </p>
                  <div className="dp-action-row">
                    <button
                      className="dp-primary"
                      disabled={blocked}
                      onClick={() =>
                        void run(
                          say("Внести 20 TEST USDC", "Fund 20 TEST USDC"),
                          () => c.fundMission(),
                        )
                      }
                    >
                      {say(
                        "Подписать депозит 20 TEST USDC",
                        "Sign 20 TEST USDC deposit",
                      )}
                    </button>
                    <button disabled={!!busy} onClick={() => setReview(false)}>
                      {say("Отмена", "Cancel")}
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <p className="dp-empty-note">
              {say(
                "Депозит можно внести до старта после закрепления условий создателем комнаты. Обычная игра работает без этой миссии.",
                "Fund before departure once the room creator has pinned the terms. The regular game works without this mission.",
              )}
            </p>
          )}
          <details className="dp-details">
            <summary>
              {say("Кто может получить оплату?", "Who can be paid?")}
            </summary>
            <p>
              {say(
                "Демонстрационные агенты исключены. Кошелёк не доказывает человечность. Право выплаты определяет программа Solana, а не наш сервер.",
                "Demo agents are excluded. A wallet is not proof of humanity. The Solana program determines payout rights, not our server.",
              )}
            </p>
          </details>
        </section>
      )}
      {section === "recovery" && (
        <RecoverySteps
          game={g}
          language={language}
          busy={!!busy}
          unknown={unknown}
          recovery={recovery}
          exportRecovery={exportRecovery}
          exportMove={exportMove}
          importMove={importMove}
        />
      )}
    </div>
  );
}
