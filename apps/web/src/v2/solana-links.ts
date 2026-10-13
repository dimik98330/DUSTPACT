export type SolanaNetwork = "practice" | "local" | "devnet";

/** On-chain game programs (protocol 2 preserved for old matches, protocol 3 current). */
export const GAME_PROGRAM: Record<2 | 3, string> = {
  2: "7Fs272UohH4jF53fwsdVk3E9t4KuDptdn6DcFyxbuARd",
  3: "EEs4JyRG3Cs84rtYq2rupywf6YHDW426oACzspsHE7Mm",
};

/** Public Solana Explorer link for an account, or null when the match never touches a chain. */
export function explorerAccountUrl(
  address: string,
  network: SolanaNetwork,
): string | null {
  if (!address || network === "practice") return null;
  const base = `https://explorer.solana.com/address/${encodeURIComponent(address)}`;
  return network === "devnet"
    ? `${base}?cluster=devnet`
    : `${base}?cluster=custom&customUrl=${encodeURIComponent("http://127.0.0.1:19409")}`;
}

export function explorerTxUrl(
  signature: string,
  network: SolanaNetwork,
): string | null {
  if (!signature || network === "practice") return null;
  const base = `https://explorer.solana.com/tx/${encodeURIComponent(signature)}`;
  return network === "devnet"
    ? `${base}?cluster=devnet`
    : `${base}?cluster=custom&customUrl=${encodeURIComponent("http://127.0.0.1:19409")}`;
}
