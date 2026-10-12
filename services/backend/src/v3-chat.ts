import { WebSocket, WebSocketServer } from "ws";
import type { Server, IncomingMessage } from "node:http";
import type { Pool } from "pg";
import type { Config } from "./config.ts";
import { Auth, type Session } from "./auth.ts";
import { V3Chain } from "./v3-chain.ts";
import {
  asAddress,
  decodeBase64,
  digest,
  HttpError,
  log,
  originOf,
  RateLimit,
  requireThat,
  text,
  token,
} from "./security.ts";
import { transaction } from "./db-v3.ts";
import { chatClientId, storeChatMessageV3 } from './v3-chat-message.ts';
type Peer = {
  ws: WebSocket;
  room: string;
  address: string;
  session: Session;
  lastPong: number;
};
export class V3Chat {
  readonly wss = new WebSocketServer({
    noServer: true,
    maxPayload: 4096,
    perMessageDeflate: false,
  });
  private peers = new Set<Peer>();
  private messageQueues = new Map<
    string,
    { tail: Promise<void>; pending: number }
  >();
  private pendingMessages = 0;
  private pendingUpgrades = new Set<{ room: string; address?: string }>();
  private limits = new RateLimit();
  private timer: NodeJS.Timeout;
  constructor(
    readonly db: Pool,
    readonly cfg: Config,
    readonly auth: Auth,
    readonly chain: V3Chain,
    server: Server,
  ) {
    server.on("upgrade", (req, socket, head) => {
      let reserved: { room: string; address?: string } | undefined;
      const timeout = setTimeout(() => socket.destroy(), 15_000);
      void (async () => {
        const url = new URL(req.url ?? "/", `http://${req.headers.host}`),
          path = /^\/api\/v2\/rooms\/([\da-f-]{36})\/socket$/.exec(
            url.pathname,
          );
        requireThat(path, 404, "NOT_FOUND");
        const origin = originOf(req, cfg);
        this.limits.hit(`upgrade:${req.socket.remoteAddress}`, 20, 10_000);
        requireThat(
          this.peers.size + this.pendingUpgrades.size < 200,
          429,
          "SOCKET_CAPACITY",
        );
        requireThat(
          [...this.peers].filter((p) => p.room === path[1]).length +
            [...this.pendingUpgrades].filter((p) => p.room === path[1]).length <
            12,
          429,
          "ROOM_CAPACITY",
        );
        reserved = { room: path[1] };
        this.pendingUpgrades.add(reserved);
        const session = await auth.session(req, origin),
          raw = url.searchParams.get("ticket");
        requireThat(raw && /^[\w-]{43}$/.test(raw), 401, "TICKET_REQUIRED");
        requireThat(
          [...this.peers].filter((p) => p.address === session.address).length +
            [...this.pendingUpgrades].filter(
              (p) => p.address === session.address,
            ).length <
            2,
          429,
          "CONNECTION_LIMIT",
        );
        reserved.address = session.address;
        await transaction(db, async (c) => {
          const consumed = await c.query(
            "DELETE FROM v3_ws_tickets WHERE token_hash=$1 AND room_id=$2 AND session_hash=$3 AND expires_at>now() RETURNING room_id",
            [digest(raw), path[1], session.token_hash],
          );
          requireThat(consumed.rowCount === 1, 401, "TICKET_EXPIRED_OR_USED");
        });
        const room = await this.room(path[1]);
        await chain.isMember(
          asAddress(room.match_address),
          asAddress(session.address),
        );
        requireThat(
          !socket.destroyed &&
            this.peers.size + this.pendingUpgrades.size <= 200 &&
            [...this.peers].filter((p) => p.address === session.address)
              .length +
              [...this.pendingUpgrades].filter(
                (p) => p.address === session.address,
              ).length <=
              2,
          429,
          "CONNECTION_LIMIT",
        );
        this.wss.handleUpgrade(req, socket, head, (ws) => {
          if (reserved) {
            this.pendingUpgrades.delete(reserved);
            reserved = undefined;
          }
          this.connected(ws, path[1], session);
        });
      })()
        .catch((error) => {
          const status = error instanceof HttpError ? error.status : 503;
          if (!socket.destroyed)
            socket.write(
              `HTTP/1.1 ${status} Rejected\r\nConnection: close\r\n\r\n`,
            );
          socket.destroy();
        })
        .finally(() => {
          clearTimeout(timeout);
          if (reserved) this.pendingUpgrades.delete(reserved);
        });
    });
    this.timer = setInterval(() => {
      for (const peer of this.peers) {
        if (Date.now() - peer.lastPong > 60_000)
          peer.ws.close(1008, "Session expired");
        else peer.ws.ping();
      }
      for (const room of new Set([...this.peers].map((p) => p.room)))
        void this.authorizedPeers(room);
    }, 25_000);
    this.timer.unref();
  }
  async room(id: string) {
    const { rows } = await this.db.query("SELECT * FROM v3_rooms WHERE id=$1", [
      id,
    ]);
    requireThat(rows[0], 404, "ROOM_NOT_FOUND");
    requireThat(
      rows[0].network_key === (await this.chain.genesis()),
      409,
      "V3_ROOM_NETWORK_MISMATCH",
    );
    return rows[0];
  }
  async ticket(room: string, session: Session) {
    const record = await this.room(room);
    await this.chain.isMember(
      asAddress(record.match_address),
      asAddress(session.address),
    );
    const raw = token();
    await transaction(this.db, async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        session.token_hash,
      ]);
      await c.query(
        "DELETE FROM v3_ws_tickets WHERE session_hash=$1 AND room_id=$2",
        [session.token_hash, room],
      );
      await c.query(
        "INSERT INTO v3_ws_tickets(token_hash,session_hash,room_id,expires_at) VALUES($1,$2,$3,now()+interval '45 seconds')",
        [digest(raw), session.token_hash, room],
      );
    });
    return { ticket: raw, expiresIn: 45 };
  }
  private connected(ws: WebSocket, room: string, session: Session) {
    const peer: Peer = {
      ws,
      room,
      address: session.address,
      session,
      lastPong: Date.now(),
    };
    this.peers.add(peer);
    ws.on("pong", () => (peer.lastPong = Date.now()));
    ws.on("close", () => {
      this.peers.delete(peer);
      this.presence(room);
    });
    ws.on("error", () => {});
    ws.on("message", (data, isBinary) => {
      let clientId:string|undefined;
      void (async () => {
        requireThat(!isBinary, 400, "TEXT_ONLY");
        this.limits.hit(`messages:${session.address}`, 6, 10_000);
        const value = JSON.parse(data.toString());
        requireThat(
          value?.type === "message" &&
            Object.keys(value).every((k) => ["type", "text", "clientId"].includes(k)),
          400,
          "CHAT_TYPE",
        );
        const message = text(value.text);
        clientId=chatClientId(value.clientId);
        await this.enqueue(room, async () => {
          requireThat(session.expires_at > new Date(), 401, "SESSION_EXPIRED");
          const exists = await this.db.query(
            "SELECT 1 FROM auth_sessions WHERE token_hash=$1 AND expires_at>now()",
            [session.token_hash],
          );
          requireThat(exists.rowCount, 401, "SESSION_EXPIRED");
          const roomRecord = await this.room(room);
          await this.chain.isMember(
            asAddress(roomRecord.match_address),
            asAddress(session.address),
          );
          const muted = await this.db.query(
            "SELECT 1 FROM v3_chat_mutes WHERE room_id=$1 AND address=$2 AND expires_at>now()",
            [room, session.address],
          );
          requireThat(!muted.rowCount, 403, "CHAT_MUTED");
          const saved=await storeChatMessageV3(this.db,room,session.address,message,clientId);
          // Persistence ACK is distinct from peer visibility; broadcast may fail later.
          if(clientId)this.send(ws,{type:'ack',clientId,message:saved.message});
          if(saved.created)await this.broadcast(room, { type: "message", message:saved.message });
        });
      })().catch((error) => {
        this.send(ws, {
          type: "error",
          ...(clientId?{clientId}:{}),
          code:
            error instanceof HttpError ? error.code : "INVALID_CHAT_MESSAGE",
        });
        if (error instanceof HttpError && error.status === 401)
          ws.close(1008, "Session expired");
      });
    });
    this.presence(room);
  }
  private send(ws: WebSocket, payload: unknown) {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > 64_000) {
      ws.close(1013, "Slow client");
      return;
    }
    ws.send(JSON.stringify(payload));
  }
  private enqueue(room: string, task: () => Promise<void>) {
    let queue = this.messageQueues.get(room);
    if (!queue) {
      queue = { tail: Promise.resolve(), pending: 0 };
    }
    requireThat(
      queue.pending < 12 && this.pendingMessages < 200,
      429,
      "CHAT_BUSY",
    );
    this.messageQueues.set(room, queue);
    queue.pending++;
    this.pendingMessages++;
    const active = queue,
      work = queue.tail.then(task);
    queue.tail = work.catch(() => {});
    return work.finally(() => {
      active.pending--;
      this.pendingMessages--;
      if (active.pending === 0) this.messageQueues.delete(room);
    });
  }
  private async authorizedPeers(room: string) {
    const peers = [...this.peers].filter((p) => p.room === room);
    if (!peers.length) return [];
    try {
      const record = await this.room(room),
        read = await this.chain.read(asAddress(record.match_address));
      const occupied = read.game.seats.slice(0, read.game.count),
        owners = new Set<string>(occupied.map((seat) => seat.owner)),
        candidates = (peer: Peer) =>
          occupied.filter(
            (seat) => seat.session === peer.address && seat.quota > 0,
          ),
        needsClock = peers.some(
          (peer) => !owners.has(peer.address) && candidates(peer).length > 0,
        );
      let now: number | undefined;
      if (needsClock) {
        try {
          now = await this.chain.now(read.slot);
        } catch {
          /* Only clock-dependent delegates fail closed below. */
        }
      }
      const active = await this.db.query(
          "SELECT token_hash FROM auth_sessions WHERE token_hash=ANY($1::text[]) AND expires_at>now()",
          [peers.map((p) => p.session.token_hash)],
        ),
        sessions = new Set(active.rows.map((r) => r.token_hash));
      const allowed: Peer[] = [];
      for (const peer of peers) {
        const owner = owners.has(peer.address),
          possible = candidates(peer),
          clockMissing = !owner && possible.length > 0 && now === undefined,
          member =
            owner ||
            (now !== undefined &&
              possible.some((seat) => Number(seat.expires) > now));
        if (sessions.has(peer.session.token_hash) && member) allowed.push(peer);
        else {
          this.peers.delete(peer);
          peer.ws.close(
            clockMissing ? 1013 : 1008,
            clockMissing ? "Chain clock unavailable" : "Authorization expired",
          );
        }
      }
      return allowed;
    } catch {
      for (const peer of peers) {
        this.peers.delete(peer);
        peer.ws.close(1013, "Membership unavailable");
      }
      return [];
    }
  }
  evictSession(sessionHash: string) {
    for (const peer of this.peers)
      if (peer.session.token_hash === sessionHash) {
        this.peers.delete(peer);
        peer.ws.close(1008, "Signed out");
      }
  }
  async broadcast(room: string, payload: unknown) {
    for (const peer of await this.authorizedPeers(room))
      this.send(peer.ws, payload);
  }
  private presence(room: string) {
    void this.broadcast(room, {
      type: "presence",
      addresses: [
        ...new Set(
          [...this.peers].filter((p) => p.room === room).map((p) => p.address),
        ),
      ],
    });
  }
  async close() {
    clearInterval(this.timer);
    for (const peer of this.peers) peer.ws.close(1001, "Service stopping");
    await Promise.allSettled(
      [...this.messageQueues.values()].map((queue) => queue.tail),
    );
    await new Promise<void>((r) => this.wss.close(() => r()));
  }
}
