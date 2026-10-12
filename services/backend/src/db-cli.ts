import { configV2 } from './v2-config.ts';
import { database, migrate } from './db.ts';
import { reconcileV2 } from './v2-indexer.ts';
import { V2Chain } from './v2-chain.ts';
const cfg=configV2(),db=database(cfg.databaseUrl);
try{await migrate(db);if(process.argv[2]==='rebuild')console.log(JSON.stringify(await reconcileV2(db,cfg.cluster,new V2Chain(cfg.rpcUrl,cfg.expectedGenesis),true),(_,v)=>typeof v==='bigint'?v.toString():v));else console.log('V2 migrations applied');}finally{await db.end();}