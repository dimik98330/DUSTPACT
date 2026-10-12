#!/usr/bin/env node
/** Independent client. Signing providers must keep keys in an external wallet/device. */
import{readFile}from 'node:fs/promises';
import{pathToFileURL}from 'node:url';
import{resolve}from 'node:path';
import{address,type TransactionSigner}from '@solana/kit';
import{V2Client,LOCAL_RPC_V2,missionAddress}from './src/index';
import{FilePendingStorage}from './node-pending';
const argv=process.argv.slice(2),command=argv.shift();
function option(name:string){const i=argv.indexOf(name);if(i<0)return undefined;const value=argv[i+1];if(!value||value.startsWith('--'))throw Error(`Missing ${name}`);argv.splice(i,2);return value;}
const rpc=option('--rpc')??LOCAL_RPC_V2,provider=option('--wallet-provider'),pendingPath=option('--pending-metadata')??process.env.DUSTPACT_V2_PENDING_METADATA,commitmentArg=option('--commitment')??'confirmed',matchArg=argv.shift();
if(commitmentArg!=='confirmed'&&commitmentArg!=='finalized')throw Error('Commitment must be confirmed or finalized');
const commitment:'confirmed'|'finalized'=commitmentArg;
if(!command||!matchArg||!['read','advance','resolve','claim','refund','reconcile'].includes(command))throw Error('Usage: tsx packages/solana-v2/cli.ts read|advance|resolve|claim|refund|reconcile MATCH [SLOT] [--rpc URL] [--commitment confirmed|finalized] [--wallet-provider trusted-local-module.mjs --pending-metadata public-pending.json]');
if(argv.some(v=>v.startsWith('--')))throw Error('Unknown flag; private keys/keypair files are never accepted');
const match=address(matchArg);
if(command!=='read'&&!pendingPath)throw Error('Signing/reconciliation requires --pending-metadata FILE to preserve public signature metadata across restarts');
let signer:TransactionSigner;
if(provider){
 // User explicitly selects a trusted wallet adapter module; no arbitrary module from RPC data.
 const p=resolve(provider);if(!/\.(mjs|js)$/.test(p))throw Error('Wallet provider must be a trusted local JavaScript adapter');
 const module=await import(pathToFileURL(p).href);if(typeof module.getExternalWalletSigner!=='function')throw Error('Provider must export getExternalWalletSigner()');
 signer=await module.getExternalWalletSigner();if(!signer?.address||!('modifyAndSignTransactions'in signer||'signTransactions'in signer))throw Error('Provider must return an external wallet TransactionSigner');
}else{
 if(!['read'].includes(command))throw Error('Signing action requires a trusted external wallet provider; no generated signer or key file fallback');
 signer={address:address('11111111111111111111111111111111'),signTransactions:async()=>{throw Error('Read-only CLI cannot sign');}};
}
// Public policies are reviewed local build configuration, never a remote URL or auto-fetched manifest.
const policyPath=process.env.DUSTPACT_V2_REVIEWED_POLICY;
const releasePolicies=policyPath?JSON.parse(await readFile(resolve(policyPath),'utf8')):undefined;
const client=new V2Client(signer,rpc,{releasePolicies,pendingStorage:pendingPath?new FilePendingStorage(pendingPath):undefined}),g=await client.read(match,commitment);
const json=(v:unknown)=>JSON.stringify(v,(_,x)=>typeof x==='bigint'?x.toString():x instanceof Uint8Array?Array.from(x):x,2);
async function publicState(){const mission=await client.readVault(match,commitment),owners=mission?Array.from(new Set([mission.sponsor,(await missionAddress(match))[0],...mission.slots.filter(s=>s.status===1||s.status===2).map(s=>s.owner)])):[];return{schema:'dustpact-v2',commitment,game:await client.read(match,commitment),mission,balances:await Promise.all(owners.map(owner=>client.readTokenBalance(owner,commitment)))};}
if(command==='read')process.stdout.write(json(await publicState())+'\n');
else if(command==='reconcile')process.stdout.write(json(await client.reconcilePending(match))+'\n');
else{
 process.stderr.write(`Review: ${command}; match ${match}; RPC ${new URL(rpc).origin}; fee payer ${signer.address}; TEST-USDC only; external wallet confirms exact transaction.\n`);
 const slot=Number(argv[0]);const signature=command==='advance'?await client.advance(match,{stage:g.stage,phase:g.phase}):command==='resolve'?await client.resolve(match,g.stage):command==='claim'?await client.claim(match,slot):await client.refund(match,slot);
 process.stdout.write(json({signature,...await publicState(),costs:signature?await client.readTransactionCosts(signature,commitment):null})+'\n');
}
