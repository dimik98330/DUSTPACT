import {getAddressDecoder,getAddressEncoder,type Address} from '@solana/kit';
export class Writer {
 private data:number[]=[];
 raw(b:ArrayLike<number>){this.data.push(...Array.from(b));return this;}
 u8(v:number){if(!Number.isInteger(v)||v<0||v>255)throw Error('Invalid u8');this.data.push(v);return this;}
 bool(v:boolean){return this.u8(v?1:0);}
 u16(v:number){if(!Number.isInteger(v)||v<0||v>65535)throw Error('Invalid u16');return this.u8(v&255).u8(v>>>8);}
 u32(v:number){if(!Number.isSafeInteger(v)||v<0||v>0xffffffff)throw Error('Invalid u32');for(let i=0;i<4;i++)this.u8((v>>>i*8)&255);return this;}
 u64(v:bigint){if(v<0n||v>0xffffffffffffffffn)throw Error('Invalid u64');for(let i=0;i<8;i++)this.u8(Number((v>>BigInt(i*8))&255n));return this;}
 i64(v:bigint){if(v<-(1n<<63n)||v>=(1n<<63n))throw Error('Invalid i64');return this.u64(BigInt.asUintN(64,v));}
 address(v:Address){return this.raw(getAddressEncoder().encode(v));}
 bytes(){return Uint8Array.from(this.data);}
}
export class Reader {
 position=0;constructor(readonly bytes:Uint8Array){}
 raw(n:number){if(!Number.isSafeInteger(n)||n<0||this.position+n>this.bytes.length)throw Error('Truncated V2 account');const v=this.bytes.slice(this.position,this.position+n);this.position+=n;return v;}
 u8(){return this.raw(1)[0];} bool(){const v=this.u8();if(v>1)throw Error('Invalid Borsh bool');return v===1;}
 u16(){const b=this.raw(2);return b[0]+256*b[1];}
 u32(){const b=this.raw(4);return new DataView(b.buffer,b.byteOffset,b.byteLength).getUint32(0,true);}
 u64(){const b=this.raw(8);return new DataView(b.buffer,b.byteOffset,b.byteLength).getBigUint64(0,true);}
 i64(){return BigInt.asIntN(64,this.u64());}
 address(){return getAddressDecoder().decode(this.raw(32));}
 array<T>(n:number,f:()=>T){return Array.from({length:n},f);}
 finishPadding(){if(this.bytes.slice(this.position).some(v=>v!==0))throw Error('Unexpected nonzero account trailing data');}
}
export async function sha256(bytes:Uint8Array){return new Uint8Array(await crypto.subtle.digest('SHA-256',Uint8Array.from(bytes)));}
export async function discriminator(kind:'account'|'global',name:string){return (await sha256(new TextEncoder().encode(`${kind}:${name}`))).slice(0,8);}
export const equalBytes=(a:ArrayLike<number>,b:ArrayLike<number>)=>a.length===b.length&&Array.from(a).every((v,i)=>v===b[i]);
export const hex=(b:ArrayLike<number>)=>Array.from(b,v=>v.toString(16).padStart(2,'0')).join('');
