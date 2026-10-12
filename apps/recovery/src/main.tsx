import { createRoot } from 'react-dom/client';
import { lazy, Suspense } from 'react';
import { I18nProvider, useI18n } from '../../../packages/ui/src/i18n';
import '../../../packages/ui/src/language-toggle.css';
const RecoveryApp=lazy(()=>new URLSearchParams(location.search).get('version')==='2'?import('./v2/App'):import('./v3/App'));
function Loading(){const {language}=useI18n();return <p role="status">{language==='en'?'DUSTPACT · loading recovery…':'DUSTPACT · загрузка восстановления…'}</p>;}
createRoot(document.getElementById('root')!).render(<I18nProvider><Suspense fallback={<Loading/>}><RecoveryApp/></Suspense></I18nProvider>);
