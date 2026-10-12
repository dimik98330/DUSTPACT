import type {Pool} from 'pg';
import {migrate as migrateBase,transaction} from './db';
export {database,transaction} from './db';
/** Separate directory/database: never migrate protocol2 tables in place. */
export const migrate=(db:Pool)=>migrateBase(db,new URL('../migrations-v3/',import.meta.url));
export async function cleanup(db:Pool){await transaction(db,async c=>{
 await c.query('DELETE FROM auth_nonces WHERE expires_at<now()');
 await c.query('DELETE FROM auth_sessions WHERE expires_at<now()');
 await c.query('DELETE FROM v3_ws_tickets WHERE expires_at<now()');
 await c.query('DELETE FROM v3_chat_mutes WHERE expires_at<now()');
});}
