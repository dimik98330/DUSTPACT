/** Node-only adapter. Do not export through the browser SDK entrypoint. */
import {readFileSync,writeFileSync,renameSync,mkdirSync,unlinkSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {DirectPendingStorage} from '../solana-client/src/pending';

const MAX_BYTES=2*1024*1024,MAX_SCOPES=64,PREFIX='dustpact:direct-pending:v1:';
/** Only the journal's public, validated metadata values. Never wallet state or wire transactions. */
export class FilePendingStorage implements DirectPendingStorage {
 readonly path:string;
 constructor(path:string){this.path=resolve(path);}
 private load():Record<string,string>{
  let text:string;try{text=readFileSync(this.path,'utf8');}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return {};throw Error('Pending metadata file cannot be read');}
  if(Buffer.byteLength(text)>MAX_BYTES)throw Error('Pending metadata file exceeds its bound');
  let input:unknown;try{input=JSON.parse(text);}catch{throw Error('Pending metadata file is malformed; preserve it for recovery');}
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length>MAX_SCOPES||Object.entries(input).some(([key,value])=>!key.startsWith(PREFIX)||key.length>200||typeof value!=='string'||Buffer.byteLength(value)>128*1024))throw Error('Pending metadata file has invalid public scopes');
  return input as Record<string,string>;
 }
 getItem(key:string){return this.load()[key]??null;}
 private save(data:Record<string,string>){
  if(Object.keys(data).length>MAX_SCOPES)throw Error('Pending metadata scope limit reached');const text=JSON.stringify(data);if(Buffer.byteLength(text)>MAX_BYTES)throw Error('Pending metadata size limit reached');
  mkdirSync(dirname(this.path),{recursive:true});const temp=`${this.path}.${randomUUID()}.tmp`;
  try{writeFileSync(temp,text,{encoding:'utf8',flag:'wx',mode:0o600});renameSync(temp,this.path);}finally{try{unlinkSync(temp);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}
 }
 setItem(key:string,value:string){if(!key.startsWith(PREFIX)||key.length>200||Buffer.byteLength(value)>128*1024)throw Error('Only bounded public journal metadata may be stored');const data=this.load();data[key]=value;this.save(data);}
 removeItem(key:string){const data=this.load();delete data[key];this.save(data);}
}
