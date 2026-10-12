import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { generateKeyPairSigner } from "@solana/kit";
import {
  V2Client,
  reviewConfig,
} from "../../../packages/solana-v2/src/index.ts";
import { database, migrate } from "../src/db.ts";
import { configV2 } from "../src/v2-config.ts";
import { V2Chain } from "../src/v2-chain.ts";
import { DurableV2Keeper } from "../src/v2-keeper.ts";
import { reconcileV2 } from "../src/v2-indexer.ts";
import { createV2Api } from "../src/v2-api.ts";
import { HttpError } from "../src/security.ts";
const enabled = process.env.DUSTPACT_V2_NATIVE_TESTS === "1";
/** Explicit generated local fixtures only. No user wallet, token funding or application submission. */
test(
  "native V2 RPC + PostgreSQL + HTTP: opted keeper phase, exact write-ahead signature, finalized cache and reconstruction",
  { skip: !enabled, timeout: 180_000 },
  async () => {
    const cfg = {
      ...configV2(),
      allowLocalSigning: true,
      databaseUrl:
        process.env.DUSTPACT_V2_TEST_DATABASE_URL ??
        "postgresql://dustpact@127.0.0.1:15433/dustpact_v2_test",
    };
    assert.ok(
      ["127.0.0.1", "localhost", "[::1]"].includes(
        new URL(cfg.rpcUrl).hostname,
      ),
    );
    const admin = database(cfg.databaseUrl),
      schema = `dustpact_v2_native_${randomUUID().replaceAll("-", "")}`;
    await admin.query(`CREATE SCHEMA "${schema}"`);
    const connection = new URL(cfg.databaseUrl);
    connection.searchParams.set("options", `-c search_path=${schema}`);
    const db = database(connection.href);
    await migrate(db);
    const chain = new V2Chain(cfg.rpcUrl),
      api = createV2Api(db, cfg, chain);
    await new Promise<void>((r) => api.server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${(api.server.address() as { port: number }).port}/api/v2`;
    const players: V2Client[] = [];
    const signer = await generateKeyPairSigner();
    try {
      for (let i = 0; i < 4; i++) {
        const player = new V2Client(await generateKeyPairSigner(), cfg.rpcUrl);
        await player.fundLocal();
        players.push(player);
      }
      const match = await players[0].create();
      console.log(
        JSON.stringify({ evidence: "native-v2-fixture-created", match }),
      );
      for (const p of players.slice(1)) await p.join(match);
      for (const p of players)
        await p.ready(match, await reviewConfig(match, await p.read(match)));
      await players[0].start(match);
      for (const p of players) await p.stageReady(match);
      const payer = new V2Client(signer, cfg.rpcUrl);
      await payer.fundLocal();
      const keeper = new DurableV2Keeper(db, cfg, chain, signer);
      const progressed = await keeper.tick([match]);
      assert.equal(progressed.sent, 1);
      const native = await chain.read(match);
      assert.equal(native.game.phase, 2);
      assert.equal(native.game.count, 4);
      const row = (
        await db.query(
          "SELECT * FROM v2_keeper_ledger WHERE match_address=$1",
          [match],
        )
      ).rows[0];
      assert.equal(row.state, "pending");
      assert.ok(row.signature);
      assert.match(row.message_hash, /^[0-9a-f]{64}$/);
      assert.ok(BigInt(row.last_valid_block_height) > 0n);
      const transactionStatus = (
        await chain.rpc
          .getSignatureStatuses([row.signature], {
            searchTransactionHistory: true,
          })
          .send()
      ).value[0];
      assert.equal(transactionStatus?.err, null);
      await keeper.tick([match]);
      assert.equal(
        (
          await db.query(
            "SELECT count(*)::int AS n FROM v2_keeper_ledger WHERE match_address=$1",
            [match],
          )
        ).rows[0].n,
        1,
      );
      const start = Date.now();
      for (;;) {
        try {
          if ((await chain.read(match, "finalized")).game.phase === 2) break;
        } catch (error) {
          if (
            !(error instanceof HttpError && error.code === "V2_MATCH_NOT_FOUND")
          )
            throw error; /* Confirmed creation may not yet exist at finalized. */
        }
        assert.ok(Date.now() - start < 90_000, "Finalized phase deadline");
        await new Promise((r) => setTimeout(r, 500));
      }
      const result = await reconcileV2(db, cfg.cluster, chain);
      assert.ok(result.matches > 0);
      const cached = (
        await db.query(
          "SELECT projection FROM v2_match_projections WHERE network_key=$1 AND address=$2",
          [result.genesis, match],
        )
      ).rows[0].projection;
      assert.equal(cached.phase, 2);
      const response = await fetch(`${base}/matches/${match}/proof`, {
        headers: { Origin: cfg.origins[0] },
      });
      const proof: any = await response.json();
      assert.equal(response.status, 200);
      assert.equal(proof.commitment, "finalized");
      assert.equal(proof.projection.phase, 2);
      assert.equal(proof.genesis, result.genesis);
      const boardResponse = await fetch(
        `${base}/matches/${match}/workboard?seat=0`,
        { headers: { Origin: cfg.origins[0] } },
      );
      const board: any = await boardResponse.json();
      assert.equal(boardResponse.status, 200);
      assert.equal(board.explanation.authority, "advisory-only");
      assert.equal(board.mission.funded, false);
      await reconcileV2(db, cfg.cluster, chain, true);
      assert.deepEqual(
        (
          await db.query(
            "SELECT projection FROM v2_match_projections WHERE network_key=$1 AND address=$2",
            [result.genesis, match],
          )
        ).rows[0].projection,
        cached,
      );
      keeper.stop();
      console.log(
        JSON.stringify({
          evidence: "native-v2-backend",
          match,
          genesis: result.genesis,
          observedSlot: result.slot,
          phase: 2,
          keeperSignature: row.signature,
          authority: "RPC observation, not backend authority",
          userKeysUsed: false,
          testOnly: true,
        }),
      );
    } finally {
      for (const p of players) p.cancelPendingSignatures();
      await api.close();
      await db.end();
      assert.match(schema, /^dustpact_v2_native_[0-9a-f]{32}$/);
      await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      await admin.end();
    }
  },
);
