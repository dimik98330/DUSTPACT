import type { Pool } from "pg";
import { transaction } from "./db.ts";
import { V2Chain, projectionV2, publicJsonV2 } from "./v2-chain.ts";
import {
  PROGRAM_V2,
  VAULT_PROGRAM,
  SYSTEM,
} from "../../../packages/solana-v2/src/index.ts";
import { log } from "./security.ts";
/** Rebuildable projections/receipts. No wallet authorization or financial settlement. */
export async function reconcileV2(
  db: Pool,
  cluster: string,
  chain: Pick<V2Chain, "scan">,
  rebuild = false,
) {
  const { matches, slot, genesis } = await chain.scan();
  await transaction(db, async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(60419743)");
    if (rebuild)
      for (const table of [
        "v2_match_projections",
        "v2_stage_receipts",
        "v2_work_receipts",
        "v2_mission_projections",
      ])
        await c.query(`DELETE FROM ${table} WHERE network_key=$1`, [genesis]);
    for (const row of matches) {
      const g = row.game,
        observed = row.slot.toString();
      const updated = await c.query(
        "INSERT INTO v2_match_projections(network_key,address,program_id,slot,revision,phase,stage,seat_count,projection) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(network_key,address) DO UPDATE SET slot=EXCLUDED.slot,revision=EXCLUDED.revision,phase=EXCLUDED.phase,stage=EXCLUDED.stage,seat_count=EXCLUDED.seat_count,projection=EXCLUDED.projection,observed_at=now() WHERE v2_match_projections.slot<=EXCLUDED.slot RETURNING address",
        [
          genesis,
          row.address,
          PROGRAM_V2,
          observed,
          g.revision.toString(),
          g.phase,
          g.stage,
          g.count,
          projectionV2(g),
        ],
      );
      if (!updated.rowCount) continue;
      for (const [stage, receipt] of g.history.entries()) {
        if (!receipt.complete) continue;
        await c.query(
          "INSERT INTO v2_stage_receipts(network_key,match_address,stage,slot,revision,receipt) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(network_key,match_address,stage) DO UPDATE SET slot=EXCLUDED.slot,revision=EXCLUDED.revision,receipt=EXCLUDED.receipt WHERE v2_stage_receipts.slot<=EXCLUDED.slot",
          [
            genesis,
            row.address,
            stage,
            observed,
            receipt.revision.toString(),
            publicJsonV2(receipt),
          ],
        );
        for (const [index, job] of receipt.jobs.entries()) {
          if (stage !== 1 || job.slot > 1 || job.owner === SYSTEM) continue;
          await c.query(
            "INSERT INTO v2_work_receipts(network_key,match_address,stage,job_index,provider,owner_address,slot,executed,receipt) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(network_key,match_address,stage,job_index) DO UPDATE SET provider=EXCLUDED.provider,owner_address=EXCLUDED.owner_address,slot=EXCLUDED.slot,executed=EXCLUDED.executed,receipt=EXCLUDED.receipt WHERE v2_work_receipts.slot<=EXCLUDED.slot",
            [
              genesis,
              row.address,
              stage,
              index,
              job.provider,
              job.owner,
              observed,
              job.executed,
              publicJsonV2(job),
            ],
          );
        }
      }
      if (row.mission)
        await c.query(
          "INSERT INTO v2_mission_projections(network_key,match_address,vault_program,slot,projection) VALUES($1,$2,$3,$4,$5) ON CONFLICT(network_key,match_address) DO UPDATE SET slot=EXCLUDED.slot,projection=EXCLUDED.projection,observed_at=now() WHERE v2_mission_projections.slot<=EXCLUDED.slot",
          [
            genesis,
            row.address,
            VAULT_PROGRAM,
            observed,
            publicJsonV2(row.mission),
          ],
        );
      else
        await c.query(
          "DELETE FROM v2_mission_projections WHERE network_key=$1 AND match_address=$2 AND slot<=$3",
          [genesis, row.address, observed],
        );
    }
    await c.query(
      "INSERT INTO v2_indexer_checkpoints(network_key,slot) VALUES($1,$2) ON CONFLICT(network_key) DO UPDATE SET slot=EXCLUDED.slot,observed_at=now() WHERE v2_indexer_checkpoints.slot<=EXCLUDED.slot",
      [genesis, slot.toString()],
    );
  });
  return {
    matches: matches.length,
    slot: slot.toString(),
    genesis,
    cluster,
    rebuilt: rebuild,
    schema: "dustpact-v2",
  };
}
export function runV2Indexer(
  db: Pool,
  cluster: string,
  chain: V2Chain,
  pollMs = 15_000,
) {
  let stopped = false,
    busy = false;
  const tick = async () => {
    if (stopped || busy) return;
    busy = true;
    try {
      const r = await reconcileV2(db, cluster, chain);
      log("v2_index_reconciled", { matches: r.matches, slot: r.slot });
    } catch {
      log("v2_index_reconcile_failed");
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(() => void tick(), Math.max(1500, pollMs));
  timer.unref();
  void tick();
  return async () => {
    stopped = true;
    clearInterval(timer);
    while (busy) await new Promise((r) => setTimeout(r, 30));
  };
}
