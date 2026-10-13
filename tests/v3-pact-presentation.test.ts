import { test } from "node:test";
import assert from "node:assert/strict";
import { pactPresentation } from "../apps/web/src/v2/pact-presentation";
import type { GameView, PactTerms } from "../apps/web/src/v2/model";
function game(stage = 0, seat = 0): GameView {
  return { version: 3, stage, seat } as GameView;
}
function pact(p: Partial<PactTerms> = {}): PactTerms {
  return {
    maker: 2,
    taker: 0,
    provider: 2,
    kind: 2,
    action: 3,
    delivery: 0,
    gives: [
      [0, 1, 0],
      [2, 0, 0],
    ],
    stage: 0,
    nonce: 1,
    ...p,
  };
}
test("incoming joint offer shows my water, partner tool and equal new water without mutating terms", () => {
  const p = pact(),
    before = structuredClone(p),
    m = pactPresentation(game(), p);
  assert.deepEqual(m.mine, [2, 0, 0]);
  assert.deepEqual(m.theirs, [0, 1, 0]);
  assert.equal(m.other, 2);
  assert.equal(m.share, "4");
  assert.equal(m.ownActionBound, false);
  m.reserve[0][1] = 7;
  assert.deepEqual(p, before);
  assert.equal(pactPresentation(game(0, 2), p).ownActionBound, true);
});
test("repair inputs use incoming payment before adding a reserve from the provider", () => {
  const paid = pact({
    kind: 1,
    stage: 1,
    gives: [
      [0, 0, 0],
      [0, 1, 0],
    ],
  });
  assert.deepEqual(pactPresentation(game(1), paid).theirReserved, [0, 0, 0]);
  const unpaid = pact({
    ...paid,
    gives: [
      [0, 0, 0],
      [1, 0, 0],
    ],
  });
  assert.deepEqual(pactPresentation(game(1), unpaid).theirReserved, [0, 1, 0]);
});
test("city delivery reserves pledged cargo as well as provider payment and swaps perspective", () => {
  const p = pact({
    kind: 3,
    stage: 5,
    action: 5,
    delivery: 2,
    gives: [
      [1, 0, 0],
      [0, 0, 1],
    ],
  });
  assert.deepEqual(pactPresentation(game(5), p).theirReserved, [1, 0, 2]);
  assert.deepEqual(pactPresentation(game(5, 2), p).mineReserved, [1, 0, 2]);
  assert.deepEqual(pactPresentation(game(5), p).mineReserved, [0, 0, 1]);
});
test("salvage output remains route-dependent and barter never claims a bound action", () => {
  assert.equal(pactPresentation(game(2), pact({ stage: 2 })).share, "3–4");
  const m = pactPresentation(game(0, 2), pact({ kind: 0 }));
  assert.equal(m.ownActionBound, false);
  assert.equal(m.output, null);
  assert.equal(m.share, null);
});
