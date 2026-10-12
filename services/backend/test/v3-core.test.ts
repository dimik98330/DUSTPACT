import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSigner, type Address } from "@solana/kit";
import {
  CONTENT_HASH,
  RULES_HASH,
  PROGRAM_V3,
  VAULT_PROGRAM,
  SYSTEM,
  canonicalDebriefV3,
  missionAddress,
  type Mission,
} from "../../../packages/solana-v3/src/index.ts";
import {
  accountBytesV3,
  verifyGameV3,
  verifyMissionV3,
  V3Chain,
} from "../src/v3-chain.ts";
import { progressV3 } from "../src/v3-keeper.ts";
import {
  missionBoardV3,
  designStateV3,
  workboardV3,
} from "../src/v3-workboard.ts";
import { postgresIdV3 } from "../src/v3-api.ts";
import { advisoryWorkboard } from "../../../packages/engine/src/v3-design.ts";
import {
  gameFixtureV3,
  accountFixtureV3,
  encodeGameFixtureV3,
  encodeMissionFixtureV3,
  genesisFixtureV3,
} from "./v3-fixtures.ts";
test("V3 account adapter rejects foreign owners, rentless/executable/encoded/truncated accounts and verifies exact PDA", async () => {
  const owners = await Promise.all(
      Array.from({ length: 4 }, () => generateKeyPairSigner()),
    ),
    { game, match } = await gameFixtureV3(owners.map((o) => o.address));
  const account = accountFixtureV3(await encodeGameFixtureV3(game));
  assert.equal((await verifyGameV3(match, account)).creator, game.creator);
  for (const bad of [
    { ...account, owner: VAULT_PROGRAM },
    { ...account, executable: true },
    { ...account, lamports: 0n },
    { ...account, data: ["QQ", "base64"] },
    { ...account, data: account.data[0] },
    { ...account, data: ["AAAA", "base64"] },
  ])
    await assert.rejects(verifyGameV3(match, bad));
  await assert.rejects(verifyGameV3(owners[1].address, account));
  game.rulesHash[0] ^= 1;
  await assert.rejects(
    verifyGameV3(match, accountFixtureV3(await encodeGameFixtureV3(game))),
  );
  assert.throws(() => accountBytesV3({ ...account, lamports: 1 }, PROGRAM_V3));
});
test('V3 canonical debrief retains masks and requires exact funded job identity, never action alone', async () => {
  const owners = await Promise.all(Array.from({ length: 4 }, () => generateKeyPairSigner()));
  const { game } = await gameFixtureV3(owners.map(o => o.address));
  const h = game.history[1];
  h.complete = true; h.hull = 12; h.route = 1; h.objective = true; h.actions[1] = 3;
  h.missing = 2; h.forfeited = 2; h.rejected[0] = 2; h.dealCount = 1;
  Object.assign(h.deals[0], { status: 2, kind: 1, maker: 0, taker: 1, provider: 1,
    action: 3, nonce: 7, stage: 1, jobSlot: 0, gives: [[1, 0, 0], [0, 0, 0]] });
  Object.assign(h.jobs[0], { slot: 0, provider: 1, nonce: 7, owner: owners[2].address, executed: true });
  let d = canonicalDebriefV3(game, 'finalized');
  assert.equal(d.encounters[0].pacts[0].execution, 'unknown');
  assert.deepEqual(d.encounters[0].missingSeats, [1]);
  assert.deepEqual(d.encounters[0].forfeitedSeats, [1]);
  assert.deepEqual(d.encounters[0].rejected, [{ seat: 0, code: 2 }]);
  assert.equal(d.encounters[0].proof, 'finalized');
  h.jobs[0].owner = owners[1].address;
  d = canonicalDebriefV3(game);
  assert.equal(d.encounters[0].pacts[0].execution, 'performed');
  assert.equal(d.encounters[0].pacts[0].payout, 'check-vault');
  assert.match(d.encounters[0].headline[1], /detour/);
  h.jobs[0].executed = false;
  assert.equal(canonicalDebriefV3(game).encounters[0].pacts[0].execution, 'unperformed');
});
test("V3 reads pin full genesis and read Match/Mission in one contextual RPC snapshot", async () => {
  const owners = await Promise.all(
      Array.from({ length: 4 }, () => generateKeyPairSigner()),
    ),
    { game, match } = await gameFixtureV3(owners.map((o) => o.address));
  const account = accountFixtureV3(await encodeGameFixtureV3(game)),
    chain = new V3Chain("http://127.0.0.1:19409");
  let network: Address = genesisFixtureV3,
    calls = 0;
  Object.defineProperty(chain, "rpc", {
    value: {
      getGenesisHash: () => ({ send: async () => network }),
      getMultipleAccounts: (keys: string[], cfg: any) => ({
        send: async () => {
          calls++;
          assert.equal(keys.length, 2);
          assert.equal(keys[0], match);
          assert.equal(cfg.commitment, "finalized");
          return { context: { slot: 91n }, value: [account, null] };
        },
      }),
    },
  });
  const read = await chain.read(match, "finalized");
  assert.equal(read.slot, 91n);
  assert.equal(read.genesis, genesisFixtureV3);
  assert.equal(read.mission, null);
  assert.equal(calls, 1);
  network = owners[1].address;
  await assert.rejects(chain.read(match), /V3_NETWORK_CHANGED/);
  assert.equal(calls, 1);
});
test("V3 mission projections preserve invalidated-lobby refund and never expire an accepted job", async () => {
  const owners = await Promise.all(
      Array.from({ length: 4 }, () => generateKeyPairSigner()),
    ),
    { game, match } = await gameFixtureV3(owners.map((o) => o.address)),
    [mission, bump] = await missionAddress(match);
  const m: Mission = {
    game: match,
    sponsor: owners[0].address,
    bump,
    roster: game.roster,
    rulesHash: RULES_HASH.slice(),
    contentHash: CONTENT_HASH.slice(),
    eligibleMask: 15,
    fundedAt: 0n,
    slots: [
      { status: 1, provider: 1, nonce: 2, owner: owners[1].address },
      { status: 0, provider: 0, nonce: 0, owner: SYSTEM },
    ],
  };
  game.mission = mission;
  game.eligibleMask = 15;
  game.missionRoster = game.roster;
  assert.equal(
    (
      await verifyMissionV3(
        match,
        game,
        accountFixtureV3(await encodeMissionFixtureV3(m), VAULT_PROGRAM),
      )
    )?.sponsor,
    m.sponsor,
  );
  game.roster++;
  game.missionRoster = 0;
  game.mission = SYSTEM;
  const invalidated = await verifyMissionV3(
    match,
    game,
    accountFixtureV3(await encodeMissionFixtureV3(m), VAULT_PROGRAM),
  );
  assert.ok(invalidated);
  const board = missionBoardV3(game, invalidated, 86401);
  assert.equal(board.slots[0].canRefund, false);
  assert.equal(board.slots[1].canRefund, true);
  assert.equal(board.slots[0].canClaim, false);
  m.slots[0].owner = owners[2].address;
  await assert.rejects(
    verifyMissionV3(
      match,
      game,
      accountFixtureV3(await encodeMissionFixtureV3(m), VAULT_PROGRAM),
    ),
  );
});
test("V3 keeper acts only at phase eligibility and never starts, plays or claims for participants", async () => {
  const owners = await Promise.all(
      Array.from({ length: 4 }, () => generateKeyPairSigner()),
    ),
    { game } = await gameFixtureV3(owners.map((o) => o.address));
  assert.equal(progressV3(game, 5000), null);
  game.phase = 1;
  assert.equal(progressV3(game, 1000), null);
  game.seats.slice(0, 4).forEach((s) => (s.planningReady = true));
  assert.deepEqual(progressV3(game, 1000), {
    kind: "advance",
    phase: 1,
    stage: 0,
  });
  game.phase = 2;
  game.committed = 7;
  assert.equal(progressV3(game, 1000), null);
  game.committed = 15;
  assert.equal(progressV3(game, 1000)?.kind, "advance");
  game.phase = 3;
  game.revealed = 7;
  assert.equal(progressV3(game, 1000), null);
  assert.equal(progressV3(game, 2000)?.kind, "advance");
  game.revealed = 15;
  assert.equal(progressV3(game, 1000)?.kind, "advance");
  game.phase = 4;
  assert.deepEqual(progressV3(game, 1000), { kind: "resolve", stage: 0 });
  game.phase = 5;
  assert.equal(progressV3(game, 10000), null);
});
test("V3 workboard explains complementary inventories without hidden actions or authority", async () => {
  const owners = await Promise.all(
      Array.from({ length: 4 }, () => generateKeyPairSigner()),
    ),
    { game } = await gameFixtureV3(owners.map((o) => o.address));
  game.phase = 1;
  const board = advisoryWorkboard(designStateV3(game), 0);
  assert.equal(board.authority, "advisory-only");
  assert.deepEqual(board.missing, [0, 1, 0]);
  assert.ok(
    board.partners
      .find((p) => p.seat === 2)
      ?.suggestions.some((s) => s.kind === 2),
  );
  assert.equal(JSON.stringify(board).includes("commitment"), false);
  assert.equal(JSON.stringify(board).includes("salt"), false);
});
test("V3 mission acceptance advice closes at the exact Planning deadline independently of funding expiry", async () => {
  const owners = await Promise.all(
    Array.from({ length: 4 }, () => generateKeyPairSigner()),
  );
  const { game, match } = await gameFixtureV3(owners.map((o) => o.address));
  const [mission, bump] = await missionAddress(match);
  game.phase = 1;
  game.stage = 1;
  game.deadline = 2000n;
  game.mission = mission;
  game.missionRoster = game.roster;
  game.eligibleMask = 15;
  const m: Mission = {
    game: match,
    sponsor: owners[0].address,
    bump,
    roster: game.roster,
    rulesHash: RULES_HASH.slice(),
    contentHash: CONTENT_HASH.slice(),
    eligibleMask: 15,
    fundedAt: 1000n,
    slots: Array.from({ length: 2 }, () => ({
      status: 0,
      provider: 0,
      nonce: 0,
      owner: SYSTEM,
    })),
  };
  assert.equal(missionBoardV3(game, m, 1999).slots[0].canAccept, true);
  assert.equal(missionBoardV3(game, m, 2000).slots[0].canAccept, false);
  assert.equal(missionBoardV3(game, m, 2001).slots[0].canAccept, false);
  game.deadline = 100000n;
  assert.equal(
    missionBoardV3(game, m, 87400).slots[0].canAccept,
    false,
    "Funding reservation expiry still closes acceptance",
  );
});
test("V3 PostgreSQL decimal bounds reject overflow, noncanonical and zero message IDs before database use", () => {
  assert.equal(postgresIdV3("9223372036854775807"), "9223372036854775807");
  assert.equal(postgresIdV3("0", "INVALID_CURSOR", true), "0");
  for (const value of [
    "9223372036854775808",
    "9999999999999999999",
    "0",
    "01",
    "-1",
    "1e3",
    1,
    null,
  ])
    assert.throws(
      () => postgresIdV3(value),
      (error: any) => error.status === 400,
    );
});
test("V3 workboard honestly waits for 1–3 lobby participants and never relaxes the four-player encounter scope", async () => {
  const owners = await Promise.all(
    Array.from({ length: 4 }, () => generateKeyPairSigner()),
  );
  for (const count of [1, 2, 3, 4]) {
    const { game, match } = await gameFixtureV3(
      owners.slice(0, count).map((o) => o.address),
    );
    const chain = new V3Chain("http://127.0.0.1:19409");
    chain.read = async () => ({
      game,
      mission: null,
      slot: 1n,
      genesis: genesisFixtureV3,
      commitment: "confirmed",
    });
    chain.now = async () => 1000;
    const board = await workboardV3(chain, match, 0);
    assert.equal(board.actionable, false);
    assert.equal(board.roster.missing, 4 - count);
    if (count < 4) {
      assert.equal(board.status, "waiting-roster");
      assert.equal(board.explanation, null);
      assert.equal(board.encounter, null);
      assert.ok(board.waitingMessage);
    } else {
      assert.equal(board.status, "lobby");
      assert.equal(board.explanation.authority, "advisory-only");
      assert.equal(board.encounter.authority, "advisory-only");
      assert.equal(board.encounter.commitment.hiddenPlans, true);
      assert.equal(board.encounter.stage, game.stage);
    }
  }
});
