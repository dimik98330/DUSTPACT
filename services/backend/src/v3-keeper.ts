import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  signature as asSignature,
  type Address,
  type TransactionSigner,
} from "@solana/kit";
import {
  V3Client,
  PROGRAM_V3,
  type ClientOptions,
  type GameV3,
} from "../../../packages/solana-v3/src/index.ts";
import type { DirectPendingRecord } from "../../../packages/solana-client/src/pending.ts";
import { V3Chain } from "./v3-chain.ts";
import type { V3Config } from "./v3-config.ts";
import { asAddress, digest, HttpError, log, requireThat } from "./security.ts";

export type KeeperActionV3 =
  | { kind: "resolve"; stage: number }
  | { kind: "advance"; stage: number; phase: number };
/** Permissionless progression only. No host start, moves, pact acceptance or token settlement. */
export function progressV3(game: GameV3, now: number): KeeperActionV3 | null {
  requireThat(
    Number.isSafeInteger(now) && game.count >= 1 && game.count <= 6,
    503,
    "V3_KEEPER_CLOCK",
  );
  if (game.phase === 4) return { kind: "resolve", stage: game.stage };
  const expired = BigInt(now) >= game.deadline,
    mask = (1 << game.count) - 1;
  if (
    (game.phase === 1 &&
      (expired ||
        (game.count >= 4 &&
          game.seats.slice(0, game.count).every((s) => s.planningReady)))) ||
    (game.phase === 2 && (expired || game.committed === mask)) ||
    (game.phase === 3 && (expired || game.revealed === game.committed))
  )
    return { kind: "advance", stage: game.stage, phase: game.phase };
  return null;
}
type KeeperClientV3 = Pick<
  V3Client,
  | "advance"
  | "resolve"
  | "reconcilePending"
  | "pending"
  | "cancelPendingSignatures"
