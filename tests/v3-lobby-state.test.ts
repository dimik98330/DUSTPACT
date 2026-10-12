import { test } from "node:test";
import assert from "node:assert/strict";
import { lobbyState, canInvitePlayer } from "../apps/web/src/v2/lobby-state";

test("invitation never promises a new seat in a full or started caravan", () => {
  assert.equal(canInvitePlayer({ phase: 0, count: 6 }), false);
  assert.equal(canInvitePlayer({ phase: 1, count: 4 }), false);
  assert.equal(canInvitePlayer({ phase: 5, count: 4 }), false);
  assert.equal(canInvitePlayer({ phase: 0, count: 4 }), true);
  assert.equal(canInvitePlayer({ phase: 0, count: 5 }), true);
});
function room(count: number, seat = 0) {
  return {
    count,
    seat,
    seats: Array.from({ length: count }, (_, i) => ({
      ready: i !== seat,
      npc: i !== 0,
    })),
  };
}
test("a partial human room asks for invitations rather than a premature roster signature", () => {
  const g = room(1);
  assert.equal(lobbyState(g).action, "invite");
  assert.equal(lobbyState(g).missing, 3);
  assert.equal(lobbyState(g).target, 4);
});
test("a complete agent party requires its human approval before the explicit start step", () => {
  const g = room(4);
  assert.equal(lobbyState(g).soloWithAgents, true);
  assert.equal(lobbyState(g).action, "ready");
  g.seats[0].ready = true;
  assert.equal(lobbyState(g).action, "start");
});
test("a ready host waits for a changed roster member, and other players never receive start", () => {
  const g = room(5);
  g.seats[0].ready = true;
  g.seats[2].ready = false;
  assert.equal(lobbyState(g).action, "wait-ready");
  g.seats[2].ready = true;
  g.seat = 2;
  assert.equal(lobbyState(g).action, "wait-host");
});
test("missing or inconsistent observations never offer readiness or start", () => {
  const g = room(4);
  g.seats.pop();
  assert.equal(lobbyState(g).action, "sync");
  const other = room(4, 9);
  assert.equal(lobbyState(other).action, "sync");
});
test("six human players have six places and no compulsory agent invitation", () => {
  const g = room(6);
  g.seats.forEach((s) => {
    s.npc = false;
    s.ready = true;
  });
  const state = lobbyState(g);
  assert.equal(state.target, 6);
  assert.equal(state.soloWithAgents, false);
  assert.equal(state.action, "start");
});
