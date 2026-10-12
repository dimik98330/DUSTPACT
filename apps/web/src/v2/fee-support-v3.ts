import {address,blockhash,getBase64Encoder,getBase64EncodedWireTransaction,type Address,type Transaction,type TransactionSigner} from '@solana/kit';
import {CommunityClient} from '../../../../packages/ui/src/community';
import {PROGRAM_V3,VAULT_PROGRAM,RULES_HASH,CONTENT_HASH} from '../../../../packages/solana-v3/src/constants';
import {hex} from '../../../../packages/solana-v3/src/codec';
import {V3_FEE_STATEMENT,V3_MAX_SPONSORED_FEE,type FeeSponsorV3,type FeeQuoteV3,type FeeRequestScopeV3,type FeeGrantV3} from '../../../../packages/solana-v3/src/fees';
const uint=(v:unknown)=>{if(typeof v!=='string'||!/^\d{1,20}$/.test(v))throw Error('Invalid fee service quantity');return BigInt(v);};
export class FeeConnectionV3 implements FeeSponsorV3 {
 readonly feePayer:Address;
 private context=new AbortController();
 private constructor(readonly genesis:string,private service:CommunityClient<string>,metadata:any,private validate:()=>Promise<void>){this.feePayer=address(metadata.feePayer);}
 static async connect(options:{base:string;origin:string;cluster:string;genesis:string;owner:TransactionSigner;validate:()=>Promise<void>;protocol?:{game:Address;vault:Address;rules:Uint8Array;content:Uint8Array}}){
  const service=new CommunityClient(options.base,options.origin,options.cluster,'v2',V3_FEE_STATEMENT);
  const metadata=await service.request<any>('/fees/version');
  const protocol=options.protocol??{game:PROGRAM_V3,vault:VAULT_PROGRAM,rules:RULES_HASH,content:CONTENT_HASH};
  if(metadata.version!==2||metadata.scope!=='v3-fees'||metadata.test!==true||metadata.genesis!==options.genesis||metadata.cluster!==options.cluster||metadata.game!==protocol.game||metadata.vault!==protocol.vault||metadata.rulesHash!==hex(protocol.rules)||metadata.contentHash!==hex(protocol.content)||metadata.statement!==V3_FEE_STATEMENT||uint(metadata.maxFeeLamports)!==V3_MAX_SPONSORED_FEE)throw Error('Fee service deployment or purpose mismatch');
  const connection=new FeeConnectionV3(options.genesis,service,metadata,options.validate);
  try{await options.validate();await service.authenticate(options.owner,{abortSignal:connection.context.signal,validateContext:options.validate});await connection.check();return connection;}catch(e){connection.dispose();throw e;}
 }
 private async check(){this.context.signal.throwIfAborted();await this.validate();this.context.signal.throwIfAborted();}
 async quote(scope:FeeRequestScopeV3):Promise<FeeQuoteV3>{
  await this.check();if(scope.genesis!==this.genesis)throw Error('Fee network changed');
  const q=await this.service.request<any>('/fees/quote',{match:scope.match,actor:scope.actor,program:scope.program,genesis:scope.genesis},'POST',{abortSignal:AbortSignal.any([this.context.signal,scope.abortSignal])});await this.check();
  if(q.genesis!==this.genesis||q.feePayer!==this.feePayer||q.actor!==scope.actor||q.match!==scope.match||q.owner!==this.service.session?.address||typeof q.id!=='string'||!/^[0-9a-f-]{36}$/.test(q.id))throw Error('Fee quote context mismatch');
  return Object.freeze({id:q.id,genesis:this.genesis,feePayer:this.feePayer,blockhash:blockhash(q.blockhash),lastValidBlockHeight:uint(q.lastValidBlockHeight)});
 }
 async grant(quote:FeeQuoteV3,unsigned:Transaction,scope:FeeRequestScopeV3):Promise<FeeGrantV3>{
  await this.check();if(quote.genesis!==this.genesis||quote.feePayer!==this.feePayer)throw Error('Fee quote changed');
  const g=await this.service.request<any>('/fees/grant',{quoteId:quote.id,wire:getBase64EncodedWireTransaction(unsigned)},'POST',{abortSignal:AbortSignal.any([this.context.signal,scope.abortSignal])});await this.check();
  if(g.genesis!==this.genesis||g.feePayer!==this.feePayer||typeof g.messageHash!=='string'||!/^[0-9a-f]{64}$/.test(g.messageHash)||typeof g.signature!=='string')throw Error('Fee grant context mismatch');
  const signature=Uint8Array.from(getBase64Encoder().encode(g.signature)),feeLamports=uint(g.feeLamports);if(signature.length!==64||feeLamports>V3_MAX_SPONSORED_FEE)throw Error('Fee grant limit');
  return{feePayer:this.feePayer,messageHash:g.messageHash,signature,feeLamports};
 }
 dispose(){this.context.abort();this.service.session=null;}
}
