/**
 * Maps internal wallet/program/RPC error strings to player-readable text.
 * Unknown errors pass through unchanged so real diagnostics are never hidden.
 */
const RULES: Array<{
  test: RegExp;
  ru: string;
  en: string;
}> = [
  {
    test: /another wallet owns this seat/i,
    ru: "Этот матч уже идёт, и место в нём занято другим кошельком. Открой матч тем же кошельком, с которого входил, или начни новую экспедицию.",
    en: "This match is already running and its seat belongs to another wallet. Open it with the wallet you joined with, or start a new expedition.",
  },
  {
    test: /program simulation rejected/i,
    ru: "Программа Solana отклонила действие ещё при проверке. Обычно открыт кошелёк, который не участвует в этом матче, или матч уже недоступен в этой сети.",
    en: "The Solana program rejected the action during its pre-check. Usually the connected wallet is not a player in this match, or the match is no longer available on this network.",
  },
  {
    test: /(user|wallet).{0,40}reject|reject.{0,30}(request|transaction|signing)|WalletSign/i,
    ru: "Подпись отменена в кошельке. Ничего не отправлено — когда будешь готов, подтверди действие ещё раз.",
    en: "Signing was cancelled in the wallet. Nothing was sent — confirm the action again when you are ready.",
  },
  {
    test: /awaiting a signature/i,
    ru: "Предыдущее действие ещё ждёт подтверждения. Дождись его завершения, прежде чем отправлять следующее.",
    en: "The previous action is still awaiting confirmation. Wait for it to finish before sending the next one.",
  },
  {
    test: /wallet not connected|no wallet|wallet standard.*not|not detected/i,
    ru: "Кошелёк не подключён. Для экспедиции в Solana подключи кошелёк; обучение и локальная партия работают без него.",
    en: "No wallet is connected. Connect a wallet for a Solana expedition; the tutorial and local games work without one.",
  },
  {
    test: /insufficient (funds|lamports|balance)/i,
    ru: "На кошельке не хватает тестовых SOL на комиссию сети. Пополни devnet-баланс из крана Solana и попробуй ещё раз.",
    en: "The wallet lacks test SOL for the network fee. Top up the devnet balance from a Solana faucet and try again.",
  },
  {
    test: /fetch failed|failed to fetch|network request|econnrefused|bad gateway|service unavailable/i,
    ru: "Не удалось связаться с сетью Solana или сервером игры. Проверь подключение и попробуй ещё раз; обучение работает без сервера.",
    en: "Could not reach the Solana network or the game server. Check your connection and retry; the tutorial works without a server.",
  },
  {
    test: /blockhash|block height exceeded/i,
    ru: "Состояние сети успело измениться, и действие устарело. Обнови состояние и отправь ход ещё раз.",
    en: "The network state moved on and the action expired. Refresh the state and submit the move again.",
  },
  {
    test: /unknown spectator network|invalid address|failed to decode.*address/i,
    ru: "Проверь адрес матча и выбранную сеть: по этим данным экспедиция не находится.",
    en: "Check the match address and the selected network: no expedition matches these details.",
  },
];

export function friendlyError(raw: string, language: string): string {
  if (!raw) return raw;
  for (const rule of RULES) {
    if (rule.test.test(raw)) return language === "en" ? rule.en : rule.ru;
  }
  return raw;
}
