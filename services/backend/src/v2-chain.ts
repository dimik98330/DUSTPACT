/** Read-only V2 adapter. RPC observations are never backend authority. */
import {
  createDefaultRpcTransport,
  createSolanaRpcFromTransport,
  type Address,
} from "@solana/kit";
import { fetchSysvarClock } from "@solana/sysvars";
import {
  CONTENT_HASH,
  RULES_HASH,
  PROGRAM_V2,
  VAULT_PROGRAM,
  TOKEN,
  USDC_MINT,
  SYSTEM,
  decodeGameV2,
  decodeMission,
  matchAddress,
  missionAddress,
  type GameV2,
  type Mission,
} from "../../../packages/solana-v2/src/index.ts";
import { equalBytes } from "../../../packages/solana-v2/src/codec.ts";
import { asAddress, decodeBase64, requireThat } from "./security.ts";

export type CommitmentV2 = "confirmed" | "finalized";
export type ObservationV2 = {
  game: GameV2;
  mission: Mission | null;
  slot: bigint;
  genesis: string;
  commitment: CommitmentV2;
};
export function accountBytesV2(value: unknown, owner: Address, size?: number) {
  const a = value as {
    owner?: unknown;
    executable?: unknown;
    lamports?: unknown;
    data?: unknown;
  };
  requireThat(
    a &&
      a.owner === owner &&
      a.executable === false &&
      typeof a.lamports === "bigint" &&
      a.lamports > 0n,
    422,
    "V2_ACCOUNT_OWNER",
  );
  requireThat(
    Array.isArray(a.data) && a.data.length === 2 && a.data[1] === "base64",
    422,
    "V2_ACCOUNT_ENCODING",
  );
  const bytes = decodeBase64(a.data[0], size ?? 8192);
  requireThat(
    size === undefined || bytes.length === size,
    422,
    "V2_ACCOUNT_SIZE",
  );
  return Uint8Array.from(bytes);
}
export async function verifyGameV2(match: Address, account: unknown) {
  const game = await decodeGameV2(accountBytesV2(account, PROGRAM_V2, 8192));
  const [expected, bump] = await matchAddress(game.creator, game.nonce);
  requireThat(
    expected === match &&
      game.bump === bump &&
      equalBytes(game.rulesHash, RULES_HASH) &&
      equalBytes(game.contentHash, CONTENT_HASH),
    422,
    "V2_ACCOUNT_CONTEXT",
  );
  requireThat(
    game.phase === 0 || game.phase === 6 || game.count >= 4,
    422,
    "V2_ROSTER_BOUNDS",
  );
  requireThat(
    new Set(game.seats.slice(0, game.count).map((s) => s.owner)).size ===
      game.count,
    422,
    "V2_DUPLICATE_OWNER",
  );
  return game;
}
export async function verifyMissionV2(
  match: Address,
  game: GameV2,
  account: unknown,
): Promise<Mission | null> {
  if (!account) return null;
  const [, bump] = await missionAddress(match);
  const m = await decodeMission(accountBytesV2(account, VAULT_PROGRAM));
  // A changed lobby can invalidate an unfilled mission and legitimately unlock refund.
  // Its immutable game/rules pin remains verifiable even after the current roster changes.
  requireThat(
    m.game === match &&
      m.bump === bump &&
      equalBytes(m.rulesHash, RULES_HASH) &&
      equalBytes(m.contentHash, CONTENT_HASH),
    422,
    "V2_MISSION_CONTEXT",
  );
  for (const s of m.slots.filter((s) => s.owner !== SYSTEM))
    requireThat(
      s.provider < game.count &&
        s.owner === game.seats[s.provider].owner &&
        (m.eligibleMask & (1 << s.provider)) !== 0,
      422,
      "V2_MISSION_RECIPIENT",
    );
  return m;
}
export class V2Chain {
  readonly rpc;
  private pinnedGenesis?: string;
  constructor(
    readonly url: string,
    expectedGenesis?: string,
  ) {
    const endpoint = new URL(url);
    requireThat(
      !endpoint.username &&
        !endpoint.password &&
        !endpoint.hash &&
        (endpoint.protocol === "https:" ||
          (endpoint.protocol === "http:" &&
            ["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname))),
      500,
      "V2_RPC_CONFIG",
    );
    this.pinnedGenesis = expectedGenesis
      ? asAddress(expectedGenesis)
      : undefined;
    const native = createDefaultRpcTransport({ url });
    this.rpc = createSolanaRpcFromTransport((c) =>
      native({
        ...c,
        signal: AbortSignal.any([
          AbortSignal.timeout(8000),
          ...(c.signal ? [c.signal] : []),
        ]),
      }),
    );
  }
  async genesis() {
    const value = asAddress(await this.rpc.getGenesisHash().send());
    requireThat(
      !this.pinnedGenesis || this.pinnedGenesis === value,
      503,
      "V2_NETWORK_CHANGED",
    );
    this.pinnedGenesis = value;
    return value;
  }
  async read(
    match: Address,
    commitment: CommitmentV2 = "confirmed",
  ): Promise<ObservationV2> {
    const genesis = await this.genesis(),
      [mission] = await missionAddress(match);
    const r = await this.rpc
      .getMultipleAccounts([match, mission], { encoding: "base64", commitment })
      .send();
    requireThat(r.value[0], 404, "V2_MATCH_NOT_FOUND");
    const game = await verifyGameV2(match, r.value[0]);
    const missionData = await verifyMissionV2(match, game, r.value[1]);
    requireThat((await this.genesis()) === genesis, 503, "V2_NETWORK_CHANGED");
    return {
      game,
      mission: missionData,
      slot: r.context.slot,
      genesis,
      commitment,
    };
  }
  async scan() {
    const genesis = await this.genesis();
    const r = await this.rpc
      .getProgramAccounts(PROGRAM_V2, {
        encoding: "base64",
        commitment: "finalized",
        withContext: true,
        filters: [{ dataSize: 8192n }],
      })
      .send();
    requireThat(r.value.length <= 2000, 503, "V2_INDEX_SCAN_LIMIT");
    const matches: {
      address: Address;
      game: GameV2;
      mission: Mission | null;
      slot: bigint;
    }[] = [];
    // Fail the batch closed rather than delete projections after a partial scan.
    for (let offset = 0; offset < r.value.length; offset += 50) {
      const batch = r.value.slice(offset, offset + 50),
        keys: Address[] = [];
      for (const row of batch) {
        await verifyGameV2(row.pubkey, row.account);
        const [mission] = await missionAddress(row.pubkey);
        keys.push(row.pubkey, mission);
      }
      const snapshot = await this.rpc
        .getMultipleAccounts(keys, {
          encoding: "base64",
          commitment: "finalized",
          minContextSlot: r.context.slot,
        })
        .send();
      requireThat(
        snapshot.context.slot >= r.context.slot,
        503,
        "V2_INDEX_SLOT_REGRESSION",
      );
      for (const [i, row] of batch.entries()) {
        const game = await verifyGameV2(row.pubkey, snapshot.value[i * 2]);
        const mission = await verifyMissionV2(
          row.pubkey,
          game,
          snapshot.value[i * 2 + 1],
        );
        matches.push({
          address: row.pubkey,
          game,
          mission,
          slot: snapshot.context.slot,
        });
      }
    }
    requireThat((await this.genesis()) === genesis, 503, "V2_NETWORK_CHANGED");
    return {
      matches,
      slot: matches.reduce(
        (max, row) => (row.slot > max ? row.slot : max),
        r.context.slot,
      ),
      genesis,
    };
  }
  async now(slot: bigint) {
    return Number(
      (
        await fetchSysvarClock(this.rpc, {
          commitment: "confirmed",
          minContextSlot: slot,
        })
      ).unixTimestamp,
    );
  }
  async member(match: Address, actor: Address, explicitOwner?: Address) {
    const observation = await this.read(match),
      seats = observation.game.seats.slice(0, observation.game.count);
    const own = seats.find((s) => s.owner === actor);
    if (own && (!explicitOwner || explicitOwner === own.owner))
      return { ...observation, owner: own.owner };
    const now = await this.now(observation.slot);
    const permitted = seats.filter(
      (s) =>
        s.owner === actor ||
        (s.session === actor && s.quota > 0 && Number(s.expires) > now),
    );
    requireThat(permitted.length, 403, "V2_NOT_A_MEMBER");
    const chosen = explicitOwner
      ? permitted.find((s) => s.owner === explicitOwner)
      : permitted.length === 1
        ? permitted[0]
        : undefined;
    requireThat(
      chosen,
      explicitOwner ? 403 : 409,
      explicitOwner ? "V2_OWNER_NOT_AUTHORIZED" : "V2_SELECT_ROOM_OWNER",
    );
    return { ...observation, owner: chosen.owner };
  }
  async isMember(match: Address, actor: Address) {
    const read = await this.read(match),
      seats = read.game.seats.slice(0, read.game.count);
    if (seats.some((s) => s.owner === actor)) return read.game;
    const now = await this.now(read.slot);
    requireThat(
      seats.some(
        (s) => s.session === actor && s.quota > 0 && Number(s.expires) > now,
      ),
      403,
      "V2_NOT_A_MEMBER",
    );
    return read.game;
  }
  async health() {
    const genesis = await this.genesis();
    const r = await this.rpc
      .getMultipleAccounts([PROGRAM_V2, VAULT_PROGRAM, TOKEN, USDC_MINT], {
        encoding: "base64",
        commitment: "confirmed",
      })
      .send();
    const [game, vault, token, mint] = r.value;
    return {
      genesis,
      slot: r.context.slot,
      game: game?.executable === true,
      vault: vault?.executable === true,
      token: token?.executable === true,
      testMint: mint?.owner === TOKEN,
      immutable: "not-verified-by-this-service",
    };
  }
}
export function publicJsonV2<T>(value: T): any {
  return JSON.parse(
    JSON.stringify(value, (_, v) =>
      typeof v === "bigint"
        ? v.toString()
        : v instanceof Uint8Array
          ? Array.from(v)
          : v,
    ),
  );
}
export function projectionV2(g: GameV2) {
  return publicJsonV2({
    schema: "dustpact-v2",
    program: PROGRAM_V2,
    creator: g.creator,
    stage: g.stage,
    phase: g.phase,
    count: g.count,
    hull: g.hull,
    revision: g.revision,
    deadline: g.deadline,
    flags: g.flags,
    roster: g.roster,
    npcMask: g.npcMask,
    eligibleMask: g.eligibleMask,
    mission: g.mission === SYSTEM ? null : g.mission,
    missionRoster: g.missionRoster,
    seats: g.seats.slice(0, g.count),
    offers: g.offers.filter((o) => o.status === 1),
    deals: g.deals.slice(0, g.dealCount),
    history: g.history.filter((h) => h.complete),
    scores: g.scores.slice(0, g.count),
    arrived: g.arrived,
    committed: g.committed,
    revealed: g.revealed,
  });
}
