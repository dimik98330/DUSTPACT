import type{Address,Blockhash,Transaction,TransactionMessageBytesBase64}from'@solana/kit';
export const V2_FEE_STATEMENT='Sign in to optional DUSTPACT V2 fee sponsorship. This does not authorize game actions, transfer wallet funds or create a game session.';
export const V2_MAX_SPONSORED_FEE=20_000n;
export type FeeRequestScopeV2={match:Address;actor:Address;program:Address;genesis:string;abortSignal:AbortSignal};
export type FeeQuoteV2={id:string;feePayer:Address;genesis:string;blockhash:Blockhash;lastValidBlockHeight:bigint};
export type FeeGrantV2={feePayer:Address;messageHash:string;signature:Uint8Array;feeLamports:bigint};
/** Fee-only signature provider; it never receives the actor signature or submits a transaction. */
export interface FeeSponsorV2{
 readonly feePayer:Address;readonly genesis:string;
 quote(scope:FeeRequestScopeV2):Promise<FeeQuoteV2>;
 grant(quote:FeeQuoteV2,unsigned:Transaction,scope:FeeRequestScopeV2):Promise<FeeGrantV2>;
}
