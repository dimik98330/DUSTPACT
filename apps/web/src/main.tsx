import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/manrope/cyrillic-400.css";
import "@fontsource/manrope/cyrillic-600.css";
import "@fontsource/manrope/cyrillic-800.css";
import "@fontsource/manrope/latin-400.css";
import "@fontsource/manrope/latin-600.css";
import "@fontsource/manrope/latin-800.css";
import "@fontsource/literata/cyrillic-500.css";
import "@fontsource/literata/latin-500.css";
const GameRoot = React.lazy(() => import('./GameRoot'));
const ObserverRoot = React.lazy(() => import('./v2/ObserverRoot'));
const ObserverRootV3 = React.lazy(() => import('./v2/ObserverRootV3'));
const entryParams = new URLSearchParams(location.search);
const Entry = !['abi2','1'].includes(entryParams.get('version')??'') && entryParams.has('watch') ? (entryParams.get('version')==='2'?ObserverRoot:ObserverRootV3) : GameRoot;
import "./styles.css";
import { I18nProvider, useI18n } from "../../../packages/ui/src/i18n";
import "../../../packages/ui/src/language-toggle.css";
function ClientLoading() {
  const { t, tr, locale, language } = useI18n();
  return <div className="world-loader">{t("Загружаем клиент…")}</div>;
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <I18nProvider>
      <React.Suspense fallback={<ClientLoading />}>
        <Entry />
      </React.Suspense>
    </I18nProvider>
  </React.StrictMode>,
);
