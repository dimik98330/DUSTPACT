import { fileURLToPath } from "node:url";
export type Config = ReturnType<typeof config>;
export function config() {
  const production = process.env.NODE_ENV === "production";
  const origins = (
    process.env.DUSTPACT_ORIGINS ??
    "http://127.0.0.1:4173,http://127.0.0.1:4175,http://127.0.0.1:4174"
  ).split(",");
  for (const origin of origins) {
    const u = new URL(origin);
    if (
      u.origin !== origin ||
      (u.protocol !== "https:" &&
        !["127.0.0.1", "localhost"].includes(u.hostname))
    )
      throw Error("Invalid allowed origin");
    if (production && u.protocol !== "https:")
      throw Error("Production origins require HTTPS");
  }
  const rpcUrl = process.env.DUSTPACT_V2_RPC ?? "http://127.0.0.1:19809";
  const rpc = new URL(rpcUrl);
  if (
    rpc.protocol !== "https:" &&
    !["127.0.0.1", "localhost"].includes(rpc.hostname)
  )
    throw Error("RPC requires HTTPS");
  return {
    host: process.env.DUSTPACT_HOST ?? "127.0.0.1",
    port: Number(process.env.DUSTPACT_V2_PORT ?? 4194),
    sponsorPort: Number(process.env.DUSTPACT_V2_FEE_PORT ?? 4196),
    databaseUrl:
      process.env.DATABASE_URL ??
      "postgresql://dustpact:dustpact_dev_only@127.0.0.1:15439/dustpact_v2",
    cluster: process.env.DUSTPACT_V2_CLUSTER ?? "localnet-v2",
    origins,
    rpcUrl,
    production,
    cookieName: production ? "__Host-dustpact-v2-session" : "dustpact_v2_session",
    // This implementation deliberately supports generated local service identities only.
    allowLocalSigning:
      process.env.DUSTPACT_ALLOW_LOCAL_SIGNING === "1" &&
      ["127.0.0.1", "localhost"].includes(rpc.hostname),
    identityDir:
      process.env.DUSTPACT_IDENTITY_DIR ??
      fileURLToPath(
        new URL("../../../.runtime/backend/identities", import.meta.url),
      ),
    maxFee: 20_000n,
    dailyFeeBudget: 2_000_000n,
    maxRequests: 10_000,
    maxMatchTransactions: 384,
    maxMatchLamports: 384n * 20_000n,
    maxSponsoredMatches: 10_000,
  };
}
