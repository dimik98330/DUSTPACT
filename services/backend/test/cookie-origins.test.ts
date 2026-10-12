import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { generateKeyPairSigner } from "@solana/kit";
import { configV2 as config } from "../src/v2-config.ts";
import { database, migrate } from "../src/db.ts";
import { createV2Api as createApi } from "../src/v2-api.ts";
const origins = ["http://127.0.0.1:4175", "http://127.0.0.1:4185"];
test("same browser cookie jar preserves independent main/recovery origins", async () => {
  const cfg = {...config(),origins},
    schema = `dustpact_test_${randomUUID().replaceAll("-", "")}`,
    admin = database(cfg.databaseUrl);
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const url = new URL(cfg.databaseUrl);
  url.searchParams.set("options", `-c search_path=${schema}`);
  const db = database(url.href);
  await migrate(db);
  const api = createApi(db, cfg);
  await new Promise<void>((r) => api.server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(api.server.address() as { port: number }).port}`,
    jar = new Map<string, string>();
  async function call(
    origin: string,
    path: string,
    payload?: unknown,
    csrf?: string,
  ) {
    const res = await fetch(`${base}/api/v2${path}`, {
      method: payload === undefined ? "GET" : "POST",
      headers: {
        Origin: origin,
        Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; "),
        ...(payload !== undefined
          ? { "content-type": "application/json" }
          : {}),
        ...(csrf ? { "x-csrf-token": csrf } : {}),
      },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    const cookie = res.headers.get("set-cookie");
    if (cookie) {
      const [name, value] = cookie.split(";")[0].split("=");
      if (value) jar.set(name, value);
      else jar.delete(name);
    }
    return { res, data: await res.json() };
  }
  try {
    const health = await fetch(`${base}/health/live`, {
      headers: { Origin: origins[0] },
    });
    assert.equal(health.status, 200);
    assert.equal(health.headers.get("access-control-allow-origin"), origins[0]);
    const preflight = await fetch(`${base}/health/live`, {
      method: "OPTIONS",
      headers: {
        Origin: origins[0],
        "access-control-request-method": "GET",
        "access-control-request-headers": "Content-Type",
      },
    });
    assert.equal(preflight.status, 204);
    assert.match(
      preflight.headers.get("access-control-allow-headers") ?? "",
      /Content-Type/,
    );
    const keys = await Promise.all([
        generateKeyPairSigner(),
        generateKeyPairSigner(),
      ]),
      csrf: string[] = [];
    for (let i = 0; i < 2; i++) {
      const c = (
        await call(origins[i], "/auth/challenge", {
          address: keys[i].address,
          origin: origins[i],
          cluster: cfg.cluster,
        })
      ).data;
      const signature = Buffer.from(
        await crypto.subtle.sign(
          "Ed25519",
          keys[i].keyPair.privateKey,
          Buffer.from(c.message),
        ),
      ).toString("base64");
      const verified = await call(origins[i], "/auth/verify", {
        challengeId: c.challengeId,
        signature,
      });
      assert.equal(verified.res.status, 200);
      csrf.push(verified.data.csrfToken);
    }
    assert.equal(
      jar.size,
      2,
      "Cookies must use distinct origin suffixes despite same API host",
    );
    for (let i = 0; i < 2; i++) {
      const session = await call(origins[i], "/auth/session");
      assert.equal(session.res.status, 200);
      assert.equal(session.data.address, keys[i].address);
    }
    await call(origins[0], "/auth/logout", {}, csrf[0]);
    assert.equal(jar.size, 1);
    assert.equal((await call(origins[0], "/auth/session")).res.status, 401);
    assert.equal(
      (await call(origins[1], "/auth/session")).data.address,
      keys[1].address,
    );
  } finally {
    await api.close();
    await db.end();
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  }
});
