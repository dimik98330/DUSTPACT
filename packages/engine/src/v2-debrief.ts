/** Explains retained V2 results. Never settles work, reads chat, or forecasts a secret move. */
import { V2_INITIAL, V2_STAGES, type V2Bundle } from './v2';

type Text = readonly [string, string];
export type DebriefPact = {
  kind: number; maker: number; taker: number; provider: number; action: number;
  delivery: number; gives: readonly [readonly number[], readonly number[]]; nonce?: number; job?: number;
};
export type DebriefReceipt = {
  stage: number; route: number; hullBefore: number; hullAfter: number;
  threat: number; defense: number; actions: readonly number[]; objective: boolean;
  resources: readonly (readonly number[])[]; delivered: readonly number[]; support: readonly number[];
  flags?: number; inputs?: readonly (readonly number[])[]; outputs?: readonly (readonly number[])[];
  deliveries?: readonly number[]; pacts?: readonly DebriefPact[];
  missingMask?: number; forfeitedMask?: number; rejectedCodes?: readonly number[];
  settlementKey?: string; proof?: 'practice' | 'confirmed' | 'finalized';
  work?: readonly { provider: number; action: number; executed: boolean; delivered?: number; job?: number; nonce?: number }[];
};
export type DebriefGame = {
  count: number; phase: number; hull: number; arrived: boolean;
  seats: readonly { resources: readonly number[]; delivered: number; support: number; forfeited: boolean }[];
  history: readonly DebriefReceipt[];
};
const text = (ru: string, en: string): Text => [ru, en];
const total = (bundles: DebriefReceipt['resources'] | undefined, resource: number) =>
  bundles?.reduce((n, p) => n + p[resource], 0) ?? null;
const seatsWith = (mask: number | undefined, count: number) => mask === undefined ? [] :
  Array.from({ length: count }, (_, i) => i).filter(i => mask & (1 << i));

/** A conservation check, not another resolver. Unknown/mismatching inputs suppress the trace. */
function resourceTrace(r: DebriefReceipt, previous: DebriefReceipt | undefined, count: number) {
  if (!r.inputs || !r.outputs || r.stage > 0 && !previous) return null;
  const transfers = Array.from({ length: count }, () => [0, 0, 0]);
  for (const p of r.pacts ?? []) {
    if (p.kind === 2) continue; // Joint contributions are already retained in inputs.
    for (const [side, from] of [p.maker, p.taker].entries()) {
      const to = side === 0 ? p.taker : p.maker;
      for (let j = 0; j < 3; j++) {
        transfers[from][j] -= p.gives[side][j];
        transfers[to][j] += p.gives[side][j];
      }
    }
  }
  const drinking = r.stage === 4 || r.stage === 0 && r.route === 1 ||
    r.stage === 1 && (r.route === 1 || !r.objective) ? 2 : 1;
  const trace = r.resources.slice(0, count).map((after, seat) => {
    const before = r.stage === 0 ? V2_INITIAL[seat] : previous?.resources[seat];
    const input = r.inputs?.[seat], output = r.outputs?.[seat];
    if (!before || !input || !output) return null;
    const beforeDrinking = before.map((n, j) => n + transfers[seat][j] - input[j] + output[j]);
    const waterShortage = Math.max(0, drinking - beforeDrinking[0]);
    const cargoLost = beforeDrinking[2] - after[2];
    if (beforeDrinking.some(n => n < 0) || after[0] !== Math.max(0, beforeDrinking[0] - drinking) ||
      after[1] !== beforeDrinking[1] || cargoLost < 0 || r.stage !== 3 && cargoLost !== 0) return null;
    return { seat, before: [...before], transfer: transfers[seat], input: [...input], output: [...output],
      drinking: Math.min(drinking, beforeDrinking[0]), waterShortage, cargoLost, after: [...after] };
  });
  if (trace.some(t => t === null)) return null;
  const known = trace as NonNullable<typeof trace[number]>[];
  if (r.stage === 3) {
    const cargoLost = known.reduce((n, t) => n + t.cargoLost, 0);
    const cargoBeforeAttack = known.reduce((n, t) => n + t.after[2] + t.cargoLost, 0);
    if (cargoLost !== Math.min(Math.max(0, r.threat - r.defense), cargoBeforeAttack)) return null;
  }
  return known;
}

