import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Config } from "./config.ts";
import {
  asAddress,
  requireThat,
  token,
  digest,
  signatureValid,
  decodeBase64,
  cookies,
  equal,
} from "./security.ts";
import { transaction } from "./db.ts";
export type Session = {
  address: string;
  origin: string;
  csrf_token: string;
  token_hash: string;
  expires_at: Date;
  auth_scope: string;
};
export class Auth {
  constructor(
    readonly db: Pool,
    readonly cfg: Config,
    readonly options: {scope?:string;statement?:string} = {},
  ) {}
  private get scope(){return this.options.scope??'chat';}
  private get nonceCluster(){return this.scope==='chat'?this.cfg.cluster:`${this.cfg.cluster}:${this.scope}`;}
  cookieName(origin: string) {
    return `${this.cfg.cookieName}-${digest(origin).slice(0, 12)}`;
  }
  async challenge(input: Record<string, unknown>, origin: string) {
    const address = asAddress(input.address);
    requireThat(
      input.origin === origin && input.cluster === this.cfg.cluster,
      400,
      "AUTH_CONTEXT_MISMATCH",
    );
    const id = randomUUID(),
      nonce = token(),
      clock = (
        await this.db.query(
          "SELECT now() AS issued,now()+interval '5 minutes' AS expires",
        )
      ).rows[0],
      issued = clock.issued as Date,
      expires = clock.expires as Date;
    const statement=this.options.statement??'Sign in to the optional chat service. This does not authorize game actions or transfer funds.';
    const message = `${new URL(origin).host} wants you to sign in to DUSTPACT:\n${address}\n\n${statement}\n\nURI: ${origin}\nVersion: 1\nChain ID: solana:${this.cfg.cluster}\nNonce: ${nonce}\nIssued At: ${issued.toISOString()}\nExpiration Time: ${expires.toISOString()}`;
    return transaction(this.db, async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(60419706)");
      await c.query("DELETE FROM auth_nonces WHERE expires_at<now()");
      const existing = await c.query(
        "SELECT id,message,expires_at FROM auth_nonces WHERE address=$1 AND origin=$2 AND cluster=$3 AND used_at IS NULL AND expires_at>now() ORDER BY expires_at DESC LIMIT 1",
        [address, origin, this.nonceCluster],
      );
      if (existing.rows[0])
        return {
          challengeId: existing.rows[0].id,
          message: existing.rows[0].message,
          expiresAt: existing.rows[0].expires_at.toISOString(),
        };
      const count = await c.query(
        "SELECT count(*)::int AS total FROM auth_nonces",
      );
      requireThat(count.rows[0].total < 5000, 429, "AUTH_STORAGE_LIMIT");
      await c.query(
        "INSERT INTO auth_nonces(id,address,origin,cluster,message,expires_at) VALUES($1,$2,$3,$4,$5,$6)",
        [id, address, origin, this.nonceCluster, message, expires],
      );
      return { challengeId: id, message, expiresAt: expires.toISOString() };
    });
  }
  async verify(
    input: Record<string, unknown>,
    origin: string,
    res: ServerResponse,
  ) {
    requireThat(
      typeof input.challengeId === "string" &&
        /^[\da-f-]{36}$/.test(input.challengeId),
      400,
      "INVALID_CHALLENGE",
    );
    const signature = decodeBase64(input.signature, 64);
    const result = await transaction(this.db, async (c) => {
      const { rows } = await c.query(
        "SELECT * FROM auth_nonces WHERE id=$1 AND expires_at>now() FOR UPDATE",
        [input.challengeId],
      );
      const challenge = rows[0];
      requireThat(
        challenge &&
          !challenge.used_at &&
          challenge.origin === origin &&
          challenge.cluster === this.nonceCluster,
        401,
        "CHALLENGE_EXPIRED_OR_USED",
      );
      requireThat(
        signatureValid(
          challenge.address,
          Buffer.from(challenge.message),
          signature,
        ),
        401,
        "SIGNATURE_REJECTED",
      );
      await c.query("UPDATE auth_nonces SET used_at=now() WHERE id=$1", [
        input.challengeId,
      ]);
      await c.query("SELECT pg_advisory_xact_lock(60419707)");
      await c.query("DELETE FROM auth_sessions WHERE expires_at<now()");
      const capacity = await c.query(
        "SELECT count(*)::int AS total,count(*) FILTER(WHERE address=$1)::int AS owned FROM auth_sessions",
        [challenge.address],
      );
      requireThat(
        capacity.rows[0].total < 10_000 && capacity.rows[0].owned < 8,
        429,
        "SESSION_STORAGE_LIMIT",
      );
      const raw = token(),
        csrf = token(),
        expires = (await c.query("SELECT now()+interval '12 hours' AS expires"))
          .rows[0].expires as Date;
      await c.query(
        "INSERT INTO wallet_profiles(address) VALUES($1) ON CONFLICT DO NOTHING",
        [challenge.address],
      );
      await c.query(
        "INSERT INTO auth_sessions(token_hash,address,origin,csrf_token,expires_at,auth_scope) VALUES($1,$2,$3,$4,$5,$6)",
        [digest(raw), challenge.address, origin, csrf, expires,this.scope],
      );
      return {
        raw,
        address: challenge.address,
        csrfToken: csrf,
        expiresAt: expires.toISOString(),
      };
    });
    res.setHeader(
      "set-cookie",
      `${this.cookieName(origin)}=${result.raw}; HttpOnly; Path=/; SameSite=Strict; Max-Age=43200${this.cfg.production ? "; Secure" : ""}`,
    );
    return {
      address: result.address,
      csrfToken: result.csrfToken,
      expiresAt: result.expiresAt,
    };
  }
  async session(
    req: IncomingMessage,
    origin: string,
    mutation = false,
  ): Promise<Session> {
    const raw = cookies(req)[this.cookieName(origin)];
    requireThat(raw && /^[\w-]{43}$/.test(raw), 401, "AUTH_REQUIRED");
    const { rows } = await this.db.query(
      "SELECT * FROM auth_sessions WHERE token_hash=$1 AND expires_at>now() AND auth_scope=$2",
      [digest(raw),this.scope],
    );
    const session = rows[0];
    requireThat(session && session.origin === origin && session.auth_scope===this.scope, 401, "AUTH_REQUIRED");
    if (mutation)
      requireThat(
        typeof req.headers["x-csrf-token"] === "string" &&
          equal(req.headers["x-csrf-token"], session.csrf_token),
        403,
        "CSRF_REJECTED",
      );
    return session;
  }
  async logout(session: Session, res: ServerResponse) {
    await this.db.query("DELETE FROM auth_sessions WHERE token_hash=$1", [
      session.token_hash,
    ]);
    res.setHeader(
      "set-cookie",
      `${this.cookieName(session.origin)}=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0${this.cfg.production ? "; Secure" : ""}`,
    );
  }
}
