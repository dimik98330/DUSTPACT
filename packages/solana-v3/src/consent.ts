import type{Address}from '@solana/kit';
import{PROGRAM_V3}from './constants';
import{Writer,sha256}from './codec';
import type{GameV3,Offer,ConfigConsent,OfferConsent,PreparedMove,Move,Terms}from './types';
export function configBytes(match:Address,g:GameV3){const w=new Writer().raw(new TextEncoder().encode('DUSTPACT_CONFIG_V3')).address(PROGRAM_V3).address(match).raw(g.rulesHash).raw(g.contentHash).u32(g.roster).u8(g.count).u8(g.npcMask).u8(g.eligibleMask).address(g.mission).u32(g.missionRoster);for(const s of g.seats.slice(0,g.count))w.address(s.owner);return w.bytes();}
export async function reviewConfig(match:Address,g:GameV3):Promise<ConfigConsent>{const bytes=configBytes(match,g),roster=g.roster;return Object.freeze({match,roster,hash:await sha256(bytes)});}
export async function reviewOffer(match:Address,g:GameV3,maker:number):Promise<OfferConsent>{
 const p=structuredClone(g.offers[maker]);if(!p||p.status!==1||p.stage!==g.stage)throw Error('Offer is no longer open');
 const cfg=configBytes(match,g),w=new Writer().raw(new TextEncoder().encode('DUSTPACT_TERMS_V3')).address(PROGRAM_V3).address(match).raw(g.rulesHash).raw(g.contentHash);
 // Snapshot every consent field before the hash await.
 const rest=new Writer().raw([p.stage,p.maker,p.taker,p.provider,p.kind,p.action,p.jobSlot]).u16(p.delivery).u32(p.nonce);
 for(const index of[p.maker,p.taker,p.provider]){if(index>=g.count)throw Error('Invalid offer owner');rest.address(g.seats[index].owner);}
 for(const b of[...p.gives,...p.reserve])for(const v of b)rest.u16(v);
 const hash=await sha256(w.raw(await sha256(cfg)).raw(rest.bytes()).bytes());
 return Object.freeze({match,stage:p.stage,maker:p.maker,taker:p.taker,provider:p.provider,nonce:p.nonce,jobSlot:p.jobSlot,hash,offer:p});
}
export type OfferIntent=Terms&{stage:number;maker:number;configHash:Uint8Array};
export async function reviewOfferIntent(match:Address,g:GameV3,maker:number,terms:Terms):Promise<OfferIntent>{const snapshot=structuredClone(terms),stage=g.stage;if(maker<0||maker>=g.count||snapshot.offerNonce!==g.seats[maker].offerNonce)throw Error('Offer nonce changed');return Object.freeze({...snapshot,stage,maker,configHash:(await reviewConfig(match,g)).hash});}
export function workContextBytes(g:GameV3,seat:number){const own=g.deals.slice(0,g.dealCount).filter(d=>d.maker===seat||d.taker===seat),w=new Writer().raw(new TextEncoder().encode('DUSTPACT_WORK_V3')).u8(g.stage).u8(seat).u8(own.length);for(const d of own){w.raw([d.stage,d.kind,d.maker,d.taker,d.provider,d.action,d.jobSlot]).u16(d.delivery).u32(d.nonce);for(const b of [...d.gives,...d.reserve])for(const v of b)w.u16(v);}return w.bytes();}
export function pledgedQuantity(g:GameV3,seat:number){return g.deals.slice(0,g.dealCount).find(d=>d.kind===3&&d.provider===seat)?.delivery??0;}
export function validateMove(g:GameV3,seat:number,m:Move){
 if(!Number.isInteger(seat)||seat<0||seat>=g.count||!Number.isInteger(m.action)||!Number.isInteger(m.route)||m.route<0||m.route>1||!Number.isInteger(m.delivery)||m.delivery<0||m.delivery>5)throw Error('Invalid move');
 const s=g.seats[seat];if(s.bound!==255&&s.bound!==m.action)throw Error('Move conflicts with accepted work');
 if(g.stage===5){const q=pledgedQuantity(g,seat);if(![0,1,5,6].includes(m.action)||(m.action===5?(m.delivery+q===0||m.delivery+q>5):m.delivery!==0||q!==0))throw Error('Invalid city action or extra delivery');if(!(g.revealed&(1<<seat))&&m.delivery>s.resources[2]-s.reserved[2])throw Error('Delivery exceeds free cargo after reservations');}
 else if(m.action<0||m.action>4||m.delivery!==0)throw Error('Invalid encounter action');
}
export async function prepareMove(match:Address,g:GameV3,seat:number,move:Move,salt?:Uint8Array):Promise<PreparedMove>{
 const snapshot=structuredClone(g),choice={...move},copy=salt?Uint8Array.from(salt):undefined;
 return rehashPrivateBackup(match,snapshot,seat,choice,copy,await sha256(workContextBytes(snapshot,seat)));
}
/** Hash validation only; never signing authority. Commit/reveal recheck current work context. */
export async function rehashPrivateBackup(match:Address,g:GameV3,seat:number,move:Move,salt:Uint8Array|undefined,workContext:Uint8Array):Promise<PreparedMove>{
 if(seat<0||seat>=g.count||!Number.isInteger(move.action)||move.action<0||move.action>6||!Number.isInteger(move.route)||move.route<0||move.route>1||!Number.isInteger(move.delivery)||move.delivery<0||move.delivery>5||g.stage!==5&&move.delivery!==0||workContext.length!==32)throw Error('Invalid reviewed move');
 const s=salt?Uint8Array.from(salt):crypto.getRandomValues(new Uint8Array(32));if(s.length!==32)throw Error('Salt must be 32 bytes');
 const work=Uint8Array.from(workContext);
 const cfg=configBytes(match,g),owner=g.seats[seat].owner,stage=g.stage,action=move.action,route=move.route,delivery=move.delivery;
 const w=new Writer().raw(new TextEncoder().encode('DUSTPACT_MOVE_V3')).address(PROGRAM_V3).address(match).raw(g.rulesHash).raw(g.contentHash);
 const rest=new Writer().u8(stage).u8(seat).address(owner).u8(action).u8(route).u16(delivery).raw(s);
 const commitment=await sha256(w.raw(await sha256(cfg)).raw(work).raw(rest.bytes()).bytes());
 return Object.freeze({match,stage,owner,seat,action,route,delivery,salt:s,commitment,workContext:work});
}
