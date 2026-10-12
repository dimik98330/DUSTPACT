import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { readFile } from "node:fs/promises";
import {
  I18nProvider,
  LanguageToggle,
  useI18n,
  createTranslator,
  localizeText,
  resolveLanguage,
  english,
  type Language,
} from "../packages/ui/src/i18n";
import { V2_STAGES } from '../packages/engine/src/v2';
import { actionContent, names, seatLabel, words } from '../apps/web/src/v2/content';

test("i18n: Russian is the default and an explicit language query overrides the saved preference", () => {
  assert.equal(resolveLanguage(), "ru");
  assert.equal(resolveLanguage("?lang=en", "ru"), "en");
  assert.equal(resolveLanguage("?lang=ru", "en"), "ru");
  assert.equal(resolveLanguage("?lang=unsupported", "en"), "en");
  assert.equal(resolveLanguage("", null), "ru");
  assert.equal(resolveLanguage("", "en"), "en");
});
test("i18n: every hand-written English entry is present and preserves exact placeholders", () => {
  const placeholders = (s: string) =>
    [...new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();
  assert.ok(Object.keys(english).length >= 700);
  for (const [key, value] of Object.entries(english)) {
    assert.ok(value.trim(), key);
    assert.ok(!/[А-Яа-яЁё]/.test(value), `Untranslated English copy: ${key}`);
    assert.deepEqual(placeholders(value), placeholders(key), key);
  }
});
test("i18n: typed templates interpolate values and display canonical companion names in English", () => {
  const t = createTranslator("en");
  assert.equal(t("Подключить кошелёк"), "Connect wallet");
  assert.equal(
    t("Переход {value0} завершён.", { value0: 3 }),
    "Crossing 3 is complete.",
  );
  assert.match(
    t("{value0} выполнила охрану: +2 защиты. Плата — 2 воды.", {
      value0: "Айша",
    }),
    /^Aisha provided/,
  );
});
test("i18n: a stored UI notice can switch language in either direction", () => {
  const ru = "Караван потеряет 4 прочности",
    en = localizeText(ru, "en");
  assert.equal(en, "The caravan will lose 4 hull");
  assert.equal(localizeText(en, "ru"), ru);
  assert.equal(localizeText(" Адрес скопирован. ", "en"), " Address copied. ");
});
test("i18n: template recognition preserves named values when English reorders placeholders", () => {
  const source =
    "Следующий переход уже начался. На {phase} осталось {seconds} с." as const;
  const en = createTranslator("en")(source, { phase: "фиксацию", seconds: 25 });
  assert.equal(en, "The next crossing has begun. 25s remain for commit.");
  assert.equal(
    localizeText(en, "ru"),
    "Следующий переход уже начался. На фиксацию осталось 25 с.",
  );
});
test("i18n: unknown technical errors and arbitrary messages are preserved verbatim", () => {
  const raw = "RPC_CUSTOM_842: 8M3 / 0xdeadbeef <unknown>";
  assert.equal(localizeText(raw, "en"), raw);
  assert.equal(localizeText(raw, "ru"), raw);
  assert.equal(
    localizeText("Незнакомое сообщение игрока", "en"),
    "Незнакомое сообщение игрока",
  );
});
test("i18n: V2 display translations preserve canonical actions, inventories and stages", () => {
  const before=JSON.stringify({V2_STAGES,names});
  for(let stage=0;stage<6;stage++)for(let action=0;action<5;action++){
    const info=actionContent(stage,action,0);if(!info.available)continue;
    for(const text of [info.title,info.effect])assert.ok(!/[А-Яа-яЁё]/.test(words('en',text)));
  }
  for(const name of names)assert.ok(!/[А-Яа-яЁё]/.test(seatLabel(name,'en')));
  assert.equal(JSON.stringify({V2_STAGES,names}),before);
});
function Sample() {
  const { t } = useI18n();
  return createElement("p", null, t("Подключить кошелёк"));
}
const sample = (language?: Language) =>
  renderToStaticMarkup(
    createElement(I18nProvider, {
      initialLanguage: language,
      children: createElement(Sample),
    }),
  );
test("i18n: actual React context keeps SSR default Russian and supports English per provider", () => {
  assert.match(sample(), /Подключить кошелёк/);
  assert.match(sample("en"), /Connect wallet/);
  assert.match(sample("ru"), /Подключить кошелёк/);
});
test("i18n: the language switch uses real large buttons with explicit active state and native language labels", () => {
  const html = renderToStaticMarkup(
    createElement(I18nProvider, {
      initialLanguage: "en",
      children: createElement(LanguageToggle),
    }),
  );
  assert.match(html, /Interface language/);
  assert.match(html, /lang="en" aria-pressed="true"/);
  assert.match(html, /lang="ru" aria-pressed="false"/);
  assert.match(html, /Русский/);
  assert.match(html, /English/);
});
test("i18n: lobby and independent recovery copy is included for the shared client boundary", () => {
  assert.equal(
    localizeText("Независимый клиент восстановления", "en"),
    "Independent recovery client",
  );
  assert.equal(
    localizeText("Подтверждаем готовность", "en"),
    "Confirming readiness",
  );
  assert.equal(localizeText("Ставим печать", "en"), "Applying your seal");
  assert.equal(
    localizeText(
      "Цена и участники должны быть целыми допустимыми значениями",
      "en",
    ),
    "Price and party indexes must be valid integers",
  );
});
test("i18n: main game components contain no untranslated Russian JSX text or literal accessibility attributes", async () => {
  const files = [
    "apps/web/src/main.tsx",
    "apps/web/src/GameRoot.tsx",
    "apps/web/src/v2/GameScreen.tsx",
    "apps/web/src/v2/V2Root.tsx",
    "apps/web/src/v2/FirstPactGuide.tsx",
    "apps/web/src/v2/CityContribution.tsx",
    "apps/web/src/v2/ExpeditionDebrief.tsx",
    "apps/recovery/src/main.tsx",
    "apps/recovery/src/v2/App.tsx",
  ];
  for (const file of files) {
    const source = await readFile(
        new URL("../" + file, import.meta.url),
        "utf8",
      ),
      tree = ts.createSourceFile(
        file,
        source,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      );
    const missing: string[] = [];
    function visit(node: ts.Node) {
      if (ts.isJsxText(node) && /[А-Яа-яЁё]/.test(node.text))
        missing.push(node.text.trim());
      if (
        ts.isJsxAttribute(node) &&
        node.initializer &&
        ts.isStringLiteral(node.initializer) &&
        /[А-Яа-яЁё]/.test(node.initializer.text)
      )
        missing.push(node.initializer.text);
      ts.forEachChild(node, visit);
    }
    visit(tree);
    assert.deepEqual(missing, [], file);
  }
});
