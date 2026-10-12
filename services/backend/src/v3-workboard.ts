import {
  advisoryWorkboardV3 as advisoryWorkboard,
  encounterBriefV3 as encounterBrief,

} from "../../../packages/engine/src/v3-design.ts";
import {
  JOB_AMOUNT,
  USDC_MINT,
  SYSTEM,
  canonicalDebriefV3,
  type GameV3,
  type Mission,
} from "../../../packages/solana-v3/src/index.ts";
import { V3Chain, projectionV3, publicJsonV3 } from "./v3-chain.ts";
import type {DesignState} from "../../../packages/engine/src/v2-design.ts";
import { requireThat } from "./security.ts";
import type { Address } from "@solana/kit";
export function designStateV3(game: GameV3): DesignState {
  const deal = (p: GameV3["deals"][number]) => ({
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
export function missionBoardV3(
  game: GameV3,
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
  return publicJsonV3({
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
export async function workboardV3(
  chain: V3Chain,
  match: Address,
  seat: number,
) {
  const observed = await chain.read(match),
    now = await chain.now(observed.slot);
  requireThat(
    Number.isInteger(seat) && seat >= 0 && seat < observed.game.count,
    400,
    "V3_INVALID_SEAT",
  );
  return publicJsonV3({
    schema: "dustpact-v3-workboard-v1",
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
        ? advisoryWorkboard(designStateV3(observed.game), seat)
        : null,
    encounter: observed.game.count >= 4 ? encounterBrief(designStateV3(observed.game), seat) : null,
    debrief: canonicalDebriefV3(observed.game, observed.commitment),
    obligations: projectionV3(observed.game).deals,
    mission: missionBoardV3(observed.game, observed.mission, now),
    warning:
      "Advice does not authorize signatures, guarantee other plans, settle work, or prove token payment. Verify Match/Vault through the client.",
  });
}
