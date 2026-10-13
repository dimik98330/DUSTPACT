import {
  MISSION_AMOUNT,
  TOKEN,
} from "../../../../packages/solana-v3/src/constants";
export type TestFunding = {
  status: "checking" | "ready" | "unavailable";
  reason?: "mint" | "balance" | "rpc";
  balance?: string;
};
/** Advisory UI preflight. Reads the same RPC; never configures a mission or authorizes a transfer. */
export async function inspectTestFunding(
  readMint: () => Promise<{ owner: string; data: unknown } | null>,
  readBalance: () => Promise<bigint>,
): Promise<TestFunding> {
  try {
    const mint = await readMint();
    if (
      !mint ||
      mint.owner !== TOKEN ||
      !Array.isArray(mint.data) ||
      typeof mint.data[0] !== "string"
    )
      return { status: "unavailable", reason: "mint" };
    const bytes = Uint8Array.from(atob(mint.data[0]), (c) => c.charCodeAt(0));
    if (bytes.length !== 82 || bytes[44] !== 6 || bytes[45] !== 1)
      return { status: "unavailable", reason: "mint" };
    const amount = await readBalance();
    return amount >= MISSION_AMOUNT
      ? { status: "ready", balance: amount.toString() }
      : {
          status: "unavailable",
          reason: "balance",
          balance: amount.toString(),
        };
  } catch {
    return { status: "unavailable", reason: "rpc" };
  }
}
