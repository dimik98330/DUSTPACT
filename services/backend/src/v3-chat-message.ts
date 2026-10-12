import type { Pool } from 'pg';
import { transaction } from './db.ts';
import { requireThat } from './security.ts';
export const CHAT_UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function chatClientId(value:unknown):string|undefined {
 if(value===undefined)return undefined;
 requireThat(typeof value==='string'&&CHAT_UUID.test(value),400,'V3_INVALID_CHAT_ID');
 return value.toLowerCase();
}
const fields='id,address,CASE WHEN hidden_at IS NULL THEN body ELSE NULL END AS text,hidden_at IS NOT NULL AS hidden,client_id AS "clientId",created_at AS "createdAt"';
/** A repeated ID returns the same persisted message, never a second insert or changed text. */
export async function storeChatMessageV3(db:Pool,room:string,address:string,body:string,clientId?:string){
 return transaction(db,async c=>{
  await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[room]);
  if(clientId){
   const old=await c.query(`SELECT ${fields},body FROM v3_chat_messages WHERE room_id=$1 AND address=$2 AND client_id=$3`,[room,address,clientId]);
   if(old.rows[0]){requireThat(old.rows[0].body===body,409,'V3_CHAT_ID_REUSED');const {body:_,...message}=old.rows[0];return {message,created:false};}
  }
  const count=await c.query('SELECT count(*)::int AS count FROM v3_chat_messages WHERE room_id=$1',[room]);
  requireThat(count.rows[0].count<20_000,429,'CHAT_STORAGE_LIMIT');
  const saved=await c.query(`INSERT INTO v3_chat_messages(room_id,address,body,client_id) VALUES($1,$2,$3,$4) RETURNING ${fields}`,[room,address,body,clientId??null]);
  return {message:saved.rows[0],created:true};
 });
}
