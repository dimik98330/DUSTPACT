import {
  lazy,
  Suspense,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { createClient } from "@solana/kit";
import { walletSigner } from "@solana/kit-plugin-wallet";
import { openOnline, publicPolicies } from "./online-v3";
import Modal from "./Modal";
import type { GameController } from "./model";
import { createPracticeController } from "./practice-v3";
import ExpeditionEntry, { type EntryMode } from "./ExpeditionEntry";
import { useI18n } from "../../../../packages/ui/src/i18n";
import "../v2.css";

const GameScreen = lazy(() => import("./GameScreen"));
const wallet = createClient().use(walletSigner({ chain: "solana:devnet" }));

/**
 * V3 entry. Native Localnet is explicit-start and never imports user keys.
 * Practice (?mode=practice) uses Rust/Wasm without signatures or money.
 * The outer entry rejects explicit retired-version links without migrating old Matches.
 */
export default function V3Root({ onExit }: { onExit(): void }) {
  const { t, language } = useI18n();
  const say = (ru: string, en: string) => (language === "en" ? en : ru);
  const params = new URLSearchParams(location.search),
    native = params.get("mode") !== "practice";
  const network = params.get("cluster") === "devnet" ? "devnet" : "local";
  const matchParam = params.get("match")?.trim() || undefined;
  const resumeCount = Number(params.get("resume_agents"));
  const resumeAgents =
    !!matchParam &&
    network === "local" &&
    Number.isInteger(resumeCount) &&
    resumeCount >= 4 &&
    resumeCount <= 6;
  const walletState = useSyncExternalStore(
    wallet.wallet.subscribe,
    wallet.wallet.getState,
  );
  const [walletOpen, setWalletOpen] = useState(false),
    [starting, setStarting] = useState(false);
  const [controller, setController] = useState<GameController | null>(null);
  const [error, setError] = useState("");
  const [entryMode, setEntryMode] = useState<EntryMode>(
    network === "devnet" || params.get("agents") === "0" ? "friends" : "agents",
  );
  const [startStatus, setStartStatus] = useState("");
  useEffect(() => {
    if (native) return;
    let live = true;
    let built: GameController | null = null;
    createPracticeController(4)
      .then((c) => {
        if (live) {
          built = c;
          setController(c);
        } else c.dispose();
      })
      .catch(
        (e) => live && setError(e instanceof Error ? e.message : String(e)),
      );
    return () => {
      live = false;
      built?.dispose();
    };
  }, [native]);
  useEffect(() => () => controller?.dispose(), [controller]);
  async function startOnline(skipBootstrap = false) {
    if (starting) return;
    if (skipBootstrap) {
      const u = new URL(location.href);
      u.searchParams.delete("resume_agents");
      history.replaceState(null, "", u);
    }
    if (entryMode === "learn" && !matchParam) {
      location.assign("?version=3&mode=practice&tutorial=1");
      return;
    }
    setStarting(true);
    setError("");
    setStartStatus(
      say("Проверяем подключение к Solana…", "Checking the Solana connection…"),
    );
    try {
      const c = await openOnline({
        network,
        signer:
          network === "devnet"
            ? (walletState.connected?.signer ?? undefined)
            : undefined,
        match: matchParam,
        agents:
          network === "local" &&
          ((!matchParam && entryMode === "agents") ||
            (resumeAgents && !skipBootstrap)),
        count: resumeAgents ? resumeCount : 4,
        fees: false,
        onProgress: (message) => setStartStatus(say(...message)),
        onCreated: (match, agentCount) => {
          const u = new URL(location.href);
          u.searchParams.set("match", match);
          u.searchParams.set("version", "3");
          u.searchParams.set("cluster", network);
          if (agentCount)
            u.searchParams.set("resume_agents", String(agentCount));
          history.replaceState(null, "", u);
        },
      });
      setController(c);
      const u = new URL(location.href);
      u.searchParams.set("match", c.snapshot().match);
      u.searchParams.set("version", "3");
      u.searchParams.set("cluster", network);
      u.searchParams.delete("resume_agents");
      history.replaceState(null, "", u);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
    }
  }
  const walletDialog = walletOpen && (
    <Modal
      title={say("Подключение кошелька", "Wallet connection")}
      closeLabel={say("Закрыть", "Close")}
      onClose={() => setWalletOpen(false)}
    >
      <p>
        {say(
          "Кошелёк подтверждает состав, условия договора и отдельное внесение тестовой оплаты. Игровая сессия не может списывать ваши токены.",
          "The wallet approves the roster, pact terms and a separate test-payment deposit. A game session cannot debit your tokens.",
        )}
      </p>
      {walletState.connected ? (
        <>
          <code>{walletState.connected.account.address}</code>
          <button
            onClick={() =>
              void wallet.wallet.disconnect().then(() => {
                controller?.dispose();
                setController(null);
              })
            }
          >
            {say("Отключить кошелёк", "Disconnect wallet")}
          </button>
        </>
      ) : (
        walletState.wallets.map((w) => (
          <button
            key={w.name}
            disabled={starting}
            onClick={() =>
              void wallet.wallet
                .connect(w)
                .then(() => setWalletOpen(false))
                .catch((e) =>
                  setError(e instanceof Error ? e.message : String(e)),
                )
            }
          >
            {w.name}
          </button>
        ))
      )}
      {!walletState.connected && !walletState.wallets.length && (
        <p>
          {say(
            "Wallet Standard кошелёк не найден в этом браузере. Локальная экспедиция использует явно обозначенный тестовый профиль.",
            "No Wallet Standard wallet was detected. Local expeditions use an explicitly identified test profile.",
          )}
        </p>
      )}
    </Modal>
  );
  if (native && !controller) {
    let deploymentReady = network === "local";
    try {
      deploymentReady ||= !!publicPolicies();
    } catch {
      /* Public signing stays unavailable for an invalid release policy. */
    }
    return (
      <div className="v2-app v3-entry-app">
        <ExpeditionEntry
          mode={entryMode}
          onMode={setEntryMode}
          network={network}
          match={matchParam}
          starting={starting}
          status={startStatus}
          error={error}
          onStart={() => void startOnline()}
          onOpenExisting={
            resumeAgents ? () => void startOnline(true) : undefined
          }
          onWallet={() => setWalletOpen(true)}
          walletConnected={!!walletState.connected}
          deploymentReady={deploymentReady}
        />
        {walletDialog}
      </div>
    );
  }
  if (error)
    return (
      <div
        className="v2-app"
        role="alert"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <div style={{ maxWidth: 440, textAlign: "center" }}>
          <h2>
            {say(
              "Не удалось открыть экспедицию",
              "Could not open the expedition",
            )}
          </h2>
          <p>{error}</p>
          <button className="v2-primary" onClick={onExit}>
            {t("Вернуться к игре")}
          </button>
        </div>
      </div>
    );
  if (!controller)
    return (
      <div className="v2-app" role="status" aria-live="polite">
        <div className="v2-scene-loading">
          <span className="v2-spinner" />
          {say("Готовим экспедицию…", "Preparing the expedition…")}
        </div>
      </div>
    );
  return (
    <Suspense
      fallback={
        <div className="v2-app" role="status" aria-live="polite">
          <div className="v2-scene-loading">
            <span className="v2-spinner" />
            {say("Готовим экспедицию…", "Preparing the expedition…")}
          </div>
        </div>
      }
    >
      <GameScreen
        controller={controller}
        onExit={onExit}
        onWallet={() => setWalletOpen(true)}
      />
      {walletDialog}
    </Suspense>
  );
}
