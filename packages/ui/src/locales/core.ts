import { english, type MessageKey } from "./en";
export type Language = "ru" | "en";
export type TranslationValue = string | number | bigint;
export type TranslationParams = Record<string, TranslationValue>;
type Placeholder<K extends string> =
  K extends `${string}{${infer P}}${infer Rest}`
    ? P | Placeholder<Rest>
    : never;
type Arguments<K extends MessageKey> = [Placeholder<K>] extends [never]
  ? [params?: TranslationParams]
  : [params: Record<Placeholder<K>, TranslationValue>];
export type Translator = <K extends MessageKey>(
  key: K,
  ...args: Arguments<K>
) => string;
export const LANGUAGE_STORAGE_KEY = "dustpact.language.v1";
export function resolveLanguage(
  search = "",
  persisted: unknown = null,
): Language {
  const query = new URLSearchParams(search).get("lang");
  return query === "ru" || query === "en"
    ? query
    : persisted === "ru" || persisted === "en"
      ? persisted
      : "ru";
}
const isKey = (value: string): value is MessageKey =>
  Object.hasOwn(english, value);
const reverse = new Map<string, MessageKey>();
for (const [key, value] of Object.entries(english))
  if (!reverse.has(value)) reverse.set(value, key as MessageKey);
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const templates = Object.keys(english)
  .filter((key) => /\{\w+\}/.test(key))
  .map((key) => {
    const names = [...key.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
    const pattern = (text: string) =>
      new RegExp(
        "^" +
          text
            .split(/\{\w+\}/)
            .map(escape)
            .join("(.*?)") +
          "$",
      );
    return {
      key: key as MessageKey,
      names,
      englishNames: [...english[key as MessageKey].matchAll(/\{(\w+)\}/g)].map(
        (m) => m[1],
      ),
      ru: pattern(key),
      en: pattern(english[key as MessageKey]),
    };
  });
function exact(value: string, language: Language): string {
  if (isKey(value)) return language === "ru" ? value : english[value];
  const key = reverse.get(value);
  return key ? (language === "ru" ? key : english[key]) : value;
}
function format(
  key: MessageKey,
  params: TranslationParams,
  language: Language,
) {
  const message = language === "ru" ? key : english[key];
  return message.replace(/\{(\w+)\}/g, (token, name) =>
    Object.hasOwn(params, name)
      ? typeof params[name] === "string"
        ? exact(params[name] as string, language)
        : String(params[name])
      : token,
  );
}
export function createTranslator(language: Language): Translator {
  return ((key: MessageKey, params: TranslationParams = {}) =>
    format(key, params, language)) as Translator;
}
/** Presentation-only localization of known engine/SDK labels and previously stored UI messages.
 * Unknown technical errors and arbitrary text remain unchanged. Never apply this to chat content.
 */
export function localizeText(source: string, language: Language): string {
  const leading = source.match(/^\s*/)?.[0] ?? "",
    trailing = source.match(/\s*$/)?.[0] ?? "",
    text = source.trim();
  if (!text) return source;
  const direct = exact(text, language);
  if (direct !== text || isKey(text) || reverse.has(text))
    return leading + direct + trailing;
  for (const template of templates) {
    const russianMatch = template.ru.exec(text);
    const match = russianMatch ?? template.en.exec(text);
    if (match) {
      const params = Object.fromEntries(
        (russianMatch ? template.names : template.englishNames).map(
          (name, i) => [name, match[i + 1]],
        ),
      );
      return leading + format(template.key, params, language) + trailing;
    }
  }
  return source;
}
export { english };
export type { MessageKey };
