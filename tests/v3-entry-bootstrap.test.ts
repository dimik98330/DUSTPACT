import { test } from "node:test";
import assert from "node:assert/strict";
import { getAddressDecoder } from "@solana/kit";
import {V3Client as NativeV3Client,matchAddress,PROGRAM_V3} from '../packages/solana-v3/src/index';
import {
  SYSTEM,
  type GameV3,
  type V3Client,
} from "../packages/solana-v3/src/index";
import { completeAgentRoster } from "../apps/web/src/v2/entry-bootstrap";
const owners = Array.from({ length: 7 }, (_, i) =>
  getAddressDecoder().decode(new Uint8Array(32).fill(i + 1)),
);
function fixture(count = 1) {
  const state = {
    creator: owners[0],
    phase: 0,
    count,
    mission: SYSTEM,
    eligibleMask: 0,
    npcMask: 0,
    missionRoster: 0,
    roster: 1,
    seats: owners.slice(0, count).map((owner) => ({ owner })),
  } as GameV3;
  const calls: string[] = [];
  let failSeat: number | undefined;
  const host = {
    signer: { address: owners[0] } as V3Client["signer"],
    read: async () => structuredClone(state),
    configureMission: async (_match: unknown, mask: number) => {
      calls.push(`configure:${mask}`);
      state.npcMask = mask;
      state.missionRoster = state.roster;
    },
  };
  const botAt = async (seat: number) => ({
    signer: { address: owners[seat] } as V3Client["signer"],
    fundLocal: async () => {
      calls.push(`fund:${seat}`);
    },
    join: async () => {
      calls.push(`join:${seat}`);
      if (failSeat === seat) throw Error("fixture transport failure");
      state.seats[seat] = { owner: owners[seat] } as GameV3["seats"][number];
      state.count++;
      state.roster++;
    },
  });
  return {
    state,
    calls,
    host,
    botAt,
    fail(seat?: number) {
      failSeat = seat;
    },
  };
}
test("entry retry continues the same partially created roster and does not replace existing seats", async () => {
  const f = fixture(2);
  const bots = await completeAgentRoster(f.host, owners[6], 4, f.botAt);
  assert.equal(bots.length, 3);
  assert.deepEqual(f.calls, [
    "fund:2",
    "join:2",
    "fund:3",
    "join:3",
    "configure:14",
  ]);
  f.calls.length = 0;
  await completeAgentRoster(f.host, owners[6], 4, f.botAt);
  assert.deepEqual(f.calls, []);
});
test("a failed companion join resumes from confirmed membership on retry", async () => {
  const f = fixture();
  f.fail(2);
  await assert.rejects(
    () => completeAgentRoster(f.host, owners[6], 4, f.botAt),
    /transport failure/,
  );
  assert.equal(f.state.count, 2);
  f.calls.length = 0;
  f.fail();
  await completeAgentRoster(f.host, owners[6], 4, f.botAt);
  assert.deepEqual(f.calls, [
    "fund:2",
    "join:2",
    "fund:3",
    "join:3",
    "configure:14",
  ]);
});
test("occupied human seats, paid missions and started games are never overwritten by bootstrap", async () => {
  const f = fixture(2);
  f.state.seats[1].owner = owners[5];
  await assert.rejects(
    () => completeAgentRoster(f.host, owners[6], 4, f.botAt),
    /different player owns/,
  );
  assert.deepEqual(f.calls, []);
  for (const mutate of [
    (s: GameV3) => {
      s.mission = owners[6];
    },
    (s: GameV3) => {
      s.phase = 1;
    },
    (s: GameV3) => {
      s.creator = owners[5];
    },
  ]) {
    const f = fixture();
    mutate(f.state);
    await assert.rejects(() =>
      completeAgentRoster(f.host, owners[6], 4, f.botAt),
    );
    assert.deepEqual(f.calls, []);
  }
});
test("five and six seat agent parties retain exact NPC masks", async () => {
  for (const count of [5, 6]) {
    const f = fixture();
    await completeAgentRoster(f.host, owners[6], count, f.botAt);
    assert.equal(f.state.count, count);
    assert.equal(f.state.npcMask, ((1 << count) - 1) ^ 1);
  }
});
test('a mission enabled between roster reads is preserved and no companion is joined',async()=>{
 const f=fixture(2);let reads=0;const read=f.host.read;f.host.read=async()=>{if(++reads===2){f.state.mission=owners[6];f.state.eligibleMask=3;}return read();};
 await assert.rejects(()=>completeAgentRoster(f.host,owners[6],5,f.botAt));assert.deepEqual(f.calls,[]);assert.equal(f.state.mission,owners[6]);assert.equal(f.state.count,2);
});
test('confirmed create exposes its address before a failed post-send RPC read',async()=>{
 // Isolated transport stub: no RPC or signature. Exercise the real SDK create method ordering.
 let sent=false,retained='';const nonce=new Uint8Array(16).fill(4),[expected]=await matchAddress(owners[0],nonce);
 const client=Object.assign(Object.create(NativeV3Client.prototype),{signer:{address:owners[0]},ix:async()=>({programAddress:PROGRAM_V3,accounts:[{address:expected,role:1},{address:owners[0],role:3}],data:new Uint8Array()}),sendTyped:async()=>{sent=true;},read:async()=>{throw Error('fixture post-send read failed');}})as NativeV3Client;
 await assert.rejects(()=>client.create(nonce,match=>{assert.equal(sent,true);retained=match;}),/post-send read failed/);assert.equal(retained,expected);
});
