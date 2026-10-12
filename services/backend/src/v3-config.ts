import { config, type Config } from "./config.ts";
import { requireThat, asAddress } from "./security.ts";
export type V3Config = Config & { expectedGenesis?: string };
/** V3 service settings with shared authentication and budget bounds. */
export function configV3(): V3Config {
  const base = config();
  const rpcUrl = process.env.DUSTPACT_V3_RPC ?? "http://127.0.0.1:19809";
  const endpoint = new URL(rpcUrl),
    host = process.env.DUSTPACT_V3_HOST ?? "127.0.0.1";
  requireThat(
    ["127.0.0.1", "localhost", "::1"].includes(host),
    500,
    "V3_SERVICE_LOOPBACK_ONLY",
  );
  requireThat(
    !endpoint.username &&
      !endpoint.password &&
      !endpoint.hash &&
      (endpoint.protocol === "https:" ||
        (endpoint.protocol === "http:" &&
          ["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname))),
    500,
    "V3_RPC_CONFIG",
  );
  const port = Number(process.env.DUSTPACT_V3_PORT ?? 4197);
  requireThat(
    Number.isInteger(port) &&
      port > 0 &&
      port <= 65535 &&
      ![4180, 4182, 4183].includes(port),
    500,
    "V3_SERVICE_PORT",
  );
  const cluster = process.env.DUSTPACT_V3_CLUSTER ?? "localnet-v2";
  return {
    ...base,
    sponsorPort:Number(process.env.DUSTPACT_V3_FEE_PORT??4198),
    host,
    port,
    rpcUrl,
    cluster,
    databaseUrl: process.env.DUSTPACT_V3_DATABASE_URL ?? "postgresql://dustpact:dustpact_dev_only@127.0.0.1:15439/dustpact_v3",
    cookieName: base.production
      ? "__Host-dustpact-v3-session"
      : "dustpact_v3_session",
    allowLocalSigning:
      process.env.DUSTPACT_V3_ALLOW_LOCAL_SIGNING === "1" &&
      ["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname),
    expectedGenesis: process.env.DUSTPACT_V3_GENESIS
      ? asAddress(process.env.DUSTPACT_V3_GENESIS)
      : undefined,
  };
}