>;
type LeaseV3 = {
  connection: PoolClient;
  genesis: string;
  intent: string;
  match: Address;
  token: string;
};
/** Signed public metadata is committed before SDK transport. Unknown ACKs are never re-signed. */
export class DurableV3Keeper {
  readonly client: KeeperClientV3;
  private lease?: LeaseV3;
  constructor(
    readonly db: Pool,
    readonly cfg: V3Config,
    readonly chain: V3Chain,
    readonly signer: TransactionSigner,
    factory?: (options: ClientOptions) => KeeperClientV3,
  ) {
    requireThat(
      cfg.allowLocalSigning &&
        ["127.0.0.1", "localhost", "[::1]"].includes(
          new URL(cfg.rpcUrl).hostname,
        ),
      503,
      "V3_LOCAL_KEEPER_DISABLED",
    );
    const options: ClientOptions = {
      beforeSubmit: (record) => this.persistBeforeSubmit(record),
    };
    this.client = factory
      ? factory(options)
      : new V3Client(signer, cfg.rpcUrl, options);
  }
  private async persistBeforeSubmit(record: Readonly<DirectPendingRecord>) {
    const lease = this.lease;
    requireThat(
      lease &&
        record.status === "pending" &&
        record.program === PROGRAM_V3 &&
        record.match === lease.match &&
        record.actor === this.signer.address &&
        record.genesis === lease.genesis,
      409,
      "V3_KEEPER_INTENT_SCOPE",
    );
    requireThat(
      record.feeLamports >= 0n && record.feeLamports <= this.cfg.maxFee,
      429,
      "V3_KEEPER_FEE_LIMIT",
    );
    const c = lease.connection;
    await c.query("BEGIN");
    try {
      const spend = await c.query(
        "SELECT COALESCE(sum(spent_lamports),0)::text AS total FROM v3_keeper_ledger WHERE network_key=$1 AND updated_at>now()-interval '1 day'",
        [lease.genesis],
      );
      requireThat(
        BigInt(spend.rows[0].total) + record.feeLamports <=
          this.cfg.dailyFeeBudget,
        429,
        "V3_KEEPER_FEE_BUDGET",
      );
      const saved = await c.query(
        "UPDATE v3_keeper_ledger SET state='pending',signature=$1,message_hash=$2,last_valid_block_height=$3,fee_lamports=$4,spent_lamports=spent_lamports+$4,updated_at=now() WHERE network_key=$5 AND intent_hash=$6 AND state='preparing' AND lease_token=$7 RETURNING intent_hash",
        [
          record.signature,
          record.intentHash,
          record.lastValidBlockHeight.toString(),
          record.feeLamports.toString(),
          lease.genesis,
          lease.intent,
          lease.token,
        ],
      );
      requireThat(saved.rowCount === 1, 409, "V3_KEEPER_LEASE_LOST");
      await c.query("COMMIT");
    } catch (error) {
      await c.query("ROLLBACK").catch(() => {});
      throw error;
    }
  }
  private async reconcile(c: PoolClient, genesis: string) {
    const { rows } = await c.query(
      "SELECT * FROM v3_keeper_ledger WHERE network_key=$1 AND state IN ('pending','confirmed') AND signature IS NOT NULL ORDER BY updated_at LIMIT 16",
      [genesis],
    );
    if (!rows.length) return;
    const statuses = await this.chain.rpc
      .getSignatureStatuses(
        rows.map((r) => asSignature(r.signature)),
        { searchTransactionHistory: true },
      )
      .send();
    const height = await this.chain.rpc
      .getBlockHeight({ commitment: "finalized" })
      .send();
    for (const [i, row] of rows.entries()) {
      const s = statuses.value[i];
      let next: string | undefined, confirmed: bigint | undefined;
      if (s?.confirmationStatus === "finalized")
        next = s.err
          ? row.state === "confirmed"
            ? "quarantined"
            : "failed"
          : "finalized";
      else if (
        row.state === "confirmed" &&
        (!s ||
          s.err ||
          s.confirmationStatus !== "confirmed" ||
          s.slot.toString() !== row.confirmed_slot)
      )
        next = "quarantined";
      else if (s?.confirmationStatus === "confirmed" && !s.err) {
        next = "confirmed";
        confirmed = s.slot;
      } else if (!s && height > BigInt(row.last_valid_block_height))
        next = "expired";
      if (next)
        await c.query(
          "UPDATE v3_keeper_ledger SET state=$1,confirmed_slot=COALESCE($2,confirmed_slot),updated_at=now() WHERE network_key=$3 AND intent_hash=$4 AND signature=$5",
          [
            next,
            confirmed?.toString() ?? null,
            genesis,
            row.intent_hash,
            row.signature,
          ],
        );
    }
  }
  async tick(only?: readonly Address[]) {
    requireThat(!only || only.length <= 64, 400, "V3_KEEPER_WATCH_LIMIT");
    const c = await this.db.connect();
    let locked = false,
      sent = 0;
    const results: { match: Address; status: string }[] = [];
    try {
      locked = (
        await c.query("SELECT pg_try_advisory_lock(60419744) AS acquired")
      ).rows[0].acquired;
      if (!locked) return { sent: 0, status: "another-worker-active", results };
      const genesis = await this.chain.genesis();
      await this.reconcile(c, genesis);
      const watched: Address[] = only
        ? [...only]
        : (
            await c.query(
              "SELECT match_address FROM v3_rooms WHERE network_key=$1 AND keeper_enabled ORDER BY created_at LIMIT 64",
              [genesis],
            )
          ).rows.map((r) => asAddress(r.match_address));
      for (const match of watched) {
        if (sent >= 4) break;
        try {
          const blocked = await c.query(
            "SELECT state FROM v3_keeper_ledger WHERE network_key=$1 AND match_address=$2 AND (state IN('pending','confirmed','quarantined') OR state='preparing' AND updated_at>now()-interval '60 seconds') LIMIT 1",
            [genesis, match],
          );
          if (blocked.rowCount) {
            results.push({ match, status: blocked.rows[0].state });
            continue;
          }
          await this.client.reconcilePending(match);
          if (
            (await this.client.pending(match)).some(
              (r) =>
                r.status === "pending" ||
                (r.status === "rejected" &&
                  r.rejectedReason === "program_error"),
            )
          ) {
            results.push({ match, status: "sdk-pending" });
            continue;
          }
          const observed = await this.chain.read(match),
            g = observed.game;
          requireThat(observed.genesis === genesis, 503, "V3_NETWORK_CHANGED");
          const action = progressV3(g, await this.chain.now(observed.slot));
          if (!action) {
            results.push({ match, status: "waiting" });
            continue;
          }
          const intent = digest(
              `${genesis}:${PROGRAM_V3}:${match}:${g.stage}:${g.phase}:${g.revision}`,
            ),
            token = randomUUID();
          const stored = (
            await c.query(
              "SELECT *,EXTRACT(EPOCH FROM(now()-updated_at))::float AS age FROM v3_keeper_ledger WHERE network_key=$1 AND intent_hash=$2",
              [genesis, intent],
            )
          ).rows[0];
          if (
            stored &&
            (stored.state === "finalized" ||
              stored.state === "quarantined" ||
              stored.attempts >= 3 ||
              stored.age < 30)
          ) {
            results.push({ match, status: "cooldown-or-complete" });
            continue;
          }
          const quota = (
            await c.query(
              "SELECT count(*) FILTER(WHERE updated_at>now()-interval '1 day')::int AS daily,count(*)::int AS total FROM v3_keeper_ledger WHERE network_key=$1",
              [genesis],
            )
          ).rows[0];
          requireThat(
            (stored || quota.daily < 100) && (stored || quota.total < 700),
            429,
            "V3_KEEPER_BUDGET",
          );
          await c.query(
            "INSERT INTO v3_keeper_ledger(network_key,intent_hash,match_address,stage,phase,revision,actor,state,lease_token) VALUES($1,$2,$3,$4,$5,$6,$7,'preparing',$8) ON CONFLICT(network_key,intent_hash) DO UPDATE SET state='preparing',attempts=v3_keeper_ledger.attempts+1,actor=EXCLUDED.actor,signature=NULL,message_hash=NULL,last_valid_block_height=NULL,confirmed_slot=NULL,fee_lamports=0,lease_token=EXCLUDED.lease_token,updated_at=now()",
            [
              genesis,
              intent,
              match,
              g.stage,
              g.phase,
              g.revision.toString(),
              this.signer.address,
              token,
            ],
          );
          this.lease = { connection: c, genesis, match, intent, token };
          sent++;
          try {
            const signature =
              action.kind === "resolve"
                ? await this.client.resolve(match, action.stage)
                : await this.client.advance(match, {
                    stage: action.stage,
                    phase: action.phase,
                  });
            results.push({
              match,
              status: signature
                ? "submitted-awaiting-ledger-reconciliation"
                : "already-resolved",
            });
          } catch (error) {
            // Pending metadata was persisted before native send; an exception never erases it.
            await c.query(
              "UPDATE v3_keeper_ledger SET state='failed',updated_at=now() WHERE network_key=$1 AND intent_hash=$2 AND state='preparing' AND lease_token=$3",
              [genesis, intent, token],
            );
            results.push({
              match,
              status:
                error instanceof HttpError && error.status === 429
                  ? "budget-stopped"
                  : "reconcile-before-retry",
            });
            if (error instanceof HttpError && error.status === 429) break;
          } finally {
            this.lease = undefined;
          }
        } catch (error) {
          results.push({
            match,
            status:
              error instanceof HttpError ? error.code : "read-unavailable",
          });
          if (error instanceof HttpError && error.status === 429) break;
        }
      }
      return { sent, status: "checked", results };
    } finally {
      if (locked)
        await c.query("SELECT pg_advisory_unlock(60419744)").catch(() => {});
      c.release();
    }
  }
  stop() {
    this.client.cancelPendingSignatures();
  }
}
export function runV3Keeper(keeper: DurableV3Keeper, pollMs = 3000) {
  let stopped = false,
    busy = false;
  const tick = async () => {
    if (stopped || busy) return;
    busy = true;
    try {
      const r = await keeper.tick();
      log("v3_keeper_checked", { sent: r.sent, status: r.status });
    } catch {
      log("v3_keeper_poll_failed");
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(() => void tick(), Math.max(1500, pollMs));
  timer.unref();
  void tick();
  return async () => {
    stopped = true;
    clearInterval(timer);
    keeper.stop();
    while (busy) await new Promise((r) => setTimeout(r, 30));
  };
}
