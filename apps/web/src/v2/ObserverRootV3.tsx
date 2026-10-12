import { useEffect, useState } from 'react';
import { address } from '@solana/kit';
import { V3Reader } from '../../../../packages/solana-v3/src/reader';
import { LOCAL_RPC_V3 } from '../../../../packages/solana-v3/src/constants';
import { useI18n, LanguageToggle } from '../../../../packages/ui/src/i18n';
import { ObserverController } from './observer-v3';
import { expeditionLink } from './links';
import ObserverScreen from './ObserverScreenV3';
import '../v2.css';
import './observer.css';

/** Separate entry chunk: importing the observer does not initialize a wallet or local identity. */
export default function ObserverRoot(){
 const {language}=useI18n(),say=(ru:string,en:string)=>language==='en'?en:ru;
 const params=new URLSearchParams(location.search),match=params.get('watch')??'';
 const network=params.get('cluster')==='devnet'?'devnet':'local';
 const [target,setTarget]=useState(match),[controller,setController]=useState<ObserverController|null>(null),[error,setError]=useState('');
 useEffect(()=>{
  if(!match)return;
  let c:ObserverController|undefined;
  try{
   if(params.has('cluster')&&!['local','devnet'].includes(params.get('cluster')!))throw Error('Unknown spectator network');
   c=new ObserverController(address(match.trim()),new V3Reader(network==='local'?LOCAL_RPC_V3:'https://api.devnet.solana.com'));
   setController(c);c.start();
  }catch(e){setError(e instanceof Error?e.message:String(e));}
  return()=>c?.dispose();
 },[match,network]);
 if(controller)return <ObserverScreen controller={controller} network={network}/>;
 return <div className="v2-app v2-watch-entry"><header><b>DUSTPACT</b><LanguageToggle/></header><main><span className="v2-eyebrow">{say('Наблюдение · без кошелька','Spectator · no wallet')}</span><h1>{say('Посмотрите, как договор меняет путь','Watch a pact change the journey')}</h1><p>{say('Смотрите публичные запасы, обязательства и итоги экспедиции прямо из Solana. Движение в 3D показывает события; работу и выплату определяет программа.','See public supplies, obligations and expedition results directly from Solana. The 3D scene presents events; the program determines work and payout.')}</p><form onSubmit={e=>{e.preventDefault();try{location.assign(expeditionLink(location.href,address(target.trim()),network,true,3));}catch(err){setError(err instanceof Error?err.message:String(err));}}}><label htmlFor="watch-match">{say('Адрес матча V3','V3 match address')}</label><input id="watch-match" value={target} onChange={e=>setTarget(e.target.value)} required autoComplete="off" spellCheck={false}/><button className="v2-primary">{say('Смотреть экспедицию','Watch expedition')}</button></form>{error&&<p role="alert">{error}</p>}<a href="?version=3">{say('Выбрать игру','Choose a game')}</a></main></div>;
}
