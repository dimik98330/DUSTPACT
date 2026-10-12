import test from 'node:test';
import assert from 'node:assert/strict';
import { Reader } from '../packages/solana-v2/src/codec';
test('Borsh integers read the exact byte view, including Node Buffer slices with a nonzero offset',()=>{
 const backing=Buffer.from([0xaa,0xbb,0x78,0x56,0x34,0x12,8,7,6,5,4,3,2,1,0xcc]);
 const bufferView=backing.subarray(2,14),uintView=new Uint8Array(backing.buffer,backing.byteOffset+2,12);
 for(const bytes of [bufferView,uintView,Uint8Array.from(bufferView)]){const r=new Reader(bytes);assert.equal(r.u32(),0x12345678);assert.equal(r.u64(),0x0102030405060708n);assert.equal(r.position,12);assert.throws(()=>r.u8(),/Truncated/);}
});
