/** Explicit test-only startup. No persistent signer, user wallet or live money. */
import{configV3}from'./v3-config';import{database,migrate}from'./db-v3';import{createFeeServiceV3}from'./v3-fees';import{requireThat,log}from'./security';import{lamports}from'@solana/kit';
requireThat(process.env.DUSTPACT_V3_FEE_SPONSOR==='1',503,'FEE_SPONSOR_DISABLED');const cfg={...configV3(),port:Number(process.env.DUSTPACT_V3_FEE_PORT??4198)};
requireThat(Number.isInteger(cfg.port)&&cfg.port>0&&cfg.port<=65535&&![4180,4182,4183,4194].includes(cfg.port),500,'FEE_PORT_CONFIG');
const db=database(cfg.databaseUrl);await migrate(db);const service=await createFeeServiceV3(db,cfg);
const signature=await service.authority.reader.rpc.requestAirdrop(service.signer.address,lamports(1_000_000_000n),{commitment:'confirmed'}).send();
for(let i=0;i<40;i++){const status=(await service.authority.reader.rpc.getSignatureStatuses([signature]).send()).value[0];if(status?.err)throw Error('FEE_TEST_FAUCET_REJECTED');if(status?.confirmationStatus==='confirmed'||status?.confirmationStatus==='finalized')break;if(i===39)throw Error('FEE_TEST_FAUCET_UNKNOWN');await new Promise(r=>setTimeout(r,250));}
service.server.listen(cfg.port,cfg.host,()=>log('v3_fee_service_listening',{port:cfg.port,cluster:cfg.cluster,test:true}));
for(const sig of['SIGINT','SIGTERM']as const)process.once(sig,()=>{void service.close().finally(()=>db.end());});
