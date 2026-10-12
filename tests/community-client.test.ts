import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSigner, type TransactionSigner } from "@solana/kit";
import { CommunityClient } from "../packages/ui/src/community";
const origin = "http://127.0.0.1:4175";
test('cancelled login cannot prompt or verify after a delayed challenge',async()=>{
  const actor=await generateKeyPairSigner(),original=globalThis.fetch,abort=new AbortController();let release!:(r:Response)=>void,asks=0,verifies=0;
  const delayed=new Promise<Response>(r=>release=r);
  globalThis.fetch=async input=>String(input).endsWith('/auth/session')?new Response(JSON.stringify({error:{code:'AUTH_REQUIRED'}}),{status:401}):String(input).endsWith('/auth/challenge')?delayed:(verifies++,new Response('{}'));
  const signer={...actor,signMessages:async(...args:Parameters<typeof actor.signMessages>)=>{asks++;return actor.signMessages(...args);}};
  try{const work=new CommunityClient('http://127.0.0.1:4182',origin,'localnet').authenticate(signer,{abortSignal:abort.signal});await new Promise(r=>setTimeout(r,0));abort.abort();release(new Response(JSON.stringify(challenge(actor.address))));await assert.rejects(work,{name:'AbortError'});assert.equal(asks,0);assert.equal(verifies,0);}
  finally{globalThis.fetch=original;}
});
test('late message approval after context cancellation is never verified',async()=>{
  const actor=await generateKeyPairSigner(),original=globalThis.fetch,abort=new AbortController();let release!:()=>void,started!:()=>void,verifies=0;
  const gate=new Promise<void>(r=>release=r),signing=new Promise<void>(r=>started=r);
  globalThis.fetch=async input=>String(input).endsWith('/auth/session')?new Response(JSON.stringify({error:{code:'AUTH_REQUIRED'}}),{status:401}):String(input).endsWith('/auth/challenge')?new Response(JSON.stringify(challenge(actor.address))):(verifies++,new Response('{}'));
  const signer={...actor,signMessages:async(...args:Parameters<typeof actor.signMessages>)=>{started();await gate;return actor.signMessages(...args);}};
  try{const work=new CommunityClient('http://127.0.0.1:4182',origin,'localnet').authenticate(signer,{abortSignal:abort.signal});await signing;abort.abort();release();await assert.rejects(work,{name:'AbortError'});assert.equal(verifies,0);}
  finally{globalThis.fetch=original;}
});
function challenge(address: string, context = origin) {
  const issued = new Date(),
    expires = new Date(issued.getTime() + 300000);
  return {
    challengeId: "00000000-0000-0000-0000-000000000001",
    expiresAt: expires.toISOString(),
    message: `${new URL(context).host} wants you to sign in to DUSTPACT:\n${address}\n\nSign in to the optional chat service. This does not authorize game actions or transfer funds.\n\nURI: ${context}\nVersion: 1\nChain ID: solana:localnet\nNonce: ${"a".repeat(43)}\nIssued At: ${issued.toISOString()}\nExpiration Time: ${expires.toISOString()}`,
  };
}
test("chat login signs the exact scoped challenge and sends no transaction", async () => {
  const actor = await generateKeyPairSigner(),
    c = challenge(actor.address),
    original = globalThis.fetch;
  let verified = false;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    assert.equal(init?.credentials, "include");
    if (url.endsWith("/auth/session"))
      return new Response(
        JSON.stringify({ error: { code: "AUTH_REQUIRED" } }),
        { status: 401 },
      );
    if (url.endsWith("/auth/challenge")) {
      assert.deepEqual(JSON.parse(String(init?.body)), {
        address: actor.address,
        origin,
        cluster: "localnet",
      });
      return new Response(JSON.stringify(c));
    }
    assert.ok(url.endsWith("/auth/verify"));
    const body = JSON.parse(String(init?.body));
    assert.equal(body.challengeId, c.challengeId);
    verified = await crypto.subtle.verify(
      "Ed25519",
      actor.keyPair.publicKey,
      Buffer.from(body.signature, "base64"),
      new TextEncoder().encode(c.message),
    );
    return new Response(
      JSON.stringify({
        address: actor.address,
        csrfToken: "c".repeat(43),
        expiresAt: new Date().toISOString(),
      }),
    );
  };
  try {
    const session = await new CommunityClient(
      "http://127.0.0.1:4182",
      origin,
      "localnet",
    ).authenticate(actor);
    assert.equal(session.address, actor.address);
    assert.equal(verified, true);
  } finally {
    globalThis.fetch = original;
  }
});
test("malicious purpose or origin is rejected before asking a signer", async () => {
  const actor = await generateKeyPairSigner(),
    original = globalThis.fetch;
  let asks = 0;
  const signer = {
    ...actor,
    signMessages: async (...args: Parameters<typeof actor.signMessages>) => {
      asks++;
      return actor.signMessages(...args);
    },
  };
  for (const altered of [
    challenge(actor.address, "https://evil.example"),
    {
      ...challenge(actor.address),
      message: challenge(actor.address).message.replace(
        "Sign in to the optional chat service.",
        "Authorize a transfer.",
      ),
    },
  ]) {
    globalThis.fetch = async (input) =>
      String(input).endsWith("/auth/session")
        ? new Response(JSON.stringify({ error: { code: "AUTH_REQUIRED" } }), {
            status: 401,
          })
        : new Response(JSON.stringify(altered));
    try {
      await assert.rejects(
        () =>
          new CommunityClient(
            "http://127.0.0.1:4182",
            origin,
            "localnet",
          ).authenticate(signer),
        /Запрос подписи/,
      );
    } finally {
      globalThis.fetch = original;
    }
  }
  assert.equal(asks, 0);
});
test("active matching cookie session avoids another wallet signature", async () => {
  const actor = await generateKeyPairSigner(),
    original = globalThis.fetch;
  let asks = 0;
  const signer = {
    ...actor,
    signMessages: async (...args: Parameters<typeof actor.signMessages>) => {
      asks++;
      return actor.signMessages(...args);
    },
  };
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        address: actor.address,
        csrfToken: "c".repeat(43),
        expiresAt: new Date().toISOString(),
      }),
    );
  try {
    await new CommunityClient(
      "http://127.0.0.1:4182",
      origin,
      "localnet",
    ).authenticate(signer);
    assert.equal(asks, 0);
  } finally {
    globalThis.fetch = original;
  }
});
test("chat service outage fails without requesting a signature", async () => {
  const actor = await generateKeyPairSigner(),
    original = globalThis.fetch;
  let asks = 0;
  const signer = {
    ...actor,
    signMessages: async (...args: Parameters<typeof actor.signMessages>) => {
      asks++;
      return actor.signMessages(...args);
    },
  } as TransactionSigner;
  globalThis.fetch = async () => {
    throw Error("offline");
  };
  try {
    await assert.rejects(
      () =>
        new CommunityClient(
          "http://127.0.0.1:4182",
          origin,
          "localnet",
        ).authenticate(signer),
      /продолжает работать через Solana/,
    );
    assert.equal(asks, 0);
  } finally {
    globalThis.fetch = original;
  }
});
