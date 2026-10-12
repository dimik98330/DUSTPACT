import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createPracticeController } from '../apps/web/src/v2/practice';
import { createV2State, loadV2Kernel, resolveV2, v2Input } from '../packages/engine/src/v2';
import { expeditionDebrief } from '../packages/engine/src/v2-debrief';
import type { GameView, Receipt } from '../apps/web/src/v2/model';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ExpeditionDebrief from '../apps/web/src/v2/ExpeditionDebrief';
import ReceiptContracts from '../apps/web/src/v2/ReceiptContracts';

await loadV2Kernel(Uint8Array.from(await readFile('apps/web/public/engine/rules-v2.wasm')).buffer);
async function bridge(order: boolean) {
  const c = await createPracticeController();
  await c.accept(c.snapshot().offers.find(p => p.status === 'open' && p.taker === 0)!);
  await c.planReady({ action: 2, route: 0, delivery: 0 });
  if (order) await c.accept(c.snapshot().offers.find(p => p.status === 'open' && p.taker === 0)!);
  await c.planReady({ action: 2, route: 0, delivery: 0 });
  return c;
}
test('retained bridge work tells the actual provider, guarantee and material limit', async () => {
  const c = await bridge(true), g = c.snapshot(), d = expeditionDebrief(g);
  assert.equal(d.status, 'ongoing');
  assert.equal(d.scores, null, 'an ongoing campaign has no final personal score');
  const b = d.encounters.find(r => r.stage === 1)!;
  assert.equal(b.progress, 2);
  assert.equal(b.goal, 2);
  assert.deepEqual(b.workers, [1, 2]);
  assert.equal(b.pacts[0].provider, 1);
  assert.equal(b.pacts[0].execution, 'performed');
  assert.equal(b.pacts[0].job, null);
  assert.deepEqual(b.hullTrace, { before: 12, repairGain: 0, combat: 0, objectiveDamage: 0, waterShortage: 0, after: 12 });
  assert.equal(b.resources?.[0].transfer[0], -1);
  assert.equal(b.personalChanges[1].support, 2, 'capped repair still earns contribution');
  assert.match(b.facts.map(t => t[1]).join(' '), /1 kits? remain/);
  assert.doesNotMatch(b.facts.map(t => t[1]).join(' '), /double.*cargo/);
  c.dispose();
});
test('joint inputs are counted once and the project share is separate from personal output', async () => {
  const c = await bridge(true), g = c.snapshot(), d = expeditionDebrief(g), well = d.encounters[0];
  assert.deepEqual(well.pacts[0].allocation, { resource: 0, each: 4, seats: [2, 0] });
  assert.equal(well.resources?.[0].input[0], 2);
  assert.equal(well.resources?.[0].transfer[0], 0);
  assert.equal(well.resources?.[0].output[0], 7);
  assert.equal(well.resources?.[0].after[0], 7);
  const text = renderToStaticMarkup(createElement(ReceiptContracts, { game: g, receipt: g.history[0], language: 'ru' })).replace(/<[^>]+>/g, '');
  assert.match(text, /Доля именно этого проекта: 4 воды каждому/);
  c.dispose();
});
test('canonical water shortage is per missing unit and unexplained resources suppress reconstruction', async () => {
  const c = await createPracticeController();
  await c.planReady({ action: 0, route: 1, delivery: 0 });
  const g = c.snapshot(), d = expeditionDebrief(g);
  if (d.encounters[0].hullTrace) assert.equal(d.encounters[0].hullTrace.waterShortage,
    d.encounters[0].resources!.reduce((n, r) => n + r.waterShortage, 0));
  const broken = { ...g.history[0], resources: g.history[0].resources.map((b, i) => i === 0 ? [b[0] + 1, b[1], b[2]] as [number, number, number] : b) };
  assert.equal(expeditionDebrief({ ...g, history: [broken] }).encounters[0].resources, null);
  assert.equal(expeditionDebrief({ ...g, history: [broken] }).encounters[0].hullTrace, null);
  const result = await resolveV2(v2Input(createV2State(), Array(4).fill({ action: 0, route: 1, delivery: 0 })));
  const actual: Receipt = { ...g.history[0], route: result.route, hullAfter: result.hull, objective: result.objective,
    actions: result.actions, inputs: result.inputs, outputs: result.outputs, pacts: [], work: [],
    resources: result.players.map(p => p.resources), support: result.players.map(p => p.support) };
  const trace = expeditionDebrief({ ...g, history: [actual] }).encounters[0].hullTrace;
  assert.deepEqual(trace, { before: 12, repairGain: 0, combat: 0, objectiveDamage: 0, waterShortage: 4, after: 8 });
  c.dispose();
});
test('covered ambush cannot explain an invented cargo loss as attack damage', async () => {
  const c = await bridge(false), g = c.snapshot();
  const state = createV2State(); state.stage = 3;
  state.players.forEach(p => { p.resources = [5, 1, 3]; });
  const result = await resolveV2(v2Input(state, Array(4).fill({ action: 1, route: 0, delivery: 0 })));
  const previous = { ...g.history[0], stage: 2, resources: state.players.map(p => p.resources) };
  const r: Receipt = { ...g.history[0], stage: 3, hullBefore: 12, hullAfter: result.hull, route: result.route,
    threat: result.threat, defense: result.guard, objective: result.objective, actions: result.actions,
    resources: result.players.map(p => p.resources), inputs: result.inputs, outputs: result.outputs, pacts: [], work: [] };
  assert.ok(expeditionDebrief({ ...g, history: [previous, r] }).encounters[1].resources);
  r.resources[0] = [r.resources[0][0], r.resources[0][1], r.resources[0][2] - 1];
  const bad = expeditionDebrief({ ...g, history: [previous, r] }).encounters[1];
  assert.equal(bad.resources, null); assert.equal(bad.hullTrace, null);
  c.dispose();
});
test('water work order retains its own delivery instead of claiming aggregated output as payment', async () => {
  const c = await bridge(false), g = c.snapshot(), r = g.history[0];
  const pact = { maker: 0, taker: 1, provider: 1, kind: 1, action: 2, delivery: 2, gives: [[1,0,0],[0,0,0]] as [[number,number,number],[number,number,number]], nonce: 0, stage: 0, status: 'accepted' as const };
  const result = await resolveV2(v2Input(createV2State(), Array(4).fill({ action: 2, route: 0, delivery: 0 }), [{ ...pact, active: true, job: 255 }]));
  const receipt = { ...r, hullAfter: result.hull, objective: result.objective, pacts: [pact],
    actions: result.actions, outputs: result.outputs, inputs: result.inputs,
    resources: result.players.map(p => p.resources), work: result.work.filter(w => w.active) };
  const d = expeditionDebrief({ ...g, history: [receipt] });
  assert.deepEqual(d.encounters[0].pacts[0].waterDelivery, { recipient: 0, agreed: 2, actual: 2 });
  const text = renderToStaticMarkup(createElement(ReceiptContracts, { game: g, receipt, language: 'ru' })).replace(/<[^>]+>/g, '');
  assert.match(text, /Поставка новой воды заказчику Вы: согласовано 2; исполнено 2/);
  receipt.work[0].delivered = 3;
  assert.equal(expeditionDebrief({ ...g, history: [receipt] }).encounters[0].pacts[0].waterDelivery?.actual, null);
  c.dispose();
});
test('missing reveal and an executed repair on a detour remain separate from payout and arrival', async () => {
  const c = await bridge(true), g = c.snapshot(), r = g.history[1];
  const bypass = { ...r, route: 1, flags: 0, missingMask: 2, forfeitedMask: 2,
    pacts: r.pacts!.map(p => ({ ...p, job: 0 })), work: r.work!.map(w => ({ ...w, job: 0 })) };
  const d = expeditionDebrief({ ...g, history: [bypass] });
  assert.deepEqual(d.encounters[0].missingSeats, [1]);
  assert.deepEqual(d.encounters[0].forfeitedSeats, [1]);
  assert.equal(d.encounters[0].pacts[0].execution, 'performed');
  assert.equal(d.encounters[0].pacts[0].payout, 'check-vault');
  const text = renderToStaticMarkup(createElement(ReceiptContracts, { game: g, receipt: bypass, language: 'ru' })).replace(/<[^>]+>/g, '');
  assert.match(text, /Работа исполнена, но большинство выбрало обход/);
  assert.match(text, /право выплаты/);
  assert.doesNotMatch(text, /токены получены/);
  c.dispose();
});
test('bypass is a chosen price, not falsely called a failed repair or broken promise', async () => {
  const c = await bridge(false), d = expeditionDebrief(c.snapshot()), b = d.encounters[1];
  assert.equal(b.route, 1);
  assert.equal(b.objective, true);
  assert.match(b.headline[1], /detour/);
  assert.equal(b.pacts.length, 0);
  assert.match(b.facts.map(t => t[1]).join(' '), /one extraction slot/);
  c.dispose();
});
test('arrival causes distinguish delivery, hull, cancellation and missing evidence', async () => {
  const c = await bridge(false), base = c.snapshot();
  const city: Receipt = { ...base.history[1], stage: 5, route: 0, hullBefore: 4, hullAfter: 0,
    goal: 4, progress: 2, objective: false, deliveries: [2, 0, 0, 0], pacts: [], work: [] };
  const g: GameView = { ...base, phase: 5, stage: 5, arrived: false, hull: 0, history: [city] };
  const d = expeditionDebrief(g);
  assert.deepEqual(d.failureCauses, ['hull', 'delivery']);
  assert.equal(d.gate?.delivered, 2);
  assert.equal(d.gate?.required, 4);
  assert.ok(d.scores?.every(s => s.total === 0 && s.reason === 'no-arrival'));
  const cancelled = expeditionDebrief({ ...g, phase: 6, history: [] });
  assert.equal(cancelled.status, 'cancelled');
  assert.deepEqual(cancelled.failureCauses, []);
  assert.equal(cancelled.scores, null);
  const unknown = expeditionDebrief({ ...g, hull: 4, history: [] });
  assert.deepEqual(unknown.failureCauses, ['missing-result']);
  assert.equal(unknown.gate, null);
  c.dispose();
});
test('agreed inputs do not pretend to be performed work, allocated output or paid tokens', async () => {
  const c = await bridge(true), g = c.snapshot(), r = g.history[1];
  const unperformed = { ...r, actions: [2, 0, 3, 2], work: r.work!.map(w => ({ ...w, executed: false, job: 0 })) };
  const d = expeditionDebrief({ ...g, history: [unperformed] });
  assert.equal(d.encounters[0].pacts[0].execution, 'unperformed');
  assert.deepEqual(d.encounters[0].pacts[0].gives, r.pacts![0].gives);
  assert.equal(d.encounters[0].pacts[0].job, 0);
  assert.equal(d.encounters[0].pacts[0].payout, 'check-vault');
  assert.equal(d.encounters[0].personalChanges[0].support, null, 'missing previous receipt stays unknown');
  c.dispose();
});
test('final score shows its real components and forfeiture without inventing pact causality', async () => {
  const c = await bridge(false), g = c.snapshot();
  const d = expeditionDebrief({ ...g, phase: 5, arrived: true, seats: g.seats.map((s, i) => ({ ...s,
    resources: [s.resources[0], s.resources[1], 3], delivered: 2, support: 4, forfeited: i === 1 })) });
  assert.deepEqual(d.scores?.[0], { seat: 0, cargo: 3, cargoPoints: 9, delivered: 2, contribution: 4, total: 15, reason: 'arrived' });
  assert.equal(d.scores?.[1].total, 0);
  assert.equal(d.scores?.[1].reason, 'forfeited');
  assert.equal(d.authority, 'retained-result-explanation');
  const html = renderToStaticMarkup(createElement(ExpeditionDebrief, { game: { ...g, phase: 5, arrived: true }, language: 'ru' })).replace(/<[^>]+>/g, '');
  assert.match(html, /3 ×/);
  assert.doesNotMatch(html, /Ваши вложения и договоры привели/);
  c.dispose();
});
