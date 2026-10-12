import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  createTranslator,
  localizeText,
  resolveLanguage,
  LANGUAGE_STORAGE_KEY,
  type Language,
  type Translator,
} from "./locales/core";
export * from "./locales/core";
interface I18nContextValue {
  language: Language;
  locale: "ru-RU" | "en-US";
  t: Translator;
  tr(source: string): string;
  setLanguage(language: Language): void;
}
const defaults: I18nContextValue = {
  language: "ru",
  locale: "ru-RU",
  t: createTranslator("ru"),
  tr: (source) => localizeText(source, "ru"),
  setLanguage: () => {},
};
const I18nContext = createContext(defaults);
function initialPreference(): Language {
  if (typeof window === "undefined") return "ru";
  let persisted: unknown = null;
  try {
    persisted = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
  } catch {
    /* Language works in memory when storage is unavailable. */
  }
  return resolveLanguage(window.location.search, persisted);
}
export function I18nProvider({
  children,
  initialLanguage,
}: {
  children: ReactNode;
  initialLanguage?: Language;
}) {
  const [language, update] = useState<Language>(
    () => initialLanguage ?? initialPreference(),
  );
  useEffect(() => {
    document.documentElement.lang = language;
    try {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    } catch {
      /* No game state or authorization depends on this preference. */
    }
  }, [language]);
  const setLanguage = useCallback((next: Language) => {
    update(next);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("lang", next);
      window.history.replaceState(null, "", url);
    }
  }, []);
  const value = useMemo<I18nContextValue>(
    () => ({
      language,
      locale: language === "ru" ? "ru-RU" : "en-US",
      setLanguage,
      t: createTranslator(language),
      tr: (source) => localizeText(source, language),
    }),
    [language, setLanguage],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
export function useI18n() {
  return useContext(I18nContext);
}
export function LanguageToggle({ className = "" }: { className?: string }) {
  const { language, setLanguage, t } = useI18n();
  return (
    <fieldset className={`language-toggle ${className}`}>
      <legend>{t("Язык интерфейса")}</legend>
      <div>
        {(["ru", "en"] as const).map((value) => (
          <button
            key={value}
            type="button"
            lang={value}
            aria-pressed={language === value}
            onClick={() => setLanguage(value)}
          >
            {value === "ru" ? "Русский" : "English"}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
