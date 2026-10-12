import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { WebSocket } from "ws";
import {
  generateKeyPairSigner,
  getBase58Decoder,
  type KeyPairSigner,
  type Address,
} from "@solana/kit";
import { database, migrate } from "../src/db-v3.ts";
import { configV3 } from "../src/v3-config.ts";
import { V3Chain } from "../src/v3-chain.ts";
import { createV3Api } from "../src/v3-api.ts";
import { reconcileV3 } from "../src/v3-indexer.ts";
import { DurableV3Keeper } from "../src/v3-keeper.ts";
import {
  PROGRAM_V3,
  VAULT_PROGRAM,
  RULES_HASH,
  CONTENT_HASH,
  SYSTEM,
  missionAddress,
  type Mission,
  type ClientOptions,
} from "../../../packages/solana-v3/src/index.ts";
import { gameFixtureV3, genesisFixtureV3 } from "./v3-fixtures.ts";
const enabled = process.env.DUSTPACT_V3_DATABASE_TESTS === "1";
test(
  "V3 PostgreSQL/HTTP/WS projection, membership, restart and write-ahead keeper regressions",
  { skip: !enabled, timeout: 120_000 },
  async (t) => {
    const cfg = {
      ...configV3(),
      allowLocalSigning: true,
      databaseUrl:
        process.env.DUSTPACT_V3_TEST_DATABASE_URL ??
        "postgresql://dustpact@127.0.0.1:15434/dustpact_v3_test",
    };
    const schema = `dustpact_v3_test_${randomUUID().replaceAll("-", "")}`,
      admin = database(cfg.databaseUrl);
    await admin.query(`CREATE SCHEMA "${schema}"`);
    const connection = new URL(cfg.databaseUrl);
    connection.searchParams.set("options", `-c search_path=${schema}`);
    const db = database(connection.href);
    await migrate(db);
    const keys = await Promise.all(
      Array.from({ length: 6 }, () => generateKeyPairSigner()),
    );
    const { game, match } = await gameFixtureV3(
      keys.slice(0, 4).map((k) => k.address),
    );
    const [mission, bump] = await missionAddress(match);
    game.mission = mission;
    game.missionRoster = game.roster;
    game.eligibleMask = 15;
    const funded: Mission = {
      game: match,
      sponsor: keys[0].address,
      bump,
      roster: game.roster,
      rulesHash: RULES_HASH,
      contentHash: CONTENT_HASH,
      eligibleMask: 15,
      fundedAt: 1000n,
      slots: [
        { status: 1, provider: 1, nonce: 2, owner: keys[1].address },
        { status: 0, provider: 0, nonce: 0, owner: SYSTEM },
      ],
    };
    let slot = 100n;
    const chain = new V3Chain(cfg.rpcUrl);
    chain.genesis = async () => genesisFixtureV3;
    chain.read = async (_match, commitment = "confirmed") => {
      assert.equal(_match, match);
      return {
        game,
        mission: funded,
        genesis: genesisFixtureV3,
        slot,
        commitment,
      };
    };
    chain.now = async () => 1000;
    chain.scan = async () => ({
      matches: [{ address: match, game, mission: funded, slot }],
      slot,
      genesis: genesisFixtureV3,
    });
    chain.health = async () => ({
      genesis: genesisFixtureV3,
      slot,
      game: true,
      vault: true,
      token: true,
      testMint: true,
      immutable: "not-verified-by-this-service",
    });
    let api = createV3Api(db, cfg, chain);
    await new Promise<void>((resolve) =>
      api.server.listen(0, "127.0.0.1", resolve),
    );
    let originUrl = `http://127.0.0.1:${(api.server.address() as { port: number }).port}`;
    const origin = cfg.origins[0];
    type Login = { cookie: string; csrf: string; key: KeyPairSigner };
    const sockets: WebSocket[] = [];
    async function call(
      path: string,
      value?: unknown,
      login?: Login,
      extra: Record<string, string> = {},
    ) {
      const response = await fetch(`${originUrl}/api/v2${path}`, {
        method: value === undefined ? "GET" : "POST",
        headers: {
          Origin: origin,
          ...(value === undefined
            ? {}
            : { "content-type": "application/json" }),
          ...(login
            ? { cookie: login.cookie, "x-csrf-token": login.csrf }
            : {}),
          ...extra,
        },
        body: value === undefined ? undefined : JSON.stringify(value),
      });
      return { response, data: (await response.json()) as any };
    }
    async function login(key: KeyPairSigner) {
      const challenge = (
        await call("/auth/challenge", {
          address: key.address,
          origin,
          cluster: cfg.cluster,
        })
      ).data;
      const signature = Buffer.from(
        await crypto.subtle.sign(
          "Ed25519",
          key.keyPair.privateKey,
          Buffer.from(challenge.message),
        ),
      ).toString("base64");
      const { response, data } = await call("/auth/verify", {
        challengeId: challenge.challengeId,
        signature,
      });
      assert.equal(response.status, 200);
      return {
        cookie: response.headers.get("set-cookie")!.split(";")[0],
        csrf: data.csrfToken,
        key,
      };
    }
    try {
      await t.test(
        "fresh V3 migrations, durable finalized receipts and canonical rebuild preserve other networks",
        async () => {
          assert.equal((await db.query("SELECT tablename FROM pg_tables WHERE schemaname=current_schema() AND tablename IN ('match_projections','chat_messages')")).rowCount,0,'Fresh V3 schemas do not require legacy tables');
          game.phase = 1;
          game.stage = 2;
          game.revision = 3n;
          game.history[0].complete = true;
          game.history[0].hull = 12;
          game.history[0].revision = 1n;
          game.history[1].complete = true;
          game.history[1].hull = 12;
          game.history[1].revision = 2n;
          game.history[1].jobs[0] = {
            slot: 0,
            provider: 1,
            nonce: 2,
            owner: keys[1].address,
            executed: true,
          };
          await reconcileV3(db, cfg.cluster, chain);
          const before = (
            await db.query(
              "SELECT projection FROM v3_match_projections WHERE network_key=$1 AND address=$2",
              [genesisFixtureV3, match],
            )
          ).rows[0].projection;
          assert.equal(
            (await db.query("SELECT * FROM v3_stage_receipts")).rowCount,
            2,
          );
          assert.equal(
            (await db.query("SELECT * FROM v3_work_receipts")).rowCount,
            1,
          );
          assert.equal(
            (await db.query("SELECT * FROM v3_mission_projections")).rowCount,
            1,
          );
          slot = 99n;
          game.hull = 1;
          await reconcileV3(db, cfg.cluster, chain);
          assert.deepEqual(
            (await db.query("SELECT projection FROM v3_match_projections"))
              .rows[0].projection,
            before,
          );
          slot = 100n;
          game.hull = 12;
          await db.query(
            "INSERT INTO v3_match_projections(network_key,address,program_id,slot,revision,phase,stage,seat_count,projection) VALUES($1,$2,$3,1,1,0,0,4,$4)",
            [keys[4].address, match, PROGRAM_V3, { otherNetwork: true }],
          );
          await reconcileV3(db, cfg.cluster, chain, true);
          assert.deepEqual(
            (
              await db.query(
                "SELECT projection FROM v3_match_projections WHERE network_key=$1",
                [genesisFixtureV3],
              )
            ).rows[0].projection,
            before,
          );
          assert.equal(
            (
              await db.query(
                "SELECT * FROM v3_match_projections WHERE network_key=$1",
                [keys[4].address],
              )
            ).rowCount,
            1,
          );
          await assert.rejects(
            reconcileV3(
              db,
              cfg.cluster,
              {
                scan: async () => {
                  throw Error("RPC unavailable");
                },
              },
              true,
            ),
          );
          assert.equal(
            (await db.query("SELECT * FROM v3_stage_receipts")).rowCount,
            2,
          );
        },
      );
      const owner = await login(keys[0]),
        other = await login(keys[1]),
        outsider = await login(keys[4]);
      let room: string;
      await t.test(
        "HTTP origin, auth/CSRF, canonical observations and advisory labels are distinct from authority",
        async () => {
          assert.equal((await call("/health/ready")).response.status, 200);
          const state = await call(`/matches/${match}/state`);
          assert.equal(state.response.status, 200);
          assert.equal(state.data.commitment, "confirmed");
          assert.equal(state.data.authority, "validated-rpc-observation");
          const proof = await call(`/matches/${match}/proof`);
          assert.equal(proof.data.commitment, "finalized");
          assert.equal(proof.data.kind, "canonical-replay-material");
          assert.equal(
            (await call(`/matches/${match}/proof?commitment=confirmed`))
              .response.status,
            400,
          );
          const board = await call(`/matches/${match}/workboard?seat=0`);
          assert.equal(board.data.authority, "advisory-only");
          assert.equal(board.data.explanation.authority, "advisory-only");
          assert.equal(board.data.mission.slots[0].canClaim, true);
          assert.equal(
            (await call(`/matches/${match}/workboard?seat=6`)).response.status,
            400,
          );
          assert.equal(
            (
              await call("/version", undefined, undefined, {
                Origin: "http://bad.example",
              })
            ).response.status,
            403,
          );
          assert.equal(
            (await call("/rooms", { matchAddress: match, title: "No auth" }))
              .response.status,
            401,
          );
          assert.equal(
            (
              await call(
                "/rooms",
                { matchAddress: match, title: "CSRF wrong" },
                owner,
                { "x-csrf-token": "bad" },
              )
            ).response.status,
            403,
          );
          assert.equal(
            (
              await call(
                "/rooms",
                {
                  matchAddress: match,
                  title: "Unknown secret",
                  salt: "not-stored",
                },
                owner,
              )
            ).response.status,
            400,
          );
          assert.equal(
            (
              await call(
                "/rooms",
                {
                  matchAddress: match,
                  title: "Foreign creator",
                  keeperEnabled: true,
                },
                other,
              )
            ).response.status,
            403,
          );
          assert.equal(
            (
              await call(
                "/rooms",
                { matchAddress: match, title: "Outsider" },
                outsider,
              )
            ).response.status,
            403,
          );
          const made = await call(
            "/rooms",
            {
              matchAddress: match,
              title: "V3 negotiation",
              keeperEnabled: true,
            },
            owner,
          );
          assert.equal(made.response.status, 200);
          room = made.data.id;
          assert.equal(
            (await call(`/rooms/${room}/keeper`, { enabled: false }, owner))
              .data.keeperEnabled,
            false,
          );
          assert.equal(
            (await call(`/rooms/${room}/keeper`, { enabled: true }, other))
              .response.status,
            403,
          );
          for (const invalid of [
            "9223372036854775808",
            "9999999999999999999",
            "01",
            "-1",
          ]) {
            assert.equal(
              (
                await call(
                  `/rooms/${room}/messages?before=${invalid}`,
                  undefined,
                  owner,
                )
              ).response.status,
              400,
            );
            assert.equal(
              (
                await call(
                  `/rooms/${room}/moderate`,
                  { messageId: invalid },
                  owner,
                )
              ).response.status,
              400,
            );
            assert.equal(
              (
                await call(
                  "/reports",
                  { roomId: room, messageId: invalid, reason: "Out of range" },
                  owner,
                )
              ).response.status,
              400,
            );
          }
          assert.equal(
            (
              await call(
                `/rooms/${room}/messages?before=9223372036854775807`,
                undefined,
                owner,
              )
            ).response.status,
            200,
          );
        },
      );
      await t.test(
        "bounded V3 chat persists ordinary negotiation and revokes delegated membership",
        async () => {
          const ticket = await call(`/rooms/${room}/ticket`, {}, owner);
          assert.equal(ticket.response.status, 200);
          const ws = new WebSocket(
            `${originUrl.replace("http:", "ws:")}/api/v2/rooms/${room}/socket?ticket=${ticket.data.ticket}`,
            { headers: { Origin: origin, Cookie: owner.cookie } },
          );
          sockets.push(ws);
          await once(ws, "open");
          const received = new Promise<any>((resolve, reject) => {
            const timeout = setTimeout(
              () => reject(Error("Chat message not observed")),
              5000,
            );
            ws.on("message", (raw) => {
              const data = JSON.parse(raw.toString());
              if (data.type === "message") {
                clearTimeout(timeout);
                resolve(data);
              }
            });
          });
          ws.send(
            JSON.stringify({
              type: "message",
              text: "Can you provide the bridge repair if I pay one water?",
            }),
          );
          assert.equal((await received).message.address, owner.key.address);
          const messages = await call(
            `/rooms/${room}/messages`,
            undefined,
            other,
          );
          assert.equal(messages.data.messages.length, 1);
          game.seats[0].session = keys[4].address;
          game.seats[0].quota = 2;
          game.seats[0].expires = 2000n;
          const delegated = await call(`/rooms/${room}/ticket`, {}, outsider);
          assert.equal(delegated.response.status, 200);
          const delegatedSocket = new WebSocket(
            `${originUrl.replace("http:", "ws:")}/api/v2/rooms/${room}/socket?ticket=${delegated.data.ticket}`,
            { headers: { Origin: origin, Cookie: outsider.cookie } },
          );
          sockets.push(delegatedSocket);
          await once(delegatedSocket, "open");
          const closed = once(delegatedSocket, "close");
          game.seats[0].quota = 0;
          await api.chat.broadcast(room, { type: "test-recheck" });
          assert.equal((await closed)[0], 1008);
          const duplicate = await call(`/rooms/${room}/ticket`, {}, outsider);
          assert.equal(duplicate.response.status, 403);
          game.seats[0].session = SYSTEM;
          await call("/auth/logout", {}, owner);
          assert.equal(
            (await call("/auth/session", undefined, owner)).response.status,
            401,
          );
        },
      );
      await t.test(
        "service restart preserves projections, receipts and chat while reusing authenticated context safely",
        async () => {
          await api.close();
          api = createV3Api(db, cfg, chain);
          await new Promise<void>((r) => api.server.listen(0, "127.0.0.1", r));
          originUrl = `http://127.0.0.1:${(api.server.address() as { port: number }).port}`;
          assert.equal(
            (await call(`/matches/${match}/cache`)).data.projection.stage,
            2,
          );
          assert.equal(
            (await call(`/rooms/${room}/messages`, undefined, other)).data
              .messages.length,
            1,
          );
        },
      );
      await t.test(
        "keeper stores exact signature/lifetime before transport and restart never re-signs unknown or rolled-back confirmation",
        async () => {
          game.stage = 0;
          game.phase = 1;
          game.revision = 20n;
          game.seats.slice(0, 4).forEach((s) => (s.planningReady = true));
          const sig = getBase58Decoder().decode(new Uint8Array(64).fill(9));
          let status: any = null,
            height = 90n,
            transports = 0;
          Object.defineProperty(chain, "rpc", {
            value: {
              getSignatureStatuses: () => ({
                send: async () => ({ value: [status] }),
              }),
              getBlockHeight: () => ({ send: async () => height }),
            },
          });
          const factory = (options: ClientOptions) => ({
            reconcilePending: async () => [],
            pending: async () => [],
            cancelPendingSignatures() {},
            resolve: async () => null,
            advance: async () => {
              await options.beforeSubmit!({
                program: PROGRAM_V3,
                genesis: genesisFixtureV3,
                actor: keys[5].address,
                match,
                signature: sig as any,
                intentHash: "ab".repeat(32),
                lastValidBlockHeight: 100n,
                feeLamports: 5000n,
                createdAt: Date.now(),
                status: "pending",
              });
              const row = (
                await db.query(
                  "SELECT * FROM v3_keeper_ledger WHERE signature=$1",
                  [sig],
                )
              ).rows[0];
              assert.equal(row.state, "pending");
              assert.equal(row.last_valid_block_height, "100");
              assert.equal(row.message_hash, "ab".repeat(32));
              transports++;
              throw Error("ACK lost after native send");
            },
          });
          const keeper = new DurableV3Keeper(db, cfg, chain, keys[5], factory);
          assert.equal((await keeper.tick([match])).sent, 1);
          assert.equal(transports, 1);
          const restarted = new DurableV3Keeper(
            db,
            cfg,
            chain,
            keys[4],
            () => ({
              reconcilePending: async () => [],
              pending: async () => [],
              cancelPendingSignatures() {},
              resolve: async () => null,
              advance: async () => {
                transports++;
                throw Error("Must not resend");
              },
            }),
          );
          assert.equal((await restarted.tick([match])).sent, 0);
          assert.equal(transports, 1);
          status = { confirmationStatus: "confirmed", err: null, slot: 101n };
          await restarted.tick([match]);
          assert.equal(
            (await db.query("SELECT state FROM v3_keeper_ledger")).rows[0]
              .state,
            "confirmed",
          );
          status = null;
          height = 110n;
          await restarted.tick([match]);
          assert.equal(
            (await db.query("SELECT state FROM v3_keeper_ledger")).rows[0]
              .state,
            "quarantined",
          );
          assert.equal(transports, 1);
          await db.query("UPDATE v3_keeper_ledger SET state='confirmed'");
          status = {
            confirmationStatus: "finalized",
            err: { InstructionError: [0, "InvalidAccountData"] },
            slot: 101n,
          };
          await restarted.tick([match]);
          assert.equal(
            (await db.query("SELECT state FROM v3_keeper_ledger")).rows[0]
              .state,
            "quarantined",
          );
          assert.equal(transports, 1);
          const publicLedger = JSON.stringify(
            (await db.query("SELECT * FROM v3_keeper_ledger")).rows,
          );
          assert.equal(publicLedger.includes("wire"), false);
          assert.equal(publicLedger.includes("salt"), false);
        },
      );
    } finally {
      for (const ws of sockets) ws.terminate();
      await api.close().catch(() => {});
      await db.end();
      // Exact generated test schema only; public/ABI2 schemas and databases are never reset.
      assert.match(schema, /^dustpact_v3_test_[0-9a-f]{32}$/);
      await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      await admin.end();
    }
  },
);
