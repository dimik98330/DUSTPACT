import { generateKeyPairSigner } from "@solana/kit";
import { V2Client } from "../../../packages/solana-v2/src/index.ts";
import { database, migrate } from "./db.ts";
import { configV2 } from "./v2-config.ts";
import { V2Chain } from "./v2-chain.ts";
import { reconcileV2, runV2Indexer } from "./v2-indexer.ts";
import { DurableV2Keeper, runV2Keeper } from "./v2-keeper.ts";
import { log, requireThat } from "./security.ts";
const cfg = configV2(),
  mode = process.argv[2];
requireThat(
  ["indexer", "keeper", "rebuild"].includes(mode),
  400,
  "Choose indexer, keeper or rebuild",
);
const db = database(cfg.databaseUrl);
await migrate(db);
const chain = new V2Chain(cfg.rpcUrl, cfg.expectedGenesis);
if (mode === "rebuild") {
  try {
    const r = await reconcileV2(db, cfg.cluster, chain, true);
    log("v2_rebuilt", { matches: r.matches, slot: r.slot });
  } finally {
    await db.end();
  }
} else {
  let stop: () => Promise<void>;
  if (mode === "keeper") {
    requireThat(cfg.allowLocalSigning, 503, "V2_LOCAL_KEEPER_DISABLED");
    const signer = await generateKeyPairSigner();
    const fundingClient = new V2Client(signer, cfg.rpcUrl);
    await fundingClient.fundLocal();
    const keeper = new DurableV2Keeper(db, cfg, chain, signer);
    stop = runV2Keeper(keeper);
  } else stop = runV2Indexer(db, cfg.cluster, chain);
  // Keep the worker alive with an explicit lifecycle, never a detached unowned process.
  const live = setInterval(() => {}, 60_000);
  log("v2_worker_started", { mode, cluster: cfg.cluster });
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.once(signal, () => {
      clearInterval(live);
      void stop().finally(() => db.end());
    });
}
