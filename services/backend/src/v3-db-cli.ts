import { configV3 } from './v3-config.ts';
import { database, migrate } from './db-v3.ts';
import { reconcileV3 } from './v3-indexer.ts';
import { V3Chain } from './v3-chain.ts';
const cfg=configV3(),db=database(cfg.databaseUrl);
try{await migrate(db);if(process.argv[2]==='rebuild')console.log(JSON.stringify(await reconcileV3(db,cfg.cluster,new V3Chain(cfg.rpcUrl,cfg.expectedGenesis),true),(_,v)=>typeof v==='bigint'?v.toString():v));else console.log('V3 migrations applied');}finally{await db.end();}