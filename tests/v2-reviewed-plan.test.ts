import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSigner } from '@solana/kit';
import { gameFixtureV2 } from '../services/backend/test/v2-fixtures';
import { reviewedPlanFrozen, revealChoiceState } from '../apps/web/src/v2/gameplay';
import { cityContributionPreview } from '../packages/engine/src/v2-design';
import { OnlineController } from '../apps/web/src/v2/online';
import type { GameView } from '../apps/web/src/v2/model';
import { prepareMove, SYSTEM, type V2Client } from '../packages/solana-v2/src/index';
const view = { phase: 1, network: 'local', seat: 0, committed: 0, preparedStatus: 'verified', seats: [{ ready: false }] } as GameView;
test('the whole reviewed Move freezes after readiness, commit, reveal or unknown transport', () => {
  assert.equal(reviewedPlanFrozen(view), false);
  assert.equal(reviewedPlanFrozen({ ...view, seats: [{ ready: true }] as GameView['seats'] }), true);
  assert.equal(reviewedPlanFrozen({ ...view, phase: 2 }), true);
  assert.equal(reviewedPlanFrozen({ ...view, preparedStatus: 'missing', phase: 2 }), false);
  assert.equal(reviewedPlanFrozen({ ...view, preparedStatus: 'missing', phase: 2, committed: 1 }), true);
  assert.equal(reviewedPlanFrozen({ ...view, phase: 3 }), true);
  assert.equal(reviewedPlanFrozen({ ...view, transaction: { stage: 'unknown_transport' } }), true);
  assert.equal(reviewedPlanFrozen({ ...view, network: 'practice', seats: [{ ready: true }] as GameView['seats'] }), false);
});
test('reveal availability requires an own commitment, exact verified copy and no earlier reveal',()=>{
 const g={...view,phase:3,committed:0,revealed:0,preparedChoice:{action:1,route:0,delivery:0}} as GameView;
 assert.equal(revealChoiceState(g),'uncommitted');assert.equal(revealChoiceState({...g,committed:1}),'ready');
 assert.equal(revealChoiceState({...g,committed:1,preparedStatus:'missing'}),'needs-copy');assert.equal(revealChoiceState({...g,committed:1,preparedStatus:'invalid'}),'needs-copy');
 assert.equal(revealChoiceState({...g,committed:1,preparedChoice:undefined}),'needs-copy');assert.equal(revealChoiceState({...g,committed:1,revealed:1}),'revealed');assert.equal(revealChoiceState({...g,phase:2}),'closed');
});
test('city price uses only free cargo, actual delivery and a conditional majority-route target', () => {
  const p = { resources: [2,1,5], reserved: [0,0,2], support: 7, delivered: 0, forfeited: false };
  const d = cityContributionPreview(4, p, 2, 0);
  assert.equal(d.freeCargo, 3); assert.equal(d.remainingFreeCargo, 1);
  assert.equal(d.scoreFromThisCargoIfArrival, 5); assert.equal(d.scoreCostComparedWithKeeping, 4);
  assert.equal(d.targetForYourVote, 4); assert.equal(d.stillNeededFromOthers, 2);
  assert.equal(cityContributionPreview(5, p, 2, 1).targetForYourVote, 3);
  assert.equal(cityContributionPreview(4, { ...p, forfeited: true }, 2, 0).personalEligible, false);
  for (const value of [-1, 4, NaN, 1.5]) assert.throws(() => cityContributionPreview(4, p, value, 0));
});
async function controllerForWithdrawal(fail = false) {
  const owners = await Promise.all(Array.from({ length: 4 }, () => generateKeyPairSigner()));
  const { game, match } = await gameFixtureV2(owners.map(o => o.address));
  game.phase = 1; game.seats[0].planningReady = true;
  let calls = 0;
  const owner = { signer: owners[0], chainNow: () => 1000, cancelPendingSignatures: () => {},
    stageReady: async (_: unknown, ready: boolean) => { calls++; assert.equal(ready, false); if (fail) throw Error('unknown transport'); game.seats[0].planningReady = false; }
  } as unknown as V2Client;
  const c = new OnlineController(owner, match, 'local', [], {}), internal = c as any;
  internal.game = game; internal.genesis = 'local-unit-genesis'; internal.seat = 0;
  internal.pump = async () => {}; internal.read = async () => { internal.game = structuredClone(game); internal.publish(); };
  internal.prepared = await prepareMove(match, game, 0, { action: 1, route: 0, delivery: 0 });
  internal.preparedStatus = 'verified'; internal.plannedStage = 0; internal.publish();
  return { c, internal, game, calls: () => calls };
}
test('explicit readiness withdrawal stops autosubmission and preserves the old recovery preimage', async () => {
  const f = await controllerForWithdrawal();
  const prepared = structuredClone(f.internal.prepared);
  assert.equal((await f.c.revisePlan!()).ok, true);
  assert.equal(f.calls(), 1); assert.equal(f.c.snapshot().seats[0].ready, false);
  assert.deepEqual(f.internal.prepared, prepared); assert.equal(f.internal.plannedStage, -1);
  assert.equal(reviewedPlanFrozen(f.c.snapshot()), false); f.c.dispose();
});
test('unknown withdrawal preserves the approved choice and freezes it while reconciliation is needed', async () => {
  const f = await controllerForWithdrawal(true), prepared = structuredClone(f.internal.prepared);
  assert.equal((await f.c.revisePlan!()).ok, false);
  assert.deepEqual(f.internal.prepared, prepared); assert.equal(f.internal.plannedStage, -1);
  assert.equal(f.c.snapshot().seats[0].ready, true); assert.equal(reviewedPlanFrozen(f.c.snapshot()), true); f.c.dispose();
});
test('unused refund has no invented provider; invalidated mission exposes sponsor and closes paid-job activation', async () => {
  const f=await controllerForWithdrawal();
  f.game.phase=0;
  f.internal.vault={game:f.internal.match,sponsor:f.game.creator,roster:f.game.roster,eligibleMask:15,fundedAt:0n,
    slots:[{status:3,provider:0,owner:SYSTEM,nonce:0},{status:0,provider:0,owner:SYSTEM,nonce:0}]};
  f.internal.publish();
  const v=f.c.snapshot().vault!;
  assert.equal(v.slots[0].provider,undefined);assert.equal(v.slots[0].recipient,undefined);
  assert.equal(v.sponsor,f.game.creator);assert.equal(v.active,false);assert.equal(v.refundable,true);
  f.c.dispose();
});
test('creator configures an unpinned mission; another owner can fund pinned terms without creator signature', async () => {
  const f=await controllerForWithdrawal();f.game.phase=0;
  assert.equal(f.c.canConfigureMission,true);assert.equal(f.c.canFundMission,true);
  const owner=(f.internal.owner as any);owner.signer={...owner.signer,address:f.game.seats[1].owner};f.internal.seat=1;
  assert.equal(f.c.canConfigureMission,false);assert.equal(f.c.canFundMission,false);
  f.game.mission=f.game.seats[3].owner;f.game.missionRoster=f.game.roster;
  let funded=0;owner.fund=async()=>{funded++;};owner.configureMission=async()=>{throw Error('Unexpected creator-only configure');};
  assert.equal(f.c.canFundMission,true);assert.equal((await f.c.fundMission()).ok,true);assert.equal(funded,1);
  f.c.dispose();
});
