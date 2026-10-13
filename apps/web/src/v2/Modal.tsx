import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
export default function Modal({
  title,
  closeLabel,
  onClose,
  children,
  wide = false,
  guided = false,
  fullPage = false,
}: {
  title: string;
  closeLabel: string;
  onClose(): void;
  children: ReactNode;
  wide?: boolean;
  guided?: boolean;
  fullPage?: boolean;
}) {
  const root = useRef<HTMLElement>(null),
    close = useRef(onClose);
  close.current = onClose;
  const titleId = useId();
  useEffect(() => {
    if (guided) return;
    const previous = document.activeElement as HTMLElement | null;
    const panel = root.current;
    const siblings = fullPage
      ? [...(panel?.parentElement?.parentElement?.children ?? [])].filter(
          (el): el is HTMLElement =>
            el instanceof HTMLElement && el !== panel?.parentElement,
        )
      : [];
    const inertBefore = siblings.map((el) => el.inert);
    siblings.forEach((el) => {
      el.inert = true;
    });
    if (fullPage) window.scrollTo({ top: 0, behavior: "instant" });
    const focusable = () =>
      [
        ...(panel?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,[tabindex="0"]',
        ) ?? []),
      ].filter((el) => el.getClientRects().length > 0);
    focusable()[0]?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.key === "Escape") {
        e.preventDefault();
        close.current();
      }
      if (e.key === "Tab") {
        const all = focusable(),
          first = all[0],
          last = all.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        }
        if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      siblings.forEach((el, i) => {
        el.inert = inertBefore[i];
      });
      if (previous?.isConnected) previous.focus();
    };
  }, [guided, title, fullPage]);
  return (
    <div
      className={fullPage ? "dp-sheet-backdrop" : "v2-modal-backdrop"}
      onClick={fullPage ? undefined : onClose}
    >
      <section
        ref={root}
        className={
          fullPage
            ? "dp-sheet"
            : `v2-modal ${wide ? "v2-modal-wide" : ""} ${guided ? "v2-modal-guided" : ""}`
        }
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <h2 id={titleId}>{title}</h2>
          <button className="v2-icon" aria-label={closeLabel} onClick={onClose}>
            <X size={24} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
