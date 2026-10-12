import {Reader,discriminator,equalBytes}from './codec';
import type {Bundle,Seat,Offer,Summary,GameV2,Mission}from './types';
import {SYSTEM}from './constants';
const bundle=(r:Reader):Bundle=>[r.u16(),r.u16(),r.u16()];
const seat=(r:Reader):Seat=>({owner:r.address(),session:r.address(),expires:r.i64(),epoch:r.u32(),quota:r.u16(),actionNonce:r.u64(),offerNonce:r.u32(),ready:r.bool(),planningReady:r.bool(),resources:bundle(r),reserved:bundle(r),support:r.u16(),delivered:r.u16(),forfeited:r.bool(),seal:r.bool(),bound:r.u8(),offerCount:r.u8()});
const offer=(r:Reader):Offer=>({status:r.u8(),kind:r.u8(),maker:r.u8(),taker:r.u8(),provider:r.u8(),action:r.u8(),delivery:r.u16(),nonce:r.u32(),stage:r.u8(),gives:[bundle(r),bundle(r)],reserve:[bundle(r),bundle(r)],jobSlot:r.u8()});
const summary=(r:Reader):Summary=>({complete:r.bool(),hull:r.u8(),route:r.u8(),threat:r.u8(),guard:r.u8(),objective:r.bool(),flags:r.u8(),actions:r.array(6,()=>r.u8()),routes:r.array(6,()=>r.u8()),deliveries:r.array(6,()=>r.u16()),missing:r.u8(),rejected:r.array(6,()=>r.u8()),inputs:r.array(6,()=>bundle(r)),outputs:r.array(6,()=>bundle(r)),resources:r.array(6,()=>bundle(r)),support:r.array(6,()=>r.u16()),delivered:r.array(6,()=>r.u16()),forfeited:r.u8(),deals:r.array(3,()=>offer(r)),dealCount:r.u8(),jobs:r.array(3,()=>({slot:r.u8(),provider:r.u8(),nonce:r.u32(),executed:r.bool(),owner:r.address()})),revision:r.u64()});
export async function decodeGameV2(bytes:Uint8Array):Promise<GameV2>{
 if(bytes.length!==8192)throw Error('GameV2 allocation mismatch');const r=new Reader(bytes);if(!equalBytes(r.raw(8),await discriminator('account','GameV2')))throw Error('Wrong GameV2 discriminator');
 const g:GameV2={creator:r.address(),nonce:r.raw(16),bump:r.u8(),rulesHash:r.raw(32),contentHash:r.raw(32),count:r.u8(),phase:r.u8(),stage:r.u8(),hull:r.u8(),deadline:r.i64(),revision:r.u64(),roster:r.u32(),npcMask:r.u8(),eligibleMask:r.u8(),mission:r.address(),missionRoster:r.u32(),flags:r.u8(),seats:r.array(6,()=>seat(r)),offers:r.array(6,()=>offer(r)),deals:r.array(3,()=>offer(r)),dealCount:r.u8(),commitments:r.array(6,()=>r.raw(32)),committed:r.u8(),revealed:r.u8(),actions:r.array(6,()=>r.u8()),routes:r.array(6,()=>r.u8()),deliveries:r.array(6,()=>r.u16()),history:(()=>{if(r.u32()!==6)throw Error("Invalid bounded history length");return r.array(6,()=>summary(r));})(),scores:r.array(6,()=>r.u32()),arrived:r.bool()};r.finishPadding();
 if(g.count<1||g.count>6||g.phase>6||g.stage>5||g.hull>12||g.dealCount>Math.floor(g.count/2))throw Error('Invalid GameV2 state');
 const mask=(1<<g.count)-1;if((g.committed|g.revealed|g.npcMask|g.eligibleMask)&~mask||g.npcMask&g.eligibleMask)throw Error('Invalid seat mask');if(g.revealed&~g.committed)throw Error('Reveal without commitment');
 if(g.phase>=1&&g.phase<=5&&g.count<4||g.flags>7||g.arrived&&(g.phase!==5||g.stage!==5||g.hull===0))throw Error('Invalid campaign state');
 for(const s of g.seats.slice(0,g.count)){if(s.quota>128||s.resources.some((v,i)=>v>200||s.reserved[i]>v)||s.bound!==255&&s.bound>4||s.offerCount>3||s.support>64||s.delivered>30)throw Error('Invalid V2 seat');}
 if(g.actions.some(v=>v>4)||g.routes.some(v=>v>1)||g.deliveries.some(v=>v>5||g.stage!==5&&v!==0))throw Error('Invalid current V2 moves');
 const validateOffer=(p:Offer,stage?:number)=>{if(p.status<1||p.status>4||p.kind>2||p.action>4||p.stage>5||stage!==undefined&&p.stage!==stage||p.maker>=g.count||p.taker>=g.count||p.provider>=g.count||p.kind!==0&&p.provider!==p.maker&&p.provider!==p.taker||p.maker===p.taker||p.jobSlot!==255&&p.jobSlot>1||p.delivery>3||p.gives.some(b=>b.some(v=>v>5))||p.reserve.some(b=>b.some(v=>v>200)))throw Error('Invalid V2 offer');};
 if(g.offers.some(p=>p.status>4))throw Error('Invalid V2 offer status');
 for(const p of g.offers.filter(p=>p.status!==0))validateOffer(p,g.stage);
 for(const p of g.deals.slice(0,g.dealCount)){validateOffer(p,g.stage);if(p.status!==2)throw Error('Unaccepted V2 deal');}
 let ended=false,lastRevision=0n;
 for(let stage=0;stage<6;stage++){const h=g.history[stage];if(!h.complete){ended=true;continue;}
  if(ended||stage>g.stage||h.hull>12||h.route>1||h.flags>7||h.dealCount>Math.floor(g.count/2)||(h.missing|h.forfeited)&~mask||h.revision<=lastRevision||h.revision>g.revision||h.actions.some(v=>v>4)||h.routes.some(v=>v>1)||h.deliveries.some(v=>v>5||stage!==5&&v!==0)||h.support.some(v=>v>64)||h.delivered.some(v=>v>30)||h.rejected.some(v=>v>4)||[...h.resources,...h.inputs,...h.outputs].some(b=>b.some(v=>v>200)))throw Error('Invalid complete V2 receipt');
  for(const p of h.deals.slice(0,h.dealCount)){validateOffer(p,stage);if(p.status!==2)throw Error('Invalid historical pact');}
  for(let i=0;i<3;i++){const job=h.jobs[i],deal=h.deals[i];
   const paid=stage===1&&i<h.dealCount&&deal.jobSlot!==255;
   if(!paid){if(job.owner!==SYSTEM||job.executed||job.nonce!==0||job.provider!==0||job.slot!==0)throw Error('Unexpected work receipt');continue;}
   if(job.owner===SYSTEM||job.slot>1||job.provider>=g.count||job.owner!==g.seats[job.provider].owner||deal.jobSlot!==job.slot||deal.provider!==job.provider||deal.nonce!==job.nonce||deal.kind!==1||deal.action!==3)throw Error('Invalid canonical work receipt');
  }
  lastRevision=h.revision;
 }
 return g;
}
export async function decodeMission(bytes:Uint8Array):Promise<Mission>{
 const r=new Reader(bytes);if(!equalBytes(r.raw(8),await discriminator('account','Mission')))throw Error('Wrong Mission discriminator');
 const m:Mission={game:r.address(),sponsor:r.address(),bump:r.u8(),roster:r.u32(),rulesHash:r.raw(32),contentHash:r.raw(32),eligibleMask:r.u8(),fundedAt:r.i64(),slots:r.array(2,()=>({status:r.u8(),provider:r.u8(),nonce:r.u32(),owner:r.address()}))};
 if(r.position!==bytes.length||m.slots.some(s=>s.status>3||s.status!==0&&s.provider>5||(s.status===1||s.status===2)&&(s.owner===SYSTEM||!(m.eligibleMask&(1<<s.provider))))||m.eligibleMask>63)throw Error('Invalid mission bounds');return m;
}
