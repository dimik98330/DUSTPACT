import {
  Download,
  ExternalLink,
  FileCheck2,
  LockKeyhole,
  Upload,
  ShieldCheck,
} from "lucide-react";
import type { GameView } from "./model";
export default function RecoverySteps({
  game: g,
  language,
  busy,
  unknown,
  recovery,
  exportRecovery,
  exportMove,
  importMove,
}: {
  game: GameView;
  language: string;
  busy: boolean;
  unknown: boolean;
  recovery: string | null;
  exportRecovery(): Promise<void>;
  exportMove(): void;
  importMove(file?: File): Promise<void>;
}) {
  const say = (ru: string, en: string) => (language === "en" ? en : ru);
  if (g.network === "practice")
    return (
      <section className="play-recovery-intro">
        <ShieldCheck size={30} />
        <h3>
          {say(
            "Обучение не требует восстановления Solana",
            "Learning does not need Solana recovery",
          )}
        </h3>
        <p>
          {say(
            "Текущая экспедиция рассчитывается в браузере. Для неё не нужны кошелёк и пакет транзакций.",
            "This expedition resolves in the browser. It needs neither a wallet nor a transaction bundle.",
          )}
        </p>
      </section>
    );
  return (
    <section data-recovery-panel tabIndex={-1} className="play-recovery">
      <div className="play-recovery-intro">
        <span className="dp-kicker">
          {say(
            "Если соединение прервалось",
            "If the connection is interrupted",
          )}
        </span>
        <h3>
          {say(
            "Сохрани ход. Продолжи в другом клиенте.",
            "Save your move. Continue in another client.",
          )}
        </h3>
        <p>
          {say(
            "При обычной игре сюда заходить не нужно. Этот раздел нужен, если основной клиент недоступен или потеряна сохранённая копия хода.",
            "You do not need this during normal play. Use it when the main client is unavailable or the saved move copy is missing.",
          )}
        </p>
      </div>
      <div className="play-recovery-flow">
        <article>
          <span className="play-step-number">1</span>
          <Download size={28} />
          <h4>{say("Сохрани пакет", "Save the bundle")}</h4>
          <p>
            {say(
              "После подготовки хода и повторно после отправки. В файле — сохранённый выбор и журнал незавершённых операций.",
              "After preparing your move, and again after submission. The file contains the saved choice and unresolved-operation journal.",
            )}
          </p>
          <button
            className="dp-primary"
            disabled={busy}
            onClick={() => void exportRecovery()}
          >
            <Download size={18} />
            {say("Скачать пакет", "Download bundle")}
          </button>
        </article>
        <article>
          <span className="play-step-number">2</span>
          <ExternalLink size={28} />
          <h4>{say("Открой восстановление", "Open recovery")}</h4>
          <p>
            {say(
              "Независимый клиент работает напрямую с Solana RPC. Подключи кошелёк владельца игрового места.",
              "The independent client uses Solana RPC directly. Connect the wallet that owns your seat.",
            )}
          </p>
          {recovery ? (
            <a
              className="play-button-link"
              href={recovery}
              target="_blank"
              rel="noopener noreferrer"
            >
              {say("Открыть клиент", "Open the client")}
              <ExternalLink size={18} />
            </a>
          ) : (
            <p>
              {say(
                "Ссылка восстановления недоступна.",
                "Recovery URL is unavailable.",
              )}
            </p>
          )}
        </article>
        <article>
          <span className="play-step-number">3</span>
          <FileCheck2 size={28} />
          <h4>{say("Импортируй и проверь", "Import and review")}</h4>
          <p>
            {say(
              "Загрузи полный пакет в независимый клиент. Проверь состояние прежних отправок, затем подпиши доступное действие.",
              "Load the full bundle in the independent client. Reconcile earlier submissions, then sign an available action.",
            )}
          </p>
          <span className="play-step-note">
            {say(
              "Новая подпись — только после сверки",
              "Reconcile before signing again",
            )}
          </span>
        </article>
      </div>
      <p className="play-private-note">
        <LockKeyhole size={20} />
        {say(
          "Пакет содержит скрытый ход — не публикуй его до раскрытия. Ключа кошелька в нём нет. Потерянный неизвестный выбор восстановить нельзя.",
          "The bundle contains a hidden move — keep it private until reveal. It contains no wallet key. An unknown lost choice cannot be reconstructed.",
        )}
      </p>
      <details className="play-move-tools">
        <summary>
          {say(
            "У меня уже есть файл исходного хода",
            "I already have an original move file",
          )}
        </summary>
        <div>
          <div>
            <h4>
              {say("Вернуть копию в эту игру", "Restore the copy in this game")}
            </h4>
            <p>
              {say(
                "Здесь принимается только файл хода. Полный пакет из шага 1 импортируется в независимом клиенте.",
                "This input accepts a move-only file. Import the full bundle from step 1 in the independent client.",
              )}
            </p>
          </div>
          <label className="dp-file-button" aria-disabled={busy || unknown}>
            <Upload size={18} />
            {say("Импортировать ход", "Import move")}
            <input
              type="file"
              accept="application/json,.json"
              disabled={busy || unknown}
              onChange={(e) => {
                void importMove(e.target.files?.[0]);
                e.currentTarget.value = "";
              }}
            />
          </label>
          <button disabled={busy} onClick={exportMove}>
            {say("Скачать только ход", "Download move only")}
          </button>
        </div>
      </details>
    </section>
  );
}
