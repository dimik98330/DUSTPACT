import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { Auth } from "./auth.ts";
import { transaction } from "./db-v3.ts";
import {
  asAddress,
  body,
  HttpError,
  json,
  log,
  originOf,
  RateLimit,
  requireThat,
  text,
} from "./security.ts";
import type { V3Config } from "./v3-config.ts";
import { V3Chain, projectionV3, publicJsonV3 } from "./v3-chain.ts";
import { V3Chat } from "./v3-chat.ts";
import { missionBoardV3, workboardV3 } from "./v3-workboard.ts";
import { chatClientId } from './v3-chat-message.ts';
import {
  CONTENT_HASH,
  RULES_HASH,
  PROGRAM_V3,
  VAULT_PROGRAM,
} from "../../../packages/solana-v3/src/index.ts";
import { hex } from "../../../packages/solana-v3/src/codec.ts";

/** Reject out-of-range decimal input before PostgreSQL coercion. */
export function postgresIdV3(
  value: unknown,
  code = "INVALID_MESSAGE",
  allowZero = false,
): string {
  requireThat(
    typeof value === "string" && /^(0|[1-9]\d{0,18})$/.test(value),
    400,
    code,
  );
  const integer = BigInt(value);
  requireThat(
    integer <= 9223372036854775807n && (allowZero || integer > 0n),
    400,
    code,
  );
  return value;
}

