import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSigner, type Address } from "@solana/kit";
import {
  CONTENT_HASH,
  RULES_HASH,
  PROGRAM_V2,
  VAULT_PROGRAM,
  SYSTEM,
  canonicalDebriefV2,
  missionAddress,
  type Mission,
} from "../../../packages/solana-v2/src/index.ts";
import {
  accountBytesV2,
  verifyGameV2,
  verifyMissionV2,
  V2Chain,
} from "../src/v2-chain.ts";
import { progressV2 } from "../src/v2-keeper.ts";
import {
  missionBoardV2,
  designStateV2,
  workboardV2,
} from "../src/v2-workboard.ts";
import { postgresIdV2 } from "../src/v2-api.ts";
import { advisoryWorkboard } from "../../../packages/engine/src/v2-design.ts";
import {
  gameFixtureV2,
  accountFixtureV2,
  encodeGameFixtureV2,
  encodeMissionFixtureV2,
  genesisFixtureV2,
} from "./v2-fixtures.ts";
test("V2 account adapter rejects foreign owners, rentless/executable/encoded/truncated accounts and verifies exact PDA", async () => {
  const owners = await Promise.all(
      Array.from({ length: 4 }, () => generateKeyPairSigner()),
    ),
    { game, match } = await gameFixtureV2(owners.map((o) => o.address));
  const account = accountFixtureV2(await encodeGameFixtureV2(game));
  assert.equal((await verifyGameV2(match, account)).creator, game.creator);
  for (const bad of [
    { ...account, owner: VAULT_PROGRAM },
    { ...account, executable: true },
    { ...account, lamports: 0n },
    { ...account, data: ["QQ", "base64"] },
    { ...account, data: account.data[0] },
    { ...account, data: ["AAAA", "base64"] },
  ])
    await assert.rejects(verifyGameV2(match, bad));
  await assert.rejects(verifyGameV2(owners[1].address, account));
  game.rulesHash[0] ^= 1;
  await assert.rejects(
    verifyGameV2(match, accountFixtureV2(await encodeGameFixtureV2(game))),
  );
  assert.throws(() => accountBytesV2({ ...account, lamports: 1 }, PROGRAM_V2));
});
test('V2 canonical debrief retains masks and requires exact funded job identity, never action alone', async () => {
  const owners = await Promise.all(Array.from({ length: 4 }, () => generateKeyPairSigner()));
  const { game } = await gameFixtureV2(owners.map(o => o.address));
  const h = game.history[1];
  h.complete = true; h.hull = 12; h.route = 1; h.objective = true; h.actions[1] = 3;
  h.missing = 2; h.forfeited = 2; h.rejected[0] = 2; h.dealCount = 1;
  Object.assign(h.deals[0], { status: 2, kind: 1, maker: 0, taker: 1, provider: 1,
    action: 3, nonce: 7, stage: 1, jobSlot: 0, gives: [[1, 0, 0], [0, 0, 0]] });
  Object.assign(h.jobs[0], { slot: 0, provider: 1, nonce: 7, owner: owners[2].address, executed: true });
  let d = canonicalDebriefV2(game, 'finalized');
  assert.equal(d.encounters[0].pacts[0].execution, 'unknown');
  assert.deepEqual(d.encounters[0].missingSeats, [1]);
  assert.deepEqual(d.encounters[0].forfeitedSeats, [1]);
  assert.deepEqual(d.encounters[0].rejected, [{ seat: 0, code: 2 }]);
  assert.equal(d.encounters[0].proof, 'finalized');
  h.jobs[0].owner = owners[1].address;
  d = canonicalDebriefV2(game);
  assert.equal(d.encounters[0].pacts[0].execution, 'performed');
  assert.equal(d.encounters[0].pacts[0].payout, 'check-vault');
  assert.match(d.encounters[0].headline[1], /detour/);
  h.jobs[0].executed = false;
  assert.equal(canonicalDebriefV2(game).encounters[0].pacts[0].execution, 'unperformed');
});
test("V2 reads pin full genesis and read Match/Mission in one contextual RPC snapshot", async () => {
  const owners = await Promise.all(
      Array.from({ length: 4 }, () => generateKeyPairSigner()),
    ),
    { game, match } = await gameFixtureV2(owners.map((o) => o.address));
  const account = accountFixtureV2(await encodeGameFixtureV2(game)),
    chain = new V2Chain("http://127.0.0.1:19099");
  let network: Address = genesisFixtureV2,
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
  assert.equal(read.genesis, genesisFixtureV2);
  assert.equal(read.mission, null);
  assert.equal(calls, 1);
  network = owners[1].address;
  await assert.rejects(chain.read(match), /V2_NETWORK_CHANGED/);
  assert.equal(calls, 1);
});
test("V2 mission projections preserve invalidated-lobby refund and never expire an accepted job", async () => {
  const owners = await Promise.all(
      Array.from({ length: 4 }, () => generateKeyPairSigner()),
    ),
    { game, match } = await gameFixtureV2(owners.map((o) => o.address)),
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
      await verifyMissionV2(
        match,
        game,
        accountFixtureV2(await encodeMissionFixtureV2(m), VAULT_PROGRAM),
      )
    )?.sponsor,
    m.sponsor,
  );
  game.roster++;
  game.missionRoster = 0;
  game.mission = SYSTEM;
  const invalidated = await verifyMissionV2(
    match,
    game,
    accountFixtureV2(await encodeMissionFixtureV2(m), VAULT_PROGRAM),
  );
  assert.ok(invalidated);
  const board = missionBoardV2(game, invalidated, 86401);
  assert.equal(board.slots[0].canRefund, false);
  assert.equal(board.slots[1].canRefund, true);
  assert.equal(board.slots[0].canClaim, false);
  m.slots[0].owner = owners[2].address;
  await assert.rejects(
    verifyMissionV2(
      match,
      game,
      accountFixtureV2(await encodeMissionFixtureV2(m), VAULT_PROGRAM),
    ),
  );
});
test("V2 keeper acts only at phase eligibility and never starts, plays or claims for participants", async () => {
  const owners = await Promise.all(
      Array.from({ length: 4 }, () => generateKeyPairSigner()),
    ),
    { game } = await gameFixtureV2(owners.map((o) => o.address));
  assert.equal(progressV2(game, 5000), null);
  game.phase = 1;
  assert.equal(progressV2(game, 1000), null);
  game.seats.slice(0, 4).forEach((s) => (s.planningReady = true));
  assert.deepEqual(progressV2(game, 1000), {
    kind: "advance",
    phase: 1,
    stage: 0,
  });
  game.phase = 2;
  game.committed = 7;
  assert.equal(progressV2(game, 1000), null);
  game.committed = 15;
  assert.equal(progressV2(game, 1000)?.kind, "advance");
  game.phase = 3;
  game.revealed = 7;
  assert.equal(progressV2(game, 1000), null);
  assert.equal(progressV2(game, 2000)?.kind, "advance");
  game.revealed = 15;
  assert.equal(progressV2(game, 1000)?.kind, "advance");
  game.phase = 4;
  assert.deepEqual(progressV2(game, 1000), { kind: "resolve", stage: 0 });
  game.phase = 5;
  assert.equal(progressV2(game, 10000), null);
});
test("V2 workboard explains complementary inventories without hidden actions or authority", async () => {
  const owners = await Promise.all(
      Array.from({ length: 4 }, () => generateKeyPairSigner()),
    ),
    { game } = await gameFixtureV2(owners.map((o) => o.address));
  game.phase = 1;
  const board = advisoryWorkboard(designStateV2(game), 0);
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
test("V2 mission acceptance advice closes at the exact Planning deadline independently of funding expiry", async () => {
  const owners = await Promise.all(
    Array.from({ length: 4 }, () => generateKeyPairSigner()),
  );
  const { game, match } = await gameFixtureV2(owners.map((o) => o.address));
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
  assert.equal(missionBoardV2(game, m, 1999).slots[0].canAccept, true);
  assert.equal(missionBoardV2(game, m, 2000).slots[0].canAccept, false);
  assert.equal(missionBoardV2(game, m, 2001).slots[0].canAccept, false);
  game.deadline = 100000n;
  assert.equal(
    missionBoardV2(game, m, 87400).slots[0].canAccept,
    false,
    "Funding reservation expiry still closes acceptance",
  );
});
test("V2 PostgreSQL decimal bounds reject overflow, noncanonical and zero message IDs before database use", () => {
  assert.equal(postgresIdV2("9223372036854775807"), "9223372036854775807");
  assert.equal(postgresIdV2("0", "INVALID_CURSOR", true), "0");
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
      () => postgresIdV2(value),
      (error: any) => error.status === 400,
    );
});
test("V2 workboard honestly waits for 1–3 lobby participants and never relaxes the four-player encounter scope", async () => {
  const owners = await Promise.all(
    Array.from({ length: 4 }, () => generateKeyPairSigner()),
  );
  for (const count of [1, 2, 3, 4]) {
    const { game, match } = await gameFixtureV2(
      owners.slice(0, count).map((o) => o.address),
    );
    const chain = new V2Chain("http://127.0.0.1:19099");
    chain.read = async () => ({
      game,
      mission: null,
      slot: 1n,
      genesis: genesisFixtureV2,
      commitment: "confirmed",
    });
    chain.now = async () => 1000;
    const board = await workboardV2(chain, match, 0);
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
