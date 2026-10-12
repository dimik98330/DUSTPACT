import {
  createHash,
  randomBytes,
  timingSafeEqual,
  createPublicKey,
  verify,
} from "node:crypto";
import { getAddressEncoder, address } from "@solana/kit";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Config } from "./config.ts";
export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}
export function requireThat(
  condition: unknown,
  status = 400,
  code = "INVALID_REQUEST",
): asserts condition {
  if (!condition) throw new HttpError(status, code);
}
export const digest = (input: string | Uint8Array) =>
  createHash("sha256").update(input).digest("hex");
export const token = () => randomBytes(32).toString("base64url");
export function equal(a: string, b: string) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export function asAddress(v: unknown) {
  requireThat(typeof v === "string", 400, "INVALID_ADDRESS");
  try {
    return address(v);
  } catch {
    throw new HttpError(400, "INVALID_ADDRESS");
  }
}
export function decodeBase64(value: unknown, max = 4096) {
  requireThat(
    typeof value === "string" &&
      value.length <= max * 2 &&
      /^[A-Za-z0-9+/]*={0,2}$/.test(value),
    400,
    "INVALID_BASE64",
  );
  const bytes = Buffer.from(value, "base64");
  requireThat(
    bytes.length <= max && bytes.toString("base64") === value,
    400,
    "INVALID_BASE64",
  );
  return bytes;
}
export function signatureValid(
  owner: string,
  message: Uint8Array,
  signature: Uint8Array,
) {
  if (signature.length !== 64) return false;
  const raw = getAddressEncoder().encode(asAddress(owner));
  const key = createPublicKey({
    key: Buffer.concat([
      Buffer.from("302a300506032b6570032100", "hex"),
      Buffer.from(raw),
    ]),
    format: "der",
    type: "spki",
  });
  return verify(null, message, key, signature);
}
export function originOf(req: IncomingMessage, cfg: Config) {
  const origin = req.headers.origin;
  requireThat(
    typeof origin === "string" && cfg.origins.includes(origin),
    403,
    "ORIGIN_REJECTED",
  );
  return origin;
}
export function cookies(req: IncomingMessage) {
  return Object.fromEntries(
    (req.headers.cookie ?? "")
      .split(";")
      .map((p) => p.trim().split("="))
      .filter((p) => p.length === 2),
  );
}
export function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
    "referrer-policy": "no-referrer",
  });
  res.end(
    JSON.stringify(body, (_, v) => (typeof v === "bigint" ? v.toString() : v)),
  );
}
export async function body(
  req: IncomingMessage,
  max = 8192,
): Promise<Record<string, unknown>> {
  requireThat(
    req.headers["content-type"]?.split(";")[0] === "application/json",
    415,
    "JSON_REQUIRED",
  );
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    requireThat(size <= max, 413, "BODY_TOO_LARGE");
    chunks.push(Buffer.from(chunk));
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    requireThat(value && typeof value === "object" && !Array.isArray(value));
    return value;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "INVALID_JSON");
  }
}
export function text(v: unknown, max = 500) {
  requireThat(typeof v === "string", 400, "TEXT_REQUIRED");
  const value = v.normalize("NFC").trim();
  requireThat(
    value.length > 0 &&
      Array.from(value).length <= max &&
      !/[\u0000-\u0008\u000b-\u001f\u007f]/.test(value),
    400,
    "TEXT_LIMIT",
  );
  return value;
}
export class RateLimit {
  private buckets = new Map<string, { count: number; end: number }>();
  hit(key: string, limit: number, windowMs: number) {
    const now = Date.now();
    let b = this.buckets.get(key);
    if (!b || b.end <= now) {
      if (this.buckets.size >= 10_000) {
        for (const [k, v] of this.buckets)
          if (v.end <= now) this.buckets.delete(k);
        requireThat(this.buckets.size < 10_000, 429, "RATE_LIMIT_CAPACITY");
      }
      b = { count: 0, end: now + windowMs };
      this.buckets.set(key, b);
    }
    requireThat(++b.count <= limit, 429, "RATE_LIMIT");
  }
}
export function log(
  event: string,
  fields: Record<string, string | number | boolean> = {},
) {
  process.stdout.write(
    `${JSON.stringify({ time: new Date().toISOString(), event, ...fields })}\n`,
  );
}
