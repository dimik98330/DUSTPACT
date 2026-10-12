import assert from'node:assert/strict';import{readFile}from'node:fs/promises';import{test}from'node:test';
import{loadV2Kernel}from'../packages/engine/src/v2';import{verifyV2History}from'../packages/engine/src/v2-replay';import{decodeGameV2}from'../packages/solana-v2/src/decode';
await loadV2Kernel(new Uint8Array(await readFile('apps/web/public/engine/rules-v2.wasm')).buffer);
for(const count of[4,5,6])test(`V2 native SBF history N${count} is reproducible in actual Wasm including scores`,async()=>{
 const g=await decodeGameV2(new Uint8Array(await readFile(`tests/fixtures/native/v2/program/replay/v2-native-n${count}.bin`)));const r=await verifyV2History(g);assert.equal(r.valid,true,r.error);assert.equal(r.checkedStages,6);assert.match(r.scope,/unrevealed/);
 const corrupted=structuredClone(g);corrupted.history[2].resources[0][0]++;assert.equal((await verifyV2History(corrupted)).valid,false);
 const wrong=structuredClone(g);wrong.rulesHash[0]^=1;assert.equal((await verifyV2History(wrong)).valid,false);
});