export function expeditionDebrief(g: DebriefGame) {
  const history = [...g.history].sort((a, b) => a.stage - b.stage);
  const status = g.phase === 6 ? 'cancelled' : g.phase !== 5 ? 'ongoing' : g.arrived ? 'arrived' : 'failed';
  const city = history.find(r => r.stage === 5);
  const gate = city?.deliveries ? {
    delivered: city.deliveries.slice(0, g.count).reduce((a, b) => a + b, 0),
    required: city.route === 0 ? g.count : Math.ceil(g.count / 2),
    route: city.route,
  } : null;
  const failureCauses: Array<'hull' | 'delivery' | 'missing-result'> = [];
  if (status === 'failed') {
    if (g.hull === 0) failureCauses.push('hull');
    if (gate && gate.delivered < gate.required) failureCauses.push('delivery');
    if (!failureCauses.length) failureCauses.push('missing-result');
  }
  const scores = g.phase !== 5 ? null : g.seats.slice(0, g.count).map((s, seat) => ({
    seat, cargo: s.resources[2], cargoPoints: 3 * s.resources[2], delivered: s.delivered,
    contribution: s.support, total: g.arrived && !s.forfeited ? 3 * s.resources[2] + s.delivered + s.support : 0,
    reason: !g.arrived ? 'no-arrival' as const : s.forfeited ? 'forfeited' as const : 'arrived' as const,
  }));
  const encounters = history.map(r => {
    const workers = r.actions.slice(0, g.count).flatMap((a, seat) => a === 3 ? [seat] : []);
    const producers = r.actions.slice(0, g.count).flatMap((a, seat) => a === 4 ? [seat] : []);
    const progress = r.stage === 0 || r.stage === 1 || r.stage === 4 ? workers.length :
      r.stage === 2 ? producers.length : r.stage === 3 ? r.defense :
      r.deliveries?.slice(0, g.count).reduce((a, b) => a + b, 0) ?? null;
    const goal = r.stage === 0 || r.stage === 2 ? 1 : r.stage === 1 ? Math.ceil(g.count / 2) :
      r.stage === 3 ? r.threat : r.stage === 4 ? Math.ceil(g.count / 3) : r.route === 0 ? g.count : Math.ceil(g.count / 2);
    const facts: Text[] = [];
    let headline: Text;
    if (r.stage === 0) {
      headline = r.route === 1 ? text('Выбран сухой обход', 'The dry detour was chosen') :
        r.objective ? text('Колодец восстановлен', 'The well was restored') : text('На основном пути колодец остался сломан', 'The main route left the well broken');
      facts.push(text(`Выполнено работ у колодца: ${workers.length}. Питьё: ${r.route === 1 ? 2 : 1} воды каждому.`,
        `Completed well jobs: ${workers.length}. Drinking: ${r.route === 1 ? 2 : 1} water per seat.`));
      if (r.route === 0 && !r.objective) facts.push(text('Нехватка ремонта добавила 2 урона до прочих потерь.', 'Missing well work added 2 damage before other losses.'));
    } else if (r.stage === 1) {
      const open = r.flags === undefined ? r.route === 0 && r.objective : !!(r.flags & 2);
      headline = open ? text('Мост открыт', 'The bridge opened') : r.route === 1 ?
        text('Выбран обход моста', 'The bridge detour was chosen') : text('Ремонта моста не хватило', 'Bridge repairs fell short');
      facts.push(text(`Выполнено ремонтов: ${workers.length}; для моста нужно ${goal}.`, `Completed repairs: ${workers.length}; the bridge required ${goal}.`));
      const kits = total(r.resources, 1)!;
      facts.push(open ? text(`До двух мест добычи; осталось комплектов: ${kits}. Места всё ещё требуют вложений.`, `Up to two extraction slots; ${kits} ${kits === 1 ? 'kit remains' : 'kits remain'}. Slots still need inputs.`) :
        text('Питьё: 2 воды каждому; дальше одно место добычи.', 'Drinking: 2 water per seat; one extraction slot next.'));
    } else if (r.stage === 2) {
      headline = r.objective ? text('Груз произведён', 'Cargo was produced') : text('Производство груза не выполнено', 'Cargo production did not execute');
      const cargo = total(r.outputs, 2);
      facts.push(text(`Выполнено производств: ${producers.length}.`, `Completed productions: ${producers.length}.`));
      if (cargo !== null) facts.push(text(`Выпуск груза по квитанции: ${cargo}.`, `Cargo output recorded in the receipt: ${cargo}.`));
      facts.push(text(`Защита ${r.defense} против угрозы ${r.threat}.`, `Defense ${r.defense} against threat ${r.threat}.`));
    } else if (r.stage === 3) {
      const uncovered = Math.max(0, r.threat - r.defense);
      headline = uncovered ? text('Часть нападения осталась неприкрытой', 'Some of the attack was uncovered') : text('Нападение прикрыто', 'The attack was covered');
      facts.push(text(`Защита ${r.defense} / угроза ${r.threat}; неприкрытая угроза ${uncovered}.`, `Defense ${r.defense} / threat ${r.threat}; uncovered threat ${uncovered}.`));
      const kits = total(r.outputs, 1);
      if (kits !== null) facts.push(text(`Найдено комплектов для следующих работ: ${kits}.`, `Kits recovered for later work: ${kits}.`));
    } else if (r.stage === 4) {
      headline = r.objective ? text('Укрытия построены', 'Shelters were built') : text('Укрытий не хватило', 'Shelters fell short');
      facts.push(text(`Работ по укрытию: ${workers.length} из ${goal}; питьё 2 воды каждому.`, `Shelter jobs: ${workers.length} of ${goal}; drinking costs 2 water per seat.`));
    } else {
      headline = r.objective ? text('Грузовая цель ворот выполнена', 'The gate cargo target was met') : text('Груза для ворот не хватило', 'Gate cargo fell short');
      if (progress !== null) facts.push(text(`Отдано городу ${progress} из ${goal} груза.`, `Delivered ${progress} of ${goal} cargo to the city.`));
      facts.push(text(`Оставшаяся прочность: ${r.hullAfter}. Для прибытия нужны и доставка, и прочность выше нуля.`, `Remaining hull: ${r.hullAfter}. Arrival requires both delivery and positive hull.`));
    }
    const previous = r.stage === 0 ? undefined : history.find(h => h.stage === r.stage - 1);
    const resources = resourceTrace(r, previous, g.count);
    const repairGain = r.stage === 0 ? 0 : Math.min(12, r.hullBefore + workers.length * 2) - r.hullBefore;
    const combat = Math.max(0, r.threat - r.defense);
    const objectiveDamage = r.stage === 0 && r.route === 0 && !r.objective ? 2 :
      r.stage === 1 && r.route === 0 && !r.objective ? 4 : r.stage === 4 ? Math.max(0, goal - workers.length) * 2 : 0;
    const waterShortage = resources?.reduce((n, t) => n + t.waterShortage, 0);
    const hullTrace = waterShortage !== undefined && Math.max(0, r.hullBefore + repairGain - combat - objectiveDamage - waterShortage) === r.hullAfter ?
      { before: r.hullBefore, repairGain, combat, objectiveDamage, waterShortage, after: r.hullAfter } : null;
    const personalChanges = r.resources.slice(0, g.count).map((resources, seat) => {
      const before = r.stage === 0 ? V2_INITIAL[seat] : previous?.resources[seat];
      const supportBefore = r.stage === 0 ? 0 : previous?.support[seat];
      return { seat, resources: before ? resources.map((n, i) => n - before[i]) as V2Bundle : null,
        support: supportBefore === undefined ? null : r.support[seat] - supportBefore,
        delivery: r.deliveries?.[seat] ?? null };
    });
    const pacts = (r.pacts ?? []).map(p => {
      const w = r.work?.find(w => w.provider === p.provider && w.action === p.action &&
        (w.nonce === undefined || p.nonce === undefined || w.nonce === p.nonce));
      const job = p.job ?? w?.job;
      const outputResource = r.stage === 0 ? 0 : 2;
      const share = r.stage === 0 ? 4 : r.route === 0 ? 3 : 4;
      const allocation = p.kind === 2 && w?.executed && r.outputs &&
        r.outputs[p.maker]?.[outputResource] >= share && r.outputs[p.taker]?.[outputResource] >= share ?
        { resource: outputResource, each: share, seats: [p.maker, p.taker] } : null;
      const waterDelivery = p.kind === 1 && p.action === 2 ? {
        recipient: p.provider === p.maker ? p.taker : p.maker, agreed: p.delivery,
        actual: w?.executed && w.delivered === p.delivery && r.outputs &&
          r.outputs[p.provider === p.maker ? p.taker : p.maker]?.[0] >= p.delivery ? w.delivered : null,
      } : null;
      return { ...p, gives: p.gives.map(b => [...b]), job: job === undefined || job === 255 ? null : job,
        allocation, waterDelivery,
        execution: p.kind === 0 ? 'swapped-on-acceptance' as const : w === undefined ? 'unknown' as const :
          w.executed ? 'performed' as const : 'unperformed' as const,
        payout: job === undefined || job === 255 ? null : 'check-vault' as const };
    });
    return { stage: r.stage, name: text(V2_STAGES[r.stage].name, V2_STAGES[r.stage].nameEn), route: r.route,
      objective: r.objective, headline, facts, progress, goal, workers, producers,
      hullBefore: r.hullBefore, hullAfter: r.hullAfter, hullTrace, resources, personalChanges, pacts,
      settlementKey: r.settlementKey ?? null, proof: r.proof ?? 'unspecified',
      missingSeats: seatsWith(r.missingMask, g.count), forfeitedSeats: seatsWith(r.forfeitedMask, g.count),
      rejected: r.rejectedCodes?.slice(0, g.count).flatMap((code, seat) => code ? [{ seat, code }] : []) ?? [],
    };
  });
  return { schema: 'dustpact-v2-debrief-v1' as const, authority: 'retained-result-explanation' as const,
    status, gate, hull: g.hull, failureCauses, scores, encounters,
    scope: 'Explains retained receipts and score gates. Does not prove counterfactual necessity, token payment, human understanding or enjoyment.' };
}
