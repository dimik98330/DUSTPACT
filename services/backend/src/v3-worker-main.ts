import { generateKeyPairSigner } from "@solana/kit";
import { V3Client } from "../../../packages/solana-v3/src/index.ts";
import { database, migrate } from "./db-v3.ts";
import { configV3 } from "./v3-config.ts";
import { V3Chain } from "./v3-chain.ts";
import { reconcileV3, runV3Indexer } from "./v3-indexer.ts";
import { DurableV3Keeper, runV3Keeper } from "./v3-keeper.ts";
import { log, requireThat } from "./security.ts";
const cfg = configV3(),
  mode = process.argv[2];
requireThat(
  ["indexer", "keeper", "rebuild"].includes(mode),
  400,
  "Choose indexer, keeper or rebuild",
);
const db = database(cfg.databaseUrl);
await migrate(db);
const chain = new V3Chain(cfg.rpcUrl, cfg.expectedGenesis);
if (mode === "rebuild") {
  try {
    const r = await reconcileV3(db, cfg.cluster, chain, true);
    log("v3_rebuilt", { matches: r.matches, slot: r.slot });
  } finally {
    await db.end();
  }
} else {
  let stop: () => Promise<void>;
  if (mode === "keeper") {
    requireThat(cfg.allowLocalSigning, 503, "V3_LOCAL_KEEPER_DISABLED");
    const signer = await generateKeyPairSigner();
    const fundingClient = new V3Client(signer, cfg.rpcUrl);
    await fundingClient.fundLocal();
    const keeper = new DurableV3Keeper(db, cfg, chain, signer);
    stop = runV3Keeper(keeper);
  } else stop = runV3Indexer(db, cfg.cluster, chain);
  // Keep the worker alive with an explicit lifecycle, never a detached unowned process.
  const live = setInterval(() => {}, 60_000);
  log("v3_worker_started", { mode, cluster: cfg.cluster });
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.once(signal, () => {
      clearInterval(live);
      void stop().finally(() => db.end());
    });
}
