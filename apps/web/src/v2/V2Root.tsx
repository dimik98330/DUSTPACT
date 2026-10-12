import { lazy, Suspense, useEffect, useState, useSyncExternalStore } from "react";
import { createClient } from '@solana/kit';
import { walletSigner } from '@solana/kit-plugin-wallet';
import { openOnline, publicPolicies } from './online';
import Modal from './Modal';
import type { GameController } from "./model";
import { createPracticeController } from "./practice";
import { TOUR_KEY } from './gameplay';
import { useI18n } from "../../../../packages/ui/src/i18n";
import "../v2.css";

const GameScreen = lazy(() => import("./GameScreen"));
const wallet = createClient().use(walletSigner({chain:'solana:devnet'}));

/**
 * V2 entry. Native Localnet is explicit-start and never imports user keys.
 * Practice (?mode=practice) uses Rust/Wasm without signatures or money.
 * The outer entry rejects explicit retired-version links without migrating old Matches.
 */
export default function V2Root({ onExit }: { onExit(): void }) {
  const { t, language } = useI18n();
  const say=(ru:string,en:string)=>language==='en'?en:ru;
  const params=new URLSearchParams(location.search), native=params.get('mode')!=='practice';
  const network=params.get('cluster')==='devnet'?'devnet':'local';
  const walletState=useSyncExternalStore(wallet.wallet.subscribe,wallet.wallet.getState);
  const [walletOpen,setWalletOpen]=useState(false),[starting,setStarting]=useState(false);
  const [controller, setController] = useState<GameController | null>(null);
  const [error, setError] = useState("");
  const [fees,setFees]=useState(false);
  const needsIntro=(()=>{try{return !localStorage.getItem(TOUR_KEY);}catch{return true;}})();
  useEffect(() => {
    if(native)return;
    let live = true;
    let built: GameController | null = null;
    createPracticeController(4)
      .then((c) => {
        if (live) {
          built = c;
          setController(c);
        } else c.dispose();
      })
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
      built?.dispose();
    };
  }, [native]);
  useEffect(()=>()=>controller?.dispose(),[controller]);
  async function startOnline(){
    if(starting)return;setStarting(true);setError('');
    try{
      const c=await openOnline({network,signer:network==='devnet'?(walletState.connected?.signer??undefined):undefined,match:params.get('match')??undefined,agents:!params.has('match')&&network==='local'&&params.get('agents')!=='0',count:4,fees});
      setController(c);const u=new URL(location.href);u.searchParams.set('match',c.snapshot().match);u.searchParams.set('version','2');u.searchParams.set('cluster',network);history.replaceState(null,'',u);
    }catch(e){setError(e instanceof Error?e.message:String(e));}finally{setStarting(false);}
  }
  if(native&&!params.has('match')&&!controller)return <div className="v2-app"><section className="v2-lobby"><h1>DUSTPACT</h1><p>{say('Этот клиент сохраняет прежние матчи. Новые экспедиции открываются с обновлёнными правилами доставки.','This client preserves existing matches. New expeditions use the updated delivery rules.')}</p><a className="v2-primary" href="?version=3">{say('Начать актуальную экспедицию','Start the current expedition')}</a></section></div>;
  const walletDialog=walletOpen&&<Modal title={say('Подключение кошелька','Wallet connection')} closeLabel={say('Закрыть','Close')} onClose={()=>setWalletOpen(false)}>
    <p>{say('Кошелёк подтверждает состав, условия договора и отдельное внесение тестовой оплаты. Игровая сессия не может списывать ваши токены.','The wallet approves the roster, pact terms and a separate test-payment deposit. A game session cannot debit your tokens.')}</p>
    {walletState.connected?<><code>{walletState.connected.account.address}</code><button onClick={()=>void wallet.wallet.disconnect().then(()=>{controller?.dispose();setController(null);})}>{say('Отключить кошелёк','Disconnect wallet')}</button></>:walletState.wallets.map(w=><button key={w.name} disabled={starting} onClick={()=>void wallet.wallet.connect(w).then(()=>setWalletOpen(false)).catch(e=>setError(e instanceof Error?e.message:String(e)))}>{w.name}</button>)}
    {!walletState.connected&&!walletState.wallets.length&&<p>{say('Wallet Standard кошелёк не найден в этом браузере. Локальная экспедиция использует явно обозначенный тестовый профиль.','No Wallet Standard wallet was detected. Local expeditions use an explicitly identified test profile.')}</p>}
  </Modal>;
  if(native&&!controller)return <div className="v2-app"><section className="v2-lobby"><span className="v2-eyebrow">DUSTPACT V2 · {network==='local'?'LOCALNET':'DEVNET'}</span><h1>{say('Договоры, которые меняют путь','Pacts that change your journey')}</h1><p>{say('У каждого свои запасы и интересы. Один договор закрепляет помощь; остальные обещания остаются выбором доверия.','Each player has different supplies and interests. One pact binds cooperation; other promises remain a matter of trust.')}</p><p>{network==='local'?say('Локальная Solana: реальная программа, тестовые профили и средства без денежной стоимости. Спутники явно обозначены как агенты.','Local Solana: actual programs, test identities and valueless fixture assets. Companions are clearly identified as agents.'):say('Devnet: внешний кошелёк. Подписи доступны только после проверки опубликованных Game и Vault.','Devnet: external wallet. Signing requires verified Game and Vault deployments.')}</p>{error&&<p role="alert">{error}</p>}{network==='local'&&<label className="v2-session-entry"><input type="checkbox" checked={fees} onChange={e=>setFees(e.target.checked)} disabled={starting}/> {say("Тестовый организатор оплачивает комиссию","Test organizer pays network fees")}<small>{say("Отдельная подпись входа в сервис; токены и депозиты счетов оплачивает владелец. Если сервис недоступен, снимите выбор для самостоятельной оплаты.","Separate service sign-in; wallet tokens and account deposits remain owner-funded. Uncheck to choose self-pay when the service is unavailable.")}</small></label>}<div className="v2-button-row">{!params.has('match')&&<button className={needsIntro?'v2-primary':''} onClick={()=>location.assign('?version=2&mode=practice&tutorial=1')}>{say('Первый договор · обучение','Your first pact · learn to play')}</button>}<button className={needsIntro&&!params.has('match')?'':'v2-primary'} disabled={starting||network==='devnet'&&(!walletState.connected||!publicPolicies())} onClick={()=>void startOnline()}>{starting?say('Открываем экспедицию…','Opening expedition…'):params.has('match')?say('Вернуться в этот матч','Resume this match'):say('Начать экспедицию','Start expedition')}</button>{network==='devnet'&&<button onClick={()=>setWalletOpen(true)}>{say('Подключить кошелёк','Connect wallet')}</button>}{network==='local'&&!params.has('match')&&params.get('agents')!=='0'&&<a className="v2-learn-link" href="?version=2&cluster=local&agents=0">{say('Играть с друзьями · 4–6 участников','Play with friends · 4–6 players')}</a>}<button onClick={()=>location.assign('?version=2&mode=practice&tutorial=0')}>{say('Практика без подписей','Practice without signing')}</button></div>{walletDialog}</section></div>;
  if (error)
    return (
      <div
        className="v2-app"
        role="alert"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <div style={{ maxWidth: 440, textAlign: "center" }}>
          <h2>{t("Не удалось запустить V2")}</h2>
          <p>{error}</p>
          <button className="v2-primary" onClick={onExit}>
            {t("Вернуться к игре")}
          </button>
        </div>
      </div>
    );
  if (!controller)
    return (
      <div className="v2-app" role="status" aria-live="polite">
        <div className="v2-scene-loading">
          <span className="v2-spinner" />
          {t("Готовим экспедицию V2…")}
        </div>
      </div>
    );
  return (
    <Suspense
      fallback={
        <div className="v2-app" role="status" aria-live="polite">
          <div className="v2-scene-loading">
            <span className="v2-spinner" />
            {t("Готовим экспедицию V2…")}
          </div>
        </div>
      }
    >
      <GameScreen controller={controller} onExit={onExit} onWallet={() => setWalletOpen(true)} />
      {walletDialog}
    </Suspense>
  );
}
