import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { loadV2Kernel } from "../packages/engine/src/v2";
import { createPracticeController } from "../apps/web/src/v2/practice";

// Pre-load the canonical V2 kernel from the buffer so the controller's internal
// loadV2Kernel() returns the cached instance instead of fetching over HTTP.
await loadV2Kernel(
  new Uint8Array(await readFile("apps/web/public/engine/rules-v2.wasm")).buffer,
);

test("V2 practice controller runs a full six-encounter expedition offline", async () => {
  const c = await createPracticeController(4);
  const start = c.snapshot();
  assert.equal(start.network, "practice", "practice is offline, no chain");
  assert.equal(start.count, 4);
  assert.equal(start.seat, 0);
  assert.equal(start.phase, 1, "practice starts in the planning phase");
  assert.equal(start.history.length, 0);

  // Play straight through; agents resolve the other seats automatically.
  let guard = 0;
  while (c.snapshot().phase !== 5 && guard++ < 20) {
    const result = await c.planReady({ action: 2, route: 0, delivery: 0 });
    assert.ok(result.ok, result.error);
  }

  const end = c.snapshot();
  assert.equal(end.phase, 5, "expedition reaches the finished phase");
  assert.equal(end.history.length, 6, "all six encounters are recorded");
  assert.ok(
    end.history.every((r) => r.proof === "practice"),
    "every recorded encounter is an offline practice result",
  );
  c.dispose();
});

test("V2 practice controller performs no work after dispose", async () => {
  const c = await createPracticeController(4);
  const revisionBefore = c.snapshot().revision;
  c.dispose();
  const result = await c.planReady({ action: 2, route: 0, delivery: 0 });
  assert.equal(result.ok, false, "a disposed controller rejects actions");
  assert.equal(
    c.snapshot().revision,
    revisionBefore,
    "state is unchanged after dispose (the V2Root unmount path is safe)",
  );
});

test("V2 resolution is deterministic (same inputs → identical outcome)", async () => {
  const play = async () => {
    const c = await createPracticeController(4);
    let guard = 0;
    while (c.snapshot().phase !== 5 && guard++ < 20)
      await c.planReady({ action: 2, route: 0, delivery: 0 });
    const history = c.snapshot().history;
    c.dispose();
    return history;
  };
  const a = await play();
  const b = await play();
  assert.equal(a.length, b.length, "same number of encounters");
  assert.deepEqual(
    a.map((r) => r.actions),
    b.map((r) => r.actions),
    "identical effective actions each encounter",
  );
  assert.deepEqual(
    a.map((r) => r.resources),
    b.map((r) => r.resources),
    "identical resource outcomes each encounter — the kernel is deterministic, so results are verifiable",
  );
});

test("an unfunded action degrades gracefully and never blocks progress", async () => {
  const c = await createPracticeController(4);
  // Seat 0 starts with [3,0,0] — no tools — so Repair (action 3) at the Well is
  // unfunded. The contract requires such actions to resolve (as Rest) rather
  // than throw or stall the expedition.
  const r = await c.planReady({ action: 3, route: 0, delivery: 0 });
  assert.ok(r.ok, r.error);
  assert.equal(
    c.snapshot().history.length,
    1,
    "the encounter still advanced and was recorded",
  );
  c.dispose();
});