export function createV3Api(
  db: Pool,
  cfg: V3Config,
  chain = new V3Chain(cfg.rpcUrl, cfg.expectedGenesis),
) {
  const auth = new Auth(db, cfg),
    limits = new RateLimit();
  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1"),
        path = url.pathname.replace(/^\/api\/v2(?=\/|$)/, "");
      limits.hit(`ip:${req.socket.remoteAddress}`, 180, 60_000);
      const approved =
        typeof req.headers.origin === "string" &&
        cfg.origins.includes(req.headers.origin);
      if (approved) {
        res.setHeader("access-control-allow-origin", req.headers.origin!);
        res.setHeader("access-control-allow-credentials", "true");
        res.setHeader("vary", "Origin");
      }
      if (req.method === "OPTIONS") {
        originOf(req, cfg);
        res.writeHead(204, {
          "access-control-allow-methods": "GET,POST,OPTIONS",
          "access-control-allow-headers": "Content-Type,X-CSRF-Token",
        });
        return res.end();
      }
      if (path === "/health/live" && req.method === "GET")
        return json(res, 200, { status: "live", schema: "dustpact-v3" });
      if (path === "/health/ready" && req.method === "GET") {
        const [database, rpc] = await Promise.allSettled([
          db.query(
            "SELECT 1 FROM schema_migrations WHERE version='007_v3_services.sql'",
          ),
          chain.health(),
        ]);
        const databaseReady =
          database.status === "fulfilled" && database.value.rowCount === 1;
        const gameReady = rpc.status === "fulfilled" && rpc.value.game;
        return json(res, databaseReady && gameReady ? 200 : 503, {
          status: databaseReady && gameReady ? "ready" : "degraded",
          database: databaseReady,
          rpc: rpc.status === "fulfilled" ? rpc.value : { game: false },
          programId: PROGRAM_V3,
          vaultProgramId: VAULT_PROGRAM,
          cluster: cfg.cluster,
          trust:
            "Optional helpers; game and token accounts remain authoritative.",
        });
      }
      const origin = originOf(req, cfg);
      if (path === "/version" && req.method === "GET")
        return json(res, 200, {
          schema: "dustpact-v3",
          programId: PROGRAM_V3,
          vaultProgramId: VAULT_PROGRAM,
          rulesHash: hex(RULES_HASH),
          contentHash: hex(CONTENT_HASH),
          cluster: cfg.cluster,
          genesis: await chain.genesis(),
          legacyCompatible: false,
          testOnly: true,
        });
      if (path === "/auth/challenge" && req.method === "POST") {
        limits.hit(`auth:${req.socket.remoteAddress}`, 20, 60_000);
        return json(res, 200, await auth.challenge(await body(req), origin));
      }
      if (path === "/auth/verify" && req.method === "POST") {
        limits.hit(`verify:${req.socket.remoteAddress}`, 30, 60_000);
        return json(res, 200, await auth.verify(await body(req), origin, res));
      }
      if (path === "/matches" && req.method === "GET") {
        const cursor = url.searchParams.get("cursor") ?? "",
          limit = Number(url.searchParams.get("limit") ?? 20);
        requireThat(
          cursor === "" || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(cursor),
          400,
          "INVALID_CURSOR",
        );
        requireThat(
          Number.isInteger(limit) && limit >= 1 && limit <= 50,
          400,
          "INVALID_LIMIT",
        );
        const genesis = await chain.genesis();
        const { rows } = await db.query(
          'SELECT address,slot,revision,phase,stage,seat_count AS "seatCount",observed_at AS "observedAt" FROM v3_match_projections WHERE network_key=$1 AND address>$2 ORDER BY address LIMIT $3',
          [genesis, cursor, limit],
        );
        return json(res, 200, {
          authority: "projection-cache",
          commitment: "finalized",
          genesis,
          program: PROGRAM_V3,
          matches: rows,
          nextCursor: rows.length === limit ? rows.at(-1).address : null,
        });
      }
      const matchPath =
        /^\/matches\/([1-9A-HJ-NP-Za-km-z]{32,44})(?:\/(state|cache|proof|workboard|mission))?$/.exec(
          path,
        );
      if (matchPath && req.method === "GET") {
        const match = asAddress(matchPath[1]),
          action = matchPath[2] ?? "state";
        limits.hit(`read:${req.socket.remoteAddress}`, 60, 60_000);
        if (action === "cache") {
          const genesis = await chain.genesis(),
            { rows } = await db.query(
              'SELECT slot,revision,observed_at AS "observedAt",projection FROM v3_match_projections WHERE network_key=$1 AND address=$2',
              [genesis, match],
            );
          requireThat(rows[0], 404, "V3_PROJECTION_NOT_FOUND");
          return json(res, 200, {
            authority: "projection-cache",
            commitment: "finalized",
            genesis,
            match,
            ...rows[0],
          });
        }
        if (action === "workboard")
          return json(
            res,
            200,
            await workboardV3(
              chain,
              match,
              Number(url.searchParams.get("seat") ?? 0),
            ),
          );
        const requested =
          url.searchParams.get("commitment") ??
          (action === "proof" ? "finalized" : "confirmed");
        requireThat(
          requested === "confirmed" || requested === "finalized",
          400,
          "V3_INVALID_COMMITMENT",
        );
        requireThat(
          action !== "proof" || requested === "finalized",
          400,
          "V3_PROOF_REQUIRES_FINALIZED",
        );
        const observed = await chain.read(match, requested),
          base = {
            schema: "dustpact-v3",
            authority: "validated-rpc-observation",
            commitment: observed.commitment,
            observedSlot: observed.slot,
            genesis: observed.genesis,
            match,
            program: PROGRAM_V3,
          };
        if (action === "mission")
          return json(res, 200, {
            ...base,
            ...missionBoardV3(
              observed.game,
              observed.mission,
              await chain.now(observed.slot),
            ),
          });
        if (action === "proof")
          return json(res, 200, {
            ...base,
            kind: "canonical-replay-material",
            rulesHash: hex(observed.game.rulesHash),
            contentHash: hex(observed.game.contentHash),
            projection: projectionV3(observed.game),
            mission: publicJsonV3(observed.mission),
            mathematicalReplay:
              "Client Rust/Wasm verification required; this service does not assert it ran.",
            paymentProof:
              "Vault status is an RPC observation, not a signed financial receipt.",
          });
        return json(res, 200, {
          ...base,
          projection: projectionV3(observed.game),
          mission: publicJsonV3(observed.mission),
        });
      }
      const session = await auth.session(req, origin, req.method !== "GET");
      if (path === "/auth/session" && req.method === "GET")
        return json(res, 200, {
          address: session.address,
          csrfToken: session.csrf_token,
          expiresAt: session.expires_at,
        });
      if (path === "/auth/logout" && req.method === "POST") {
        await auth.logout(session, res);
        chat.evictSession(session.token_hash);
        return json(res, 200, { loggedOut: true });
      }
      if (path === "/rooms" && req.method === "GET") {
        const requestedMatch=url.searchParams.has('matchAddress')?asAddress(url.searchParams.get('matchAddress')):null;
        const genesis = await chain.genesis(),
          { rows } = await db.query(
            'SELECT id,match_address AS "matchAddress",title,host_address AS "hostAddress",keeper_enabled AS "keeperEnabled",created_at AS "createdAt" FROM v3_rooms WHERE network_key=$1 AND ($2::text IS NULL OR match_address=$2) ORDER BY created_at DESC LIMIT 100',
            [genesis,requestedMatch],
          );
        return json(res, 200, {
          rooms: rows,
          genesis,
          advisory: "Room titles/chat are not on-chain obligations.",
        });
      }
      if (path === "/rooms" && req.method === "POST") {
        const input = await body(req);
        requireThat(
          Object.keys(input).every((k) =>
            ["matchAddress", "title", "ownerAddress", "keeperEnabled"].includes(
              k,
            ),
          ),
          400,
          "V3_UNKNOWN_ROOM_FIELD",
        );
        requireThat(
          input.keeperEnabled === undefined ||
            typeof input.keeperEnabled === "boolean",
          400,
          "V3_KEEPER_FLAG",
        );
        const match = asAddress(input.matchAddress),
          title = text(input.title, 60),
          member = await chain.member(
            match,
            asAddress(session.address),
            input.ownerAddress === undefined
              ? undefined
              : asAddress(input.ownerAddress),
          );
        // Only the actual creator may opt a match into convenience progression.
        const keeperEnabled = input.keeperEnabled === true;
        requireThat(
          member.owner === member.game.creator,
          403,
          "V3_CREATOR_REQUIRED",
        );
        const room = await transaction(db, async (c) => {
          await c.query("SELECT pg_advisory_xact_lock(60419742)");
          const old = await c.query(
            "SELECT * FROM v3_rooms WHERE network_key=$1 AND match_address=$2",
            [member.genesis, match],
          );
          if (old.rows[0]) return old.rows[0];
          const count = await c.query(
            "SELECT count(*)::int AS total FROM v3_rooms",
          );
          requireThat(count.rows[0].total < 2000, 429, "V3_ROOM_STORAGE_LIMIT");
          return (
            await c.query(
              "INSERT INTO v3_rooms(id,network_key,match_address,title,host_address,keeper_enabled) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
              [
                randomUUID(),
                member.genesis,
                match,
                title,
                member.owner,
                keeperEnabled,
              ],
            )
          ).rows[0];
        });
        return json(res, 200, room);
      }
      const roomPath =
        /^\/rooms\/([\da-f-]{36})\/(ticket|messages|moderate|keeper)$/.exec(
          path,
        );
      if (roomPath) {
        const room = await chat.room(roomPath[1]);
        await chain.isMember(
          asAddress(room.match_address),
          asAddress(session.address),
        );
        if (roomPath[2] === "ticket" && req.method === "POST")
          return json(res, 200, await chat.ticket(room.id, session));
        if (roomPath[2] === "messages" && req.method === "GET") {
          const clientId=url.searchParams.has('clientId')?chatClientId(url.searchParams.get('clientId')):null;
          const before =
            url.searchParams.get("before") ?? "9223372036854775807";
          postgresIdV3(before, "INVALID_CURSOR", true);
          const { rows } = await db.query(
            'SELECT id,address,CASE WHEN hidden_at IS NULL THEN body ELSE NULL END AS text,hidden_at IS NOT NULL AS hidden,client_id AS "clientId",created_at AS "createdAt" FROM v3_chat_messages WHERE room_id=$1 AND id<$2 AND ($3::uuid IS NULL OR (client_id=$3 AND address=$4)) ORDER BY id DESC LIMIT 100',
            [room.id,before,clientId,session.address],
          );
          return json(res, 200, {
            messages: rows.reverse(),
            nextCursor: rows.length === 100 ? rows[0].id : null,
          });
        }
        if (
          req.method === "POST" &&
          ["moderate", "keeper"].includes(roomPath[2])
        ) {
          const membership = await chain.member(
            asAddress(room.match_address),
            asAddress(session.address),
            asAddress(room.host_address),
          );
          requireThat(
            membership.owner === room.host_address,
            403,
            "HOST_REQUIRED",
          );
          const input = await body(req);
          if (roomPath[2] === "keeper") {
            requireThat(
              membership.owner === membership.game.creator &&
                typeof input.enabled === "boolean" &&
                Object.keys(input).length === 1,
              403,
              "V3_CREATOR_REQUIRED",
            );
            await db.query(
              "UPDATE v3_rooms SET keeper_enabled=$1 WHERE id=$2",
              [input.enabled, room.id],
            );
            return json(res, 200, { keeperEnabled: input.enabled });
          }
          if (input.messageId !== undefined) {
            postgresIdV3(input.messageId);
            await db.query(
              "UPDATE v3_chat_messages SET hidden_at=now() WHERE room_id=$1 AND id=$2",
              [room.id, input.messageId],
            );
            await chat.broadcast(room.id, {
              type: "moderated",
              messageId: input.messageId,
            });
          }
          if (input.muteAddress !== undefined)
            await db.query(
              "INSERT INTO v3_chat_mutes(room_id,address,expires_at) VALUES($1,$2,now()+interval '10 minutes') ON CONFLICT(room_id,address) DO UPDATE SET expires_at=EXCLUDED.expires_at",
              [room.id, asAddress(input.muteAddress)],
            );
          return json(res, 200, { moderated: true });
        }
      }
      if (path === "/reports" && req.method === "POST") {
        const input = await body(req);
        requireThat(
          typeof input.roomId === "string" &&
            /^[\da-f-]{36}$/.test(input.roomId),
          400,
          "V3_INVALID_REPORT",
        );
        postgresIdV3(input.messageId, "V3_INVALID_REPORT");
        const room = await chat.room(input.roomId);
        await chain.isMember(
          asAddress(room.match_address),
          asAddress(session.address),
        );
        limits.hit(`report:${session.address}`, 5, 60_000);
        const exists = await db.query(
          "SELECT 1 FROM v3_chat_messages WHERE id=$1 AND room_id=$2",
          [input.messageId, room.id],
        );
        requireThat(exists.rowCount, 404, "MESSAGE_NOT_FOUND");
        await db.query(
          "INSERT INTO v3_moderation_reports(room_id,message_id,reporter,reason) VALUES($1,$2,$3,$4)",
          [room.id, input.messageId, session.address, text(input.reason, 200)],
        );
        return json(res, 200, { reported: true });
      }
      throw new HttpError(404, "NOT_FOUND");
    })().catch((error) => {
      log("v3_request_rejected", {
        code: error instanceof HttpError ? error.code : "SERVICE_FAILURE",
      });
      if (!res.headersSent)
        json(res, error instanceof HttpError ? error.status : 503, {
          error: {
            code:
              error instanceof HttpError ? error.code : "SERVICE_UNAVAILABLE",
          },
        });
      else res.end();
    });
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  server.maxHeadersCount = 40;
  server.keepAliveTimeout = 5000;
  const chat = new V3Chat(db, cfg, auth, chain, server);
  const timer = setInterval(
    () =>
      void transaction(db, async (c) => {
        await c.query("DELETE FROM v3_ws_tickets WHERE expires_at<now()");
        await c.query("DELETE FROM v3_chat_mutes WHERE expires_at<now()");
      }).catch(() => log("v3_cleanup_failed")),
    60_000,
  );
  timer.unref();
  return {
    server,
    auth,
    chat,
    async close() {
      clearInterval(timer);
      await chat.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
