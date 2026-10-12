import { config, type Config } from "./config.ts";
import { requireThat, asAddress } from "./security.ts";
export type V2Config = Config & { expectedGenesis?: string };
/** V2 service settings with shared authentication and budget bounds. */
export function configV2(): V2Config {
  const base = config();
  const rpcUrl = process.env.DUSTPACT_V2_RPC ?? "http://127.0.0.1:19809";
  const endpoint = new URL(rpcUrl),
    host = process.env.DUSTPACT_V2_HOST ?? "127.0.0.1";
  requireThat(
    ["127.0.0.1", "localhost", "::1"].includes(host),
    500,
    "V2_SERVICE_LOOPBACK_ONLY",
  );
  requireThat(
    !endpoint.username &&
      !endpoint.password &&
      !endpoint.hash &&
      (endpoint.protocol === "https:" ||
        (endpoint.protocol === "http:" &&
          ["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname))),
    500,
    "V2_RPC_CONFIG",
  );
  const port = Number(process.env.DUSTPACT_V2_PORT ?? 4194);
  requireThat(
    Number.isInteger(port) &&
      port > 0 &&
      port <= 65535 &&
      ![4180, 4182, 4183].includes(port),
    500,
    "V2_SERVICE_PORT",
  );
  const cluster = process.env.DUSTPACT_V2_CLUSTER ?? "localnet-v2";
  return {
    ...base,
    host,
    port,
    rpcUrl,
    cluster,
    databaseUrl: process.env.DUSTPACT_V2_DATABASE_URL ?? base.databaseUrl,
    cookieName: base.production
      ? "__Host-dustpact-v2-session"
      : "dustpact_v2_session",
    allowLocalSigning:
      process.env.DUSTPACT_V2_ALLOW_LOCAL_SIGNING === "1" &&
      ["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname),
    expectedGenesis: process.env.DUSTPACT_V2_GENESIS
      ? asAddress(process.env.DUSTPACT_V2_GENESIS)
      : undefined,
  };
}
