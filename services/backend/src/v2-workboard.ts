import {
  advisoryWorkboard,
  encounterBrief,
  type DesignState,
} from "../../../packages/engine/src/v2-design.ts";
import {
  JOB_AMOUNT,
  USDC_MINT,
  SYSTEM,
  canonicalDebriefV2,
  type GameV2,
  type Mission,
} from "../../../packages/solana-v2/src/index.ts";
import { V2Chain, projectionV2, publicJsonV2 } from "./v2-chain.ts";
import { requireThat } from "./security.ts";
import type { Address } from "@solana/kit";
export function designStateV2(game: GameV2): DesignState {
  const deal = (p: GameV2["deals"][number]) => ({
    active: p.status === 2,
    kind: p.kind,
    maker: p.maker,
    taker: p.taker,
    provider: p.provider,
    action: p.action,
    delivery: p.delivery,
    job: p.jobSlot,
    gives: p.gives,
  });
  return {
    count: game.count,
    stage: game.stage,
    hull: game.hull,
    flags: game.flags,
    phase: game.phase,
    arrived: game.arrived,
    players: game.seats.slice(0, game.count).map((s,i) => ({
      npc:!!(game.npcMask&(1<<i)),
      resources: s.resources,
      reserved: s.reserved,
      support: s.support,
      delivered: s.delivered,
      forfeited: s.forfeited,
      seal: s.seal,
      bound: s.bound,
    })),
    deals: game.deals.slice(0, game.dealCount).map(deal),
    offers: game.offers
      .filter((p) => p.status === 1)
      .map((p) => ({ ...deal(p), status: p.status, nonce: p.nonce })),
  };
}
export function missionBoardV2(
  game: GameV2,
  mission: Mission | null,
  now: number,
) {
  if (!mission)
    return {
      funded: false,
      mint: USDC_MINT,
      testOnly: true,
      authority: "advisory-only",
      slots: [],
    };
  const pinned =
    mission.roster === game.roster &&
    game.missionRoster === game.roster &&
    game.mission !== SYSTEM &&
    mission.eligibleMask === game.eligibleMask;
  return publicJsonV2({
    funded: true,
    mint: USDC_MINT,
    testOnly: true,
    authority: "advisory-only",
    sponsor: mission.sponsor,
    reservationEndsAt: mission.fundedAt + 86400n,
    acceptedJobsNeverExpire: true,
    slots: mission.slots.map((s, index) => {
      const receipt = game.history[1].complete
        ? game.history[1].jobs.find(
            (j) =>
              j.owner !== SYSTEM &&
              j.slot === index &&
              j.provider === s.provider &&
              j.nonce === s.nonce &&
              j.owner === s.owner,
          )
        : undefined;
      const unfilledRefund =
        s.status === 0 &&
        (now >= Number(mission.fundedAt + 86400n) ||
          game.history[1].complete ||
          game.stage > 1 ||
          game.phase >= 5 ||
          (game.phase === 0 && !pinned));
      return {
        index,
        status: ["available", "reserved", "paid", "refunded"][s.status],
        provider: s.owner === SYSTEM ? null : s.provider,
        owner: s.owner === SYSTEM ? null : s.owner,
        nonce: s.nonce,
        amountBaseUnits: JOB_AMOUNT,
        workReceipt: receipt ?? null,
        canAccept:
          s.status === 0 &&
          game.phase === 1 &&
          game.stage === 1 &&
          pinned &&
          now < Number(game.deadline) &&
          now < Number(mission.fundedAt + 86400n),
        canClaim: s.status === 1 && receipt?.executed === true,
        canRefund:
          unfilledRefund || (s.status === 1 && receipt?.executed === false),
      };
    }),
  });
}
export async function workboardV2(
  chain: V2Chain,
  match: Address,
  seat: number,
) {
  const observed = await chain.read(match),
    now = await chain.now(observed.slot);
  requireThat(
    Number.isInteger(seat) && seat >= 0 && seat < observed.game.count,
    400,
    "V2_INVALID_SEAT",
  );
  return publicJsonV2({
    schema: "dustpact-v2-workboard-v1",
    authority: "advisory-only",
    source: "validated-rpc-account",
    commitment: observed.commitment,
    observedSlot: observed.slot,
    genesis: observed.genesis,
    match,
    status:
      observed.game.count < 4
        ? "waiting-roster"
        : observed.game.phase === 0
          ? "lobby"
          : "encounter",
    roster: {
      current: observed.game.count,
      minimum: 4,
      missing: Math.max(0, 4 - observed.game.count),
    },
    waitingMessage:
      observed.game.count < 4
        ? [
            "Нужны минимум четыре участника. Договоры и задачи появятся после заполнения группы и старта экспедиции.",
            "At least four participants are needed. Pacts and encounter tasks become available after the group is ready and the expedition starts.",
          ]
        : null,
    actionable:
      observed.game.count >= 4 &&
      observed.game.phase === 1 &&
      now < Number(observed.game.deadline),
    chainNow: now,
    explanation:
      observed.game.count >= 4
        ? advisoryWorkboard(designStateV2(observed.game), seat)
        : null,
    encounter: observed.game.count >= 4 ? encounterBrief(designStateV2(observed.game), seat) : null,
    debrief: canonicalDebriefV2(observed.game, observed.commitment),
    obligations: projectionV2(observed.game).deals,
    mission: missionBoardV2(observed.game, observed.mission, now),
    warning:
      "Advice does not authorize signatures, guarantee other plans, settle work, or prove token payment. Verify Match/Vault through the client.",
  });
}
