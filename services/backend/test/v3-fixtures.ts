import { address, type Address } from "@solana/kit";
import {
  CONTENT_HASH,
  RULES_HASH,
  SYSTEM,
  PROGRAM_V3,
  matchAddress,
  type GameV3,
  type Offer,
  type Mission,
  type Summary,
} from "../../../packages/solana-v3/src/index.ts";
import {
  Writer,
  discriminator,
} from "../../../packages/solana-v3/src/codec.ts";
export const genesisFixtureV3 = address(
  "8LsEkJDSVmkiZAGSX7qWjHaVpvFbdD8mwC7D7X5bCsdM",
);
const emptyOffer = (): Offer => ({
  status: 0,
  kind: 0,
  maker: 0,
  taker: 0,
  provider: 0,
  action: 0,
  delivery: 0,
  nonce: 0,
  stage: 0,
  gives: [
    [0, 0, 0],
    [0, 0, 0],
  ],
  reserve: [
    [0, 0, 0],
    [0, 0, 0],
  ],
  jobSlot: 255,
});
const summary = (): Summary => ({
  complete: false,
  hull: 0,
  route: 0,
  threat: 0,
  guard: 0,
  objective: false,
  flags: 0,
  actions: Array(6).fill(0),
  routes: Array(6).fill(0),
  deliveries: Array(6).fill(0),
  missing: 0,
  rejected: Array(6).fill(0),
  inputs: Array.from({ length: 6 }, () => [0, 0, 0]),
  outputs: Array.from({ length: 6 }, () => [0, 0, 0]),
  resources: Array.from({ length: 6 }, () => [0, 0, 0]),
  support: Array(6).fill(0),
  delivered: Array(6).fill(0),
  forfeited: 0,
  deals: Array.from({ length: 3 }, emptyOffer),
  dealCount: 0,
  jobs: Array.from({ length: 3 }, () => ({
    slot: 0,
    provider: 0,
    nonce: 0,
    executed: false,
    owner: SYSTEM,
  })),
  revision: 0n,
  escortGoal:0,escortProgress:0,pledged:Array(6).fill(0),voluntary:Array(6).fill(0),pricesPaid:Array.from({length:6},()=>[0,0,0]),pricesReceived:Array.from({length:6},()=>[0,0,0]),
});
export async function gameFixtureV3(owners: Address[]) {
  const nonce = new Uint8Array(16).fill(7),
    [match, bump] = await matchAddress(owners[0], nonce);
  const game: GameV3 = {
    creator: owners[0],
    nonce,
    bump,
    rulesHash: RULES_HASH.slice(),
    contentHash: CONTENT_HASH.slice(),
    count: owners.length,
    phase: 0,
    stage: 0,
    hull: 12,
    deadline: 2000n,
    revision: 1n,
    roster: owners.length,
    npcMask: 0,
    eligibleMask: 0,
    mission: SYSTEM,
    missionRoster: 0,
    flags: 0,
    seats: Array.from({ length: 6 }, (_, i) => ({
      owner: owners[i] ?? SYSTEM,
      session: SYSTEM,
      expires: 0n,
      epoch: 0,
      quota: 0,
      actionNonce: 0n,
      offerNonce: 0,
      ready: false,
      planningReady: false,
      resources: [
        [3, 0, 0],
        [1, 1, 0],
        [0, 2, 0],
        [1, 1, 0],
        [2, 1, 0],
        [2, 1, 0],
      ][i] as [number, number, number],
      reserved: [0, 0, 0],
      support: 0,
      delivered: 0,
      forfeited: false,
      seal: true,
      bound: 255,
      offerCount: 0,
    })),
    offers: Array.from({ length: 6 }, emptyOffer),
    deals: Array.from({ length: 3 }, emptyOffer),
    dealCount: 0,
    commitments: Array.from({ length: 6 }, () => new Uint8Array(32)),
    committed: 0,
    revealed: 0,
    actions: Array(6).fill(0),
    routes: Array(6).fill(0),
    deliveries: Array(6).fill(0),
    history: Array.from({ length: 6 }, summary),
    scores: Array(6).fill(0),
    arrived: false,
  };
  return { match, game };
}
function writeOffer(w: Writer, p: Offer) {
  w.u8(p.status)
    .u8(p.kind)
    .u8(p.maker)
    .u8(p.taker)
    .u8(p.provider)
    .u8(p.action)
    .u16(p.delivery)
    .u32(p.nonce)
    .u8(p.stage);
  for (const b of [...p.gives, ...p.reserve]) for (const n of b) w.u16(n);
  w.u8(p.jobSlot);
}
export async function encodeGameFixtureV3(g: GameV3) {
  const w = new Writer()
    .raw(await discriminator("account", "GameV3"))
    .address(g.creator)
    .raw(g.nonce)
    .u8(g.bump)
    .raw(g.rulesHash)
    .raw(g.contentHash)
    .u8(g.count)
    .u8(g.phase)
    .u8(g.stage)
    .u8(g.hull)
    .i64(g.deadline)
    .u64(g.revision)
    .u32(g.roster)
    .u8(g.npcMask)
    .u8(g.eligibleMask)
    .address(g.mission)
    .u32(g.missionRoster)
    .u8(g.flags);
  for (const s of g.seats) {
    w.address(s.owner)
      .address(s.session)
      .i64(s.expires)
      .u32(s.epoch)
      .u16(s.quota)
      .u64(s.actionNonce)
      .u32(s.offerNonce)
      .bool(s.ready)
      .bool(s.planningReady);
    for (const b of [s.resources, s.reserved]) for (const n of b) w.u16(n);
    w.u16(s.support)
      .u16(s.delivered)
      .bool(s.forfeited)
      .bool(s.seal)
      .u8(s.bound)
      .u8(s.offerCount);
  }
  for (const o of [...g.offers, ...g.deals]) writeOffer(w, o);
  w.u8(g.dealCount);
  for (const c of g.commitments) w.raw(c);
  w.u8(g.committed).u8(g.revealed);
  for (const n of g.actions) w.u8(n);
  for (const n of g.routes) w.u8(n);
  for (const n of g.deliveries) w.u16(n);
  w.u32(6);
  for (const h of g.history) {
    w.bool(h.complete)
      .u8(h.hull)
      .u8(h.route)
      .u8(h.threat)
      .u8(h.guard)
      .bool(h.objective)
      .u8(h.flags);
    for (const n of h.actions) w.u8(n);
    for (const n of h.routes) w.u8(n);
    for (const n of h.deliveries) w.u16(n);
    w.u8(h.missing);
    for (const n of h.rejected) w.u8(n);
    for (const b of [...h.inputs, ...h.outputs, ...h.resources])
      for (const n of b) w.u16(n);
    for (const n of [...h.support, ...h.delivered]) w.u16(n);
    w.u8(h.forfeited);
    for (const d of h.deals) writeOffer(w, d);
    w.u8(h.dealCount);
    for (const j of h.jobs)
      w.u8(j.slot)
        .u8(j.provider)
        .u32(j.nonce)
        .bool(j.executed)
        .address(j.owner);
    w.u64(h.revision).u8(h.escortGoal).u8(h.escortProgress);for(const q of h.pledged)w.u16(q);for(const q of h.voluntary)w.u16(q);for(const b of [...h.pricesPaid,...h.pricesReceived])for(const q of b)w.u16(q);
  }
  for (const n of g.scores) w.u32(n);
  w.bool(g.arrived);
  const output = new Uint8Array(4500);
  output.set(w.bytes());
  return output;
}
export async function encodeMissionFixtureV3(m: Mission) {
  const w = new Writer()
    .raw(await discriminator("account", "Mission"))
    .address(m.game)
    .address(m.sponsor)
    .u8(m.bump)
    .u32(m.roster)
    .raw(m.rulesHash)
    .raw(m.contentHash)
    .u8(m.eligibleMask)
    .i64(m.fundedAt);
  for (const s of m.slots)
    w.u8(s.status).u8(s.provider).u32(s.nonce).address(s.owner);
  return w.bytes();
}
export function accountFixtureV3(
  bytes: Uint8Array,
  owner: Address = PROGRAM_V3,
) {
  return {
    owner,
    executable: false,
    lamports: 1n,
    data: [Buffer.from(bytes).toString("base64"), "base64"],
  };
}
