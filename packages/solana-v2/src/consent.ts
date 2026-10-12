import type{Address}from '@solana/kit';
import{PROGRAM_V2}from './constants';
import{Writer,sha256}from './codec';
import type{GameV2,Offer,ConfigConsent,OfferConsent,PreparedMove,Move,Terms}from './types';
export function configBytes(match:Address,g:GameV2){const w=new Writer().raw(new TextEncoder().encode('DUSTPACT_CONFIG_V2')).address(PROGRAM_V2).address(match).raw(g.rulesHash).raw(g.contentHash).u32(g.roster).u8(g.count).u8(g.npcMask).u8(g.eligibleMask).address(g.mission).u32(g.missionRoster);for(const s of g.seats.slice(0,g.count))w.address(s.owner);return w.bytes();}
export async function reviewConfig(match:Address,g:GameV2):Promise<ConfigConsent>{const bytes=configBytes(match,g),roster=g.roster;return Object.freeze({match,roster,hash:await sha256(bytes)});}
export async function reviewOffer(match:Address,g:GameV2,maker:number):Promise<OfferConsent>{
 const p=structuredClone(g.offers[maker]);if(!p||p.status!==1||p.stage!==g.stage)throw Error('Offer is no longer open');
 const cfg=configBytes(match,g),w=new Writer().raw(new TextEncoder().encode('DUSTPACT_TERMS_V2')).address(PROGRAM_V2).address(match).raw(g.rulesHash).raw(g.contentHash);
 // Snapshot every consent field before the hash await.
 const rest=new Writer().raw([p.stage,p.maker,p.taker,p.provider,p.kind,p.action,p.jobSlot]).u16(p.delivery).u32(p.nonce);
 for(const index of[p.maker,p.taker,p.provider]){if(index>=g.count)throw Error('Invalid offer owner');rest.address(g.seats[index].owner);}
 for(const b of[...p.gives,...p.reserve])for(const v of b)rest.u16(v);
 const hash=await sha256(w.raw(await sha256(cfg)).raw(rest.bytes()).bytes());
 return Object.freeze({match,stage:p.stage,maker:p.maker,taker:p.taker,provider:p.provider,nonce:p.nonce,jobSlot:p.jobSlot,hash,offer:p});
}
export type OfferIntent=Terms&{stage:number;maker:number;configHash:Uint8Array};
export async function reviewOfferIntent(match:Address,g:GameV2,maker:number,terms:Terms):Promise<OfferIntent>{const snapshot=structuredClone(terms),stage=g.stage;if(maker<0||maker>=g.count||snapshot.offerNonce!==g.seats[maker].offerNonce)throw Error('Offer nonce changed');return Object.freeze({...snapshot,stage,maker,configHash:(await reviewConfig(match,g)).hash});}
export async function prepareMove(match:Address,g:GameV2,seat:number,move:Move,salt?:Uint8Array):Promise<PreparedMove>{
 if(seat<0||seat>=g.count||!Number.isInteger(move.action)||move.action<0||move.action>4||!Number.isInteger(move.route)||move.route<0||move.route>1||!Number.isInteger(move.delivery)||move.delivery<0||move.delivery>5||g.stage!==5&&move.delivery!==0)throw Error('Invalid reviewed move');
 const s=salt?Uint8Array.from(salt):crypto.getRandomValues(new Uint8Array(32));if(s.length!==32)throw Error('Salt must be 32 bytes');
 const cfg=configBytes(match,g),owner=g.seats[seat].owner,stage=g.stage,action=move.action,route=move.route,delivery=move.delivery;
 const w=new Writer().raw(new TextEncoder().encode('DUSTPACT_MOVE_V2')).address(PROGRAM_V2).address(match).raw(g.rulesHash).raw(g.contentHash);
 const rest=new Writer().u8(stage).u8(seat).address(owner).u8(action).u8(route).u16(delivery).raw(s);
 const commitment=await sha256(w.raw(await sha256(cfg)).raw(rest.bytes()).bytes());
 return Object.freeze({match,stage,owner,seat,action,route,delivery,salt:s,commitment});
}
