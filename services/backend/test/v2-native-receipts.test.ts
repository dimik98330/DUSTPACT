import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { asAddress } from "../src/security.ts";
import { database, migrate } from "../src/db.ts";
import { V2Chain } from "../src/v2-chain.ts";
import { reconcileV2 } from "../src/v2-indexer.ts";
import { missionBoardV2 } from "../src/v2-workboard.ts";
const enabled = process.env.DUSTPACT_V2_NATIVE_RECEIPTS === "1";
/** Read-only chain inspection of the root's existing completed campaign; no signatures. */
test(
  "actual completed V2 campaign indexes six retained receipts and paid/refunded mission separately from the primary genesis",
  { skip: !enabled, timeout: 90_000 },
  async () => {
    const report = JSON.parse(
      await readFile(
        new URL(
          "../../../tests/fixtures/native/v2/integration/native-campaign.json",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const url = new URL(report.rpc);
    assert.equal(url.protocol, "http:");
    assert.equal(url.hostname, "127.0.0.1");
    assert.equal(url.port, "19199");
    const chain = new V2Chain(url.href, report.genesis),
      match = asAddress(report.match),
      observed = await chain.read(match, "finalized");
    assert.equal(observed.game.phase, 5);
    assert.equal(observed.game.arrived, true);
    assert.equal(observed.game.history.filter((h) => h.complete).length, 6);
    assert.equal(observed.game.hull, 11);
    assert.ok(observed.mission);
    assert.deepEqual(
      observed.mission.slots.map((s) => s.status),
      [2, 3],
    );
    const paid = observed.game.history[1].jobs.find(
      (j) => j.slot === 0 && j.executed,
    );
    assert.ok(paid);
    assert.equal(paid.provider, 2);
    assert.equal(paid.owner, observed.mission.slots[0].owner);
    assert.equal(
      observed.game.seats[paid.provider].forfeited,
      true,
      "Missing reveal did not erase the retained paid job",
    );
    const board = missionBoardV2(
      observed.game,
      observed.mission,
      await chain.now(observed.slot),
    );
    assert.equal(board.slots[0].status, "paid");
    assert.equal(board.slots[1].status, "refunded");
    assert.equal(board.slots[0].canClaim, false);
    assert.equal(board.slots[1].canRefund, false);
    const databaseUrl =
      process.env.DUSTPACT_V2_TEST_DATABASE_URL ??
      "postgresql://dustpact@127.0.0.1:15433/dustpact_v2_test";
    const schema = `dustpact_v2_receipts_${randomUUID().replaceAll("-", "")}`,
      admin = database(databaseUrl);
    await admin.query(`CREATE SCHEMA "${schema}"`);
    const connection = new URL(databaseUrl);
    connection.searchParams.set("options", `-c search_path=${schema}`);
    const db = database(connection.href);
    await migrate(db);
    try {
      const financial = await reconcileV2(
        db,
        "localnet-v2-financial-fixture",
        chain,
      );
      const main = await reconcileV2(
        db,
        "localnet-v2",
        new V2Chain("http://127.0.0.1:19099"),
      );
      assert.notEqual(financial.genesis, main.genesis);
      assert.equal(
        (
          await db.query(
            "SELECT * FROM v2_stage_receipts WHERE network_key=$1 AND match_address=$2",
            [financial.genesis, match],
          )
        ).rowCount,
        6,
      );
      const jobs = await db.query(
        "SELECT * FROM v2_work_receipts WHERE network_key=$1 AND match_address=$2",
        [financial.genesis, match],
      );
      assert.equal(jobs.rowCount, 1);
      assert.equal(jobs.rows[0].executed, true);
      assert.equal(jobs.rows[0].owner_address, paid.owner);
      assert.deepEqual(
        (
          await db.query(
            "SELECT projection FROM v2_mission_projections WHERE network_key=$1 AND match_address=$2",
            [financial.genesis, match],
          )
        ).rows[0].projection.slots.map((s: any) => s.status),
        [2, 3],
      );
      await reconcileV2(
        db,
        "localnet-v2",
        new V2Chain("http://127.0.0.1:19099"),
        true,
      );
      assert.equal(
        (
          await db.query(
            "SELECT * FROM v2_stage_receipts WHERE network_key=$1 AND match_address=$2",
            [financial.genesis, match],
          )
        ).rowCount,
        6,
      );
      console.log(
        JSON.stringify({
          evidence: "native-v2-finalized-receipt-projection",
          match,
          genesis: observed.genesis,
          observedSlot: observed.slot.toString(),
          stages: 6,
          executedPaidProvider: paid.provider,
          statuses: ["paid", "refunded"],
          secondGenesis: main.genesis,
          signaturesSubmitted: 0,
        }),
      );
    } finally {
      await db.end();
      assert.match(schema, /^dustpact_v2_receipts_[0-9a-f]{32}$/);
      await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      await admin.end();
    }
  },
);
