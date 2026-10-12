import assert from "node:assert/strict";
import { test } from "node:test";
import { createV2State, V2_INITIAL, type V2Deal } from "../packages/engine/src/v2";
import { v2AgentAccepts } from "../packages/engine/src/v2-bots";
import { score, free, type Seat } from "../apps/web/src/v2/model";

const seatOf = (
  resources: [number, number, number],
  delivered: number,
  support: number,
  forfeited = false,
): Seat => ({ resources, delivered, support, forfeited }) as unknown as Seat;

test("V2 personal score = 3·cargo + delivered + support (arrived, not forfeited); else 0", () => {
  // Cargo is weighted ×3; starting water/tools (indices 0,1) never score.
  assert.equal(score(seatOf([7, 9, 4], 2, 3), true), 3 * 4 + 2 + 3);
  // Water/tools do not change the score.
  assert.equal(score(seatOf([0, 0, 4], 2, 3), true), 3 * 4 + 2 + 3);
  // No arrival → no personal score.
  assert.equal(score(seatOf([0, 0, 4], 2, 3), false), 0);
  // Forfeited (e.g. missed reveal) → no personal score even if arrived.
  assert.equal(score(seatOf([0, 0, 4], 2, 3, true), true), 0);
});

test("free() shows resources minus reservations and never goes negative (no double-spend of reserved)", () => {
  const held = { resources: [3, 2, 1], reserved: [1, 2, 0] } as unknown as Seat;
  assert.deepEqual(free(held), [2, 0, 1]);
  // A reservation larger than the balance clamps to zero, never negative.
  const over = { resources: [1, 0, 0], reserved: [2, 0, 0] } as unknown as Seat;
  assert.deepEqual(free(over), [0, 0, 0]);
});

test("canonical starting inventory and setup match the V2 contract", () => {
  assert.deepEqual(V2_INITIAL, [
    [3, 0, 0],
    [1, 1, 0],
    [0, 2, 0],
    [1, 1, 0],
    [2, 1, 0],
    [2, 1, 0],
  ]);
  const s = createV2State(6);
  assert.equal(s.hull, 12, "caravan starts at full hull");
  assert.equal(s.stage, 0, "expedition starts at the first encounter");
  assert.equal(s.players.length, 6);
  assert.deepEqual(
    s.players.map((p) => p.resources),
    V2_INITIAL,
    "six seats get the exact contract inventory profiles",
  );
  assert.ok(
    s.players.every((p) => p.support === 0 && p.delivered === 0 && !p.forfeited),
    "no starting support, delivery or forfeit",
  );
  assert.deepEqual(
    createV2State(4).players.map((p) => p.resources),
    V2_INITIAL.slice(0, 4),
    "a four-seat caravan takes the first four profiles",
  );
  const five = createV2State(5);
  assert.equal(five.count, 5);
  assert.deepEqual(
    five.players.map((p) => p.resources),
    V2_INITIAL.slice(0, 5),
    "a five-seat caravan takes the first five profiles (N∈{4,5,6} covered)",
  );
});

// The accepted V2 domain requires disclosed agents to have a real accept/reject
// policy — "no always-yes success". These lock that guarantee at the source.

test("disclosed agents reject a deal they cannot afford (not always-yes)", () => {
  const agent = createV2State(4).players[1];
  agent.resources = [0, 0, 0];
  const greedy: V2Deal = {
    active: true,
    kind: 0,
    maker: 0,
    taker: 1,
    provider: 0,
    action: 0,
    delivery: 0,
    job: 255,
    gives: [
      [0, 0, 0],
      [9, 9, 9],
    ],
  };
  assert.equal(v2AgentAccepts(greedy, agent, "trader"), false);
});

test("disclosed agents accept a fair, affordable barter in their favor", () => {
  const agent = createV2State(4).players[1];
  agent.resources = [0, 0, 5];
  const fair: V2Deal = {
    active: true,
    kind: 0,
    maker: 0,
    taker: 1,
    provider: 0,
    action: 0,
    delivery: 0,
    job: 255,
    gives: [
      [0, 0, 2],
      [0, 0, 1],
    ],
  };
  assert.equal(v2AgentAccepts(fair, agent, "trader"), true);
});
