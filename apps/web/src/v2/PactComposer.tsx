import { useEffect, useId, useRef } from "react";
import { useI18n } from "../../../../packages/ui/src/i18n";
import {
  ArrowLeft,
  ArrowRight,
  ArrowRightLeft,
  Check,
  Droplets,
  Flag,
  Handshake,
  LoaderCircle,
  LockKeyhole,
  Minus,
  Package,
  Plus,
  Wrench,
} from "lucide-react";
import type { Bundle, GameView, PactTerms } from "./model";
import { free } from "./model";
import { actionContent, words, type Text } from "./content";
import { defaultTerms } from "./terms";
import { editContribution, projectRecipe } from "./composer-model";
import { pactPresentation } from "./pact-presentation";
import PactTermsCard, { NamedSupplies } from "./PactTermsCard";
const resourceIcons = [Droplets, Wrench, Package];

function Amount({
  value,
  max,
  min = 0,
  available,
  title,
  fieldName,
  label,
  disabled,
  onChange,
}: {
  value: number;
  max: number;
  min?: number;
  available?: number;
  title: string;
  fieldName?: string;
  label: string;
  disabled: boolean;
  onChange(n: number): void;
}) {
  const id = useId(),
    invalid =
      !Number.isInteger(value) ||
      value < min ||
      value > max ||
      (available !== undefined && value > available);
  return (
    <div className="pc-amount" data-invalid={invalid || undefined}>
      <div className="pc-amount-label">
        <label htmlFor={id}>{title}</label>
        {available !== undefined && (
          <small>
            {label}: <b>{available}</b>
          </small>
        )}
      </div>
      <div className="pc-stepper">
        <button
          type="button"
          disabled={disabled || (Number.isFinite(value) && value <= min)}
          aria-label={`${fieldName ?? title}: −1`}
          onClick={() =>
            onChange(Number.isFinite(value) ? Math.max(min, value - 1) : min)
          }
        >
          <Minus size={16} />
        </button>
        <input
          id={id}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          step={1}
          aria-invalid={invalid || undefined}
          aria-label={fieldName ?? title}
          value={Number.isFinite(value) ? value : ""}
          disabled={disabled}
          onChange={(e) =>
            onChange(
              e.currentTarget.value === ""
                ? NaN
                : Number(e.currentTarget.value),
            )
          }
        />
        <button
          type="button"
          disabled={
            disabled ||
            (Number.isFinite(value) &&
              value >=
                (available === undefined ? max : Math.min(max, available)))
          }
          aria-label={`${fieldName ?? title}: +1`}
          onClick={() =>
            onChange(Number.isFinite(value) ? Math.min(max, value + 1) : 1)
          }
        >
          <Plus size={16} />
        </button>
      </div>
    </div>
  );
}

