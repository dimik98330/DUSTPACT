import { lazy, Suspense } from 'react';
import { useI18n } from '../../../packages/ui/src/i18n';
const V2Root=lazy(()=>import('./v2/V2Root'));
const V3Root=lazy(()=>import('./v2/V3Root'));
/** New parties use protocol3; explicit protocol2 links preserve their original rules. */
export default function GameRoot(){
 const {language}=useI18n(),say=(ru:string,en:string)=>language==='en'?en:ru;
 const version=new URLSearchParams(location.search).get('version');
 if(version==='abi2'||version==='1')return <main className="removed-version"><h1>DUSTPACT</h1><p>{say('Первая версия удалена из рабочего проекта. Эта ссылка относится к прежней игре.','The first version has been removed from the active project. This link belongs to the previous game.')}</p><a href="?version=3">{say('Открыть актуальную экспедицию','Open the current expedition')}</a></main>;
 const Entry=version==='2'?V2Root:V3Root;
 return <Suspense fallback={<div className="world-loader" role="status" aria-live="polite"><b>DUSTPACT</b><span>{say('Загружаем экспедицию…','Loading the expedition…')}</span></div>}><Entry onExit={()=>location.assign(location.pathname)}/></Suspense>;
}
