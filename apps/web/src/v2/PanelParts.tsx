import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Copy, ExternalLink, RefreshCw } from "lucide-react";
export function PanelNav<T extends string>({
  items,
  value,
  onChange,
  label,
}: {
  items: Array<{ id: T; label: string; icon: ReactNode }>;
  value: T;
  onChange(value: T): void;
  label: string;
}) {
  return (
    <nav className="dp-panel-nav" aria-label={label}>
      {items.map((item) => (
        <button
          key={item.id}
          aria-current={value === item.id ? "page" : undefined}
          onClick={() => onChange(item.id)}
        >
          {item.icon}
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}
export function CopyField({
  value,
  label,
  language,
  href,
}: {
  value: string;
  label: string;
  language: string;
  href?: string;
}) {
  const [copied, setCopied] = useState(false),
    [error, setError] = useState(false),
    input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setCopied(false);
    setError(false);
  }, [value]);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2500);
    return () => clearTimeout(timer);
  }, [copied]);
  const say = (ru: string, en: string) => (language === "en" ? en : ru);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setError(false);
    } catch {
      setError(true);
      input.current?.focus();
      input.current?.select();
    }
  }
  return (
    <div className="dp-copy-field">
      <label>
        <span>{label}</span>
        <input
          ref={input}
          readOnly
          value={value}
        />
      </label>
      <button
        aria-label={say("Копировать: ", "Copy: ") + label}
        onClick={() => void copy()}
      >
        {copied ? <Check size={18} /> : <Copy size={18} />}
        <span>
          {copied ? say("Скопировано", "Copied") : say("Копировать", "Copy")}
        </span>
      </button>
      {href && (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={say("Открыть: ", "Open: ") + label}
        >
          <ExternalLink size={18} />
        </a>
      )}
      {error && (
        <p role="status">
          {say(
            "Ссылка выделена. Скопируй её вручную.",
            "Text selected. Copy it manually.",
          )}
        </p>
      )}
    </div>
  );
}
export function OperationNotice({
  busy,
  message,
  transaction,
  unknown,
  onRefresh,
  language,
}: {
  busy: string;
  message: string;
  transaction: string;
  unknown: boolean;
  onRefresh(): void;
  language: string;
}) {
  const say = (ru: string, en: string) => (language === "en" ? en : ru);
  if (
    !busy &&
    !message &&
    !unknown &&
    (!transaction ||
      ["Finalized", "Окончательно подтверждено"].includes(transaction))
  )
    return null;
  return (
    <div
      className="dp-operation"
      role="status"
      aria-live="polite"
      aria-busy={!!busy}
    >
      {busy && <b>{busy}…</b>}
      {message && <p>{message}</p>}
      {transaction && <span>{transaction}</span>}
      {unknown && (
        <>
          <p>
            {say(
              "Результат отправки неизвестен. Проверь состояние перед новой подписью.",
              "Submission outcome is unknown. Reconcile before signing again.",
            )}
          </p>
          <button disabled={!!busy} onClick={onRefresh}>
            <RefreshCw size={18} />
            {say("Проверить состояние", "Reconcile state")}
          </button>
        </>
      )}
    </div>
  );
}
