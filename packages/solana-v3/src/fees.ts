import type{Address,Blockhash,Transaction,TransactionMessageBytesBase64}from'@solana/kit';
export const V3_FEE_STATEMENT='Sign in to optional DUSTPACT V3 fee sponsorship. This does not authorize game actions, transfer wallet funds or create a game session.';
export const V3_MAX_SPONSORED_FEE=20_000n;
export type FeeRequestScopeV3={match:Address;actor:Address;program:Address;genesis:string;abortSignal:AbortSignal};
export type FeeQuoteV3={id:string;feePayer:Address;genesis:string;blockhash:Blockhash;lastValidBlockHeight:bigint};
export type FeeGrantV3={feePayer:Address;messageHash:string;signature:Uint8Array;feeLamports:bigint};
/** Fee-only signature provider; it never receives the actor signature or submits a transaction. */
export interface FeeSponsorV3{
 readonly feePayer:Address;readonly genesis:string;
 quote(scope:FeeRequestScopeV3):Promise<FeeQuoteV3>;
 grant(quote:FeeQuoteV3,unsigned:Transaction,scope:FeeRequestScopeV3):Promise<FeeGrantV3>;
}
