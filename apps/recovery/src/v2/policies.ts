import { PROGRAM_V2, VAULT_PROGRAM, SYSTEM, snapshotReleasePolicy, type TrustedReleasePolicy } from '../../../../packages/solana-v2/src/index';
export function publicRecoveryPolicies(raw:unknown):readonly TrustedReleasePolicy[]|undefined{
 if(typeof raw!=='string'||!raw.trim())return undefined;
 const values=JSON.parse(raw);if(!Array.isArray(values)||values.length!==2)throw Error('Both reviewed V2 deployment policies are required');
 return values.map(snapshotReleasePolicy);
}
/** Pinned existing local SBF artifacts. This is a valueless fixture network, not public deployment. */
export function localRecoveryPolicies(genesisHash:string):readonly TrustedReleasePolicy[]{
 return [{version:2,program:PROGRAM_V2,genesisHash,sbfSha256:'e2ccb5b037c0876ecd3c8dcd217da80620d47d06897fcd31348052aab95126a1',executableBytes:330560,upgradeAuthority:{kind:'address',address:SYSTEM}},
 {version:2,program:VAULT_PROGRAM,genesisHash,sbfSha256:'b7cc5fb4057de7d33d3167c758d21fb81c112a2e8152c21ff7c18ecc535579a5',executableBytes:240272,upgradeAuthority:{kind:'address',address:SYSTEM}}].map(p=>snapshotReleasePolicy(p as TrustedReleasePolicy));
}
export const isLoopbackRpc=(url:string)=>['127.0.0.1','localhost','[::1]'].includes(new URL(url).hostname);
