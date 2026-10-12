import { PROGRAM_V3, VAULT_PROGRAM, SYSTEM, snapshotReleasePolicy, type TrustedReleasePolicy } from '../../../../packages/solana-v3/src/index';
export function publicRecoveryPolicies(raw:unknown):readonly TrustedReleasePolicy[]|undefined{
 if(typeof raw!=='string'||!raw.trim())return undefined;
 const values=JSON.parse(raw);if(!Array.isArray(values)||values.length!==2)throw Error('Both reviewed V3 deployment policies are required');
 return values.map(snapshotReleasePolicy);
}
/** Pinned existing local SBF artifacts. This is a valueless fixture network, not public deployment. */
export function localRecoveryPolicies(genesisHash:string):readonly TrustedReleasePolicy[]{
 return [{version:3,program:PROGRAM_V3,genesisHash,sbfSha256:'765932448513b695ec170c5961d8072f295cf58d5ead8be6d6cae31d01e58a91',executableBytes:376104,upgradeAuthority:{kind:'address',address:SYSTEM}},
 {version:3,program:VAULT_PROGRAM,genesisHash,sbfSha256:'2153724a7eb87522ed8a0855d8050218f8403aae8be70a787930bbebccb2e583',executableBytes:241664,upgradeAuthority:{kind:'address',address:SYSTEM}}].map(p=>snapshotReleasePolicy(p as TrustedReleasePolicy));
}
export const isLoopbackRpc=(url:string)=>['127.0.0.1','localhost','[::1]'].includes(new URL(url).hostname);
