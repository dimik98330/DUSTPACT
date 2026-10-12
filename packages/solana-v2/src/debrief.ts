import { expeditionDebrief, type DebriefReceipt } from '../../engine/src/v2-debrief';
import type { GameV2 } from './types';

/** Derivation from a validated canonical account; this is neither settlement nor replay. */
export function canonicalDebriefV2(game: GameV2, proof: 'confirmed' | 'finalized' = 'confirmed') {
  const history: DebriefReceipt[] = game.history.flatMap((h, stage) => !h.complete ? [] : [{
    stage, route: h.route, hullBefore: stage ? game.history[stage - 1].hull : 12, hullAfter: h.hull,
    threat: h.threat, defense: h.guard, actions: h.actions.slice(0, game.count), objective: h.objective,
    resources: h.resources.slice(0, game.count), delivered: h.delivered.slice(0, game.count), support: h.support.slice(0, game.count),
    flags: h.flags, inputs: h.inputs.slice(0, game.count), outputs: h.outputs.slice(0, game.count),
    deliveries: h.deliveries.slice(0, game.count), missingMask: h.missing, forfeitedMask: h.forfeited,
    rejectedCodes: h.rejected.slice(0, game.count), settlementKey: `${stage}:${h.revision}`, proof,
    pacts: h.deals.slice(0, h.dealCount).map(p => ({ ...p, job: p.jobSlot })),
    work: h.deals.slice(0, h.dealCount).filter(p => p.kind !== 0).flatMap(p => {
      const job = p.jobSlot === 255 ? undefined : h.jobs.find(j => j.slot === p.jobSlot &&
        j.provider === p.provider && j.nonce === p.nonce && j.owner === game.seats[p.provider].owner);
      if (p.jobSlot !== 255 && !job) return [];
      return [{ provider: p.provider, action: p.action, nonce: p.nonce, job: p.jobSlot,
        delivered: p.kind === 1 && p.action === 2 && h.actions[p.provider] === 2 ? p.delivery : 0,
        executed: p.jobSlot === 255 ? h.actions[p.provider] === p.action : job!.executed }];
    }),
  }]);
  return expeditionDebrief({ count: game.count, phase: game.phase, hull: game.hull, arrived: game.arrived,
    seats: game.seats.slice(0, game.count), history });
}