export default function PactComposer({
  game: g,
  partner,
  terms: p,
  bounty,
  busy,
  error,
  onChange,
  onBounty,
  onBack,
  onSubmit,
}: {
  game: GameView;
  partner: number;
  terms: PactTerms;
  bounty?: number;
  busy: boolean;
  error: Text | null;
  onChange(p: PactTerms): void;
  onBounty(slot: number | undefined): void;
  onBack(): void;
  onSubmit(): void;
}) {
  const languageId = useId(),
    typeName = useId(),
    providerName = useId();
  const heading = useRef<HTMLElement>(null),
    title = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const el = heading.current;
    if (!el) return;
    const sheetHeader = el
      .closest(".dp-sheet")
      ?.querySelector(":scope > header");
    window.scrollTo({
      top: Math.max(
        0,
        window.scrollY +
          el.getBoundingClientRect().top -
          (sheetHeader?.getBoundingClientRect().height ?? 0) -
          16,
      ),
      behavior: "instant",
    });
    title.current?.focus({ preventScroll: true });
  }, []);
  // GameScreen supplies the language through the same context used by every pact preview.
  const { language } = useI18n();
  const say = (ru: string, en: string) => (language === "en" ? en : ru);
  const peer = g.seats[partner],
    recipe = projectRecipe(g),
    model = pactPresentation(g, p),
    locked =
      busy || g.phase !== 1 || (g.network !== "practice" && g.seconds <= 0);
  const types = [
    {
      kind: 0,
      title: say("Обмен запасами", "Trade supplies"),
      text: say(
        "Обмен сразу. Свой ход остаётся свободным.",
        "Trade now. Keep your own action.",
      ),
      icon: ArrowRightLeft,
    },
    {
      kind: 1,
      title: say("Заказ работы", "Order work"),
      text: say(
        "Закрепить охрану, снабжение или ремонт.",
        "Bind guarding, supplies or repairs.",
      ),
      icon: Wrench,
    },
    {
      kind: 2,
      title: say("Общий проект", "Joint project"),
      text: say(
        "Соединить запасы и разделить результат.",
        "Pool inputs and share the output.",
      ),
      icon: Handshake,
    },
    {
      kind: 3,
      title: say("Доставка груза", "Cargo delivery"),
      text: say(
        "Закрепить груз партнёра и его доставку.",
        "Bind a partner’s cargo and delivery.",
      ),
      icon: Flag,
    },
  ].filter(
    (t) =>
      (t.kind !== 2 || [0, 2].includes(g.stage)) &&
      (t.kind !== 3 || g.stage === 5),
  );
  const names =
    language === "en"
      ? ["Water", "Tools", "Cargo"]
      : ["Вода", "Инструменты", "Груз"];
  const changeKind = (kind: number) => {
    onChange(defaultTerms(g, partner, kind));
    onBounty(undefined);
  };
  function changeProvider(provider: number) {
    onChange({
      ...p,
      provider,
      gives:
        p.kind === 1 || p.kind === 3
          ? provider === p.maker
            ? [
                [0, 0, 0],
                [1, 0, 0],
              ]
            : [
                [1, 0, 0],
                [0, 0, 0],
              ]
          : p.gives,
    });
    onBounty(undefined);
  }
  const resourceShortfalls = [p.maker, p.taker].flatMap((seat, i) =>
    model.reserve[i].flatMap((amount, r) =>
      Number.isFinite(amount) && amount > free(g.seats[seat])[r]
        ? [
            `${seat === g.seat ? say("Ты", "You") : g.seats[seat].name}: ${names[r]} — ${say("не хватает", "short by")} ${amount - free(g.seats[seat])[r]}`,
          ]
        : [],
    ),
  );
  const receiptTerms = bounty === undefined ? p : { ...p, job: bounty };
  return (
    <div className="pact-composer" aria-labelledby={languageId}>
      <header className="pc-heading" ref={heading}>
        <button className="pc-back" disabled={busy} onClick={onBack}>
          <ArrowLeft size={18} />
          {say("Спутники и предложения", "Partners and offers")}
        </button>
        <div>
          <span className="dp-kicker">
            {say("Свои условия", "Custom terms")}
          </span>
          <h3 id={languageId} ref={title} tabIndex={-1}>
            {say("Договор ·", "Pact ·")} {peer.name}
          </h3>
        </div>
      </header>
      <div className="pc-layout">
        <div className="pc-editor">
          <fieldset className="pc-section pc-kinds" disabled={locked}>
            <legend>
              <span>1</span>
              {say("Что хотите закрепить?", "What do you want to agree on?")}
            </legend>
            <div className="pc-kind-grid">
              {types.map((t) => {
                const Icon = t.icon;
                return (
                  <label key={t.kind} className="pc-kind-card">
                    <input
                      type="radio"
                      name={typeName}
                      checked={p.kind === t.kind}
                      onChange={() => changeKind(t.kind)}
                    />
                    <span className="pc-kind-icon">
                      <Icon size={20} />
                    </span>
                    <span>
                      <b>{t.title}</b>
                      <small>{t.text}</small>
                    </span>
                    <Check className="pc-kind-check" size={17} />
                  </label>
                );
              })}
            </div>
          </fieldset>
          {p.kind !== 0 && (
            <fieldset className="pc-section pc-work" disabled={locked}>
              <legend>
                <span>2</span>
                {say("Кто берёт работу?", "Who takes the work?")}
              </legend>
              <div className="pc-provider-grid">
                {[g.seat, partner].map((seat) => (
                  <label key={seat} className="pc-provider">
                    <input
                      type="radio"
                      name={providerName}
                      checked={p.provider === seat}
                      onChange={() => changeProvider(seat)}
                    />
                    <span>
                      {seat === g.seat ? say("Ты", "You") : peer.name}
                    </span>
                    <Check size={17} />
                  </label>
                ))}
              </div>
              {p.kind === 1 && (
                <label className="pc-select-label">
                  {say("Закреплённое действие", "Bound action")}
                  <select
                    disabled={locked}
                    value={p.action}
                    onChange={(e) => {
                      onChange({
                        ...p,
                        action: Number(e.target.value),
                        delivery: 0,
                      });
                      onBounty(undefined);
                    }}
                  >
                    {(g.stage === 5 ? [1] : [1, 2, 3]).map((id) => (
                      <option key={id} value={id}>
                        {words(
                          language,
                          actionContent(g.stage, id, 0, g.version).title,
                        )}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {p.kind === 1 && p.action === 2 && (
                <Amount
                  title={say("Новая вода заказчику", "New water for the payer")}
                  label=""
                  value={p.delivery}
                  max={3}
                  disabled={locked}
                  onChange={(delivery) => onChange({ ...p, delivery })}
                />
              )}
              {p.kind === 3 && (
                <>
                  <Amount
                    min={1}
                    title={say("Груз для города", "Cargo for the city")}
                    label={say(
                      "Свободно у исполнителя",
                      "Free for the provider",
                    )}
                    available={free(g.seats[p.provider])[2]}
                    value={p.delivery}
                    max={5}
                    disabled={locked}
                    onChange={(delivery) => onChange({ ...p, delivery })}
                  />
                  <p className="pc-help">
                    {say(
                      "Доставка занимает действие исполнителя. Груз уже должен принадлежать ему.",
                      "Delivery uses the provider’s action. The cargo must already belong to them.",
                    )}
                  </p>
                </>
              )}
            </fieldset>
          )}
          <fieldset className="pc-section pc-contributions" disabled={locked}>
            <legend>
              <span>{p.kind === 0 ? "2" : "3"}</span>
              {p.kind === 2
                ? say(
                    "Как разделите вложения?",
                    "How will you split the inputs?",
                  )
                : say(
                    "Что передаёте друг другу?",
                    "What will you give each other?",
                  )}
            </legend>
            {p.kind === 2 && (
              <div className="pc-recipe">
                <span>
                  <Droplets size={17} />
                  {recipe[0]}
                </span>
                <Plus size={14} />
                <span>
                  <Wrench size={17} />
                  {recipe[1]}
                </span>
                <ArrowRight size={17} />
                <b>
                  {g.stage === 0
                    ? say("8 воды", "8 water")
                    : say("6–8 груза", "6–8 cargo")}
                </b>
              </div>
            )}
            {p.kind === 2 && (
              <p className="pc-help">
                {say(
                  "Меняешь вклад одной стороны — остаток рецепта переходит другой. Результат делится поровну.",
                  "Change one side’s input and the rest shifts to the other. Output is split equally.",
                )}
              </p>
            )}
            <div className="pc-sides">
              {[g.seat, partner].map((seat, side) => {
                const available = free(g.seats[seat]),
                  isProvider =
                    p.kind !== 0 && p.kind !== 2 && p.provider === seat;
                return (
                  <section key={seat} className="pc-side">
                    <h4>
                      {seat === g.seat
                        ? say("Твоя сторона", "Your side")
                        : peer.name}
                    </h4>
                    {isProvider ? (
                      <div className="pc-provider-work">
                        <LockKeyhole size={22} />
                        <b>
                          {words(
                            language,
                            actionContent(g.stage, p.action, 0, g.version)
                              .title,
                          )}
                        </b>
                        <p>
                          {say(
                            "Действие закрепляется пактом. Оплата поступает от другой стороны.",
                            "The pact binds this action. Payment comes from the other side.",
                          )}
                        </p>
                        <span>
                          {say(
                            "Из своих запасов в резерв",
                            "Reserved from own supplies",
                          )}
                        </span>
                        <NamedSupplies
                          value={model.reserve[side]}
                          language={language}
                        />
                      </div>
                    ) : (
                      (p.kind === 2 ? [0, 1] : [0, 1, 2]).map((r) => {
                        const Icon = resourceIcons[r];
                        return (
                          <div className="pc-resource" key={r}>
                            <Icon size={19} />
                            <Amount
                              title={names[r]}
                              fieldName={`${seat === g.seat ? say("Твой вклад", "Your input") : peer.name} · ${names[r]}`}
                              label={say("Свободно", "Free")}
                              available={available[r]}
                              value={p.gives[side][r]}
                              max={p.kind === 2 ? recipe[r] : 5}
                              disabled={locked}
                              onChange={(value) =>
                                onChange(
                                  editContribution(p, side, r, value, recipe),
                                )
                              }
                            />
                          </div>
                        );
                      })
                    )}
                  </section>
                );
              })}
            </div>
          </fieldset>
          {(bounty !== undefined ||
            (g.stage === 1 &&
              p.kind === 1 &&
              p.action === 3 &&
              g.vault?.funded &&
              g.vault.active &&
              !g.seats[p.provider].npc)) && (
            <fieldset className="pc-section" disabled={locked}>
              <legend>
                <span>4</span>
                {say("Тестовая оплата за ремонт", "Test repair payment")}
              </legend>
              <label className="pc-select-label">
                {say(
                  "Задание из внесённого депозита",
                  "Job from the funded deposit",
                )}
                <select
                  value={bounty ?? ""}
                  disabled={locked}
                  onChange={(e) =>
                    onBounty(
                      e.target.value === ""
                        ? undefined
                        : Number(e.target.value),
                    )
                  }
                >
                  <option value="">
                    {say("Без TEST USDC", "No TEST USDC")}
                  </option>
                  {bounty !== undefined &&
                    !g.vault?.slots.some(
                      (s) => s.id === bounty && s.status === "open",
                    ) && (
                      <option value={bounty} disabled>
                        {say(
                          "Выбранное задание уже занято",
                          "Selected job is no longer available",
                        )}
                      </option>
                    )}
                  {(g.vault?.slots ?? [])
                    .filter((s) => s.status === "open")
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {say(
                          `Ремонт ${s.id + 1} · 10 TEST USDC`,
                          `Repair ${s.id + 1} · 10 TEST USDC`,
                        )}
                      </option>
                    ))}
                </select>
              </label>
              <p className="pc-help">
                {say(
                  "Без денежной стоимости. Получатель — владелец места исполнителя.",
                  "No monetary value. Payment goes to the provider’s seat owner.",
                )}
              </p>
            </fieldset>
          )}
        </div>
        <aside
          className="pc-review"
          aria-label={say("Проверка условий", "Review terms")}
        >
          <span className="dp-kicker">
            {say("Итог договора", "Pact summary")}
          </span>
          <PactTermsCard pact={receiptTerms} game={g} compact />
          <div className="pc-feedback" role="status" aria-live="polite">
            {error ? (
              <>
                <b>{say("Нужно исправить", "Needs a change")}</b>
                <p>
                  {p.gives
                    .flat()
                    .every((n) => Number.isInteger(n) && n >= 0 && n <= 5) &&
                  resourceShortfalls.length
                    ? resourceShortfalls.join(". ")
                    : words(language, error)}
                </p>
              </>
            ) : (
              <>
                <Check size={18} />
                <p>
                  {say(
                    "Условия готовы. Партнёр ещё должен принять предложение.",
                    "Terms are ready. Your partner still needs to accept.",
                  )}
                </p>
              </>
            )}
          </div>
          <button
            className="dp-primary pc-submit"
            disabled={locked || !!error}
            onClick={onSubmit}
          >
            {busy ? (
              <LoaderCircle size={20} className="pc-spin" />
            ) : (
              <Handshake size={20} />
            )}
            <span>
              {busy
                ? say("Отправляем…", "Sending…")
                : say("Предложить договор", "Propose pact")}
            </span>
            <ArrowRight size={19} />
          </button>
        </aside>
      </div>
    </div>
  );
}
