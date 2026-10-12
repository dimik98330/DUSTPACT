import {Reader,discriminator,equalBytes}from './codec';
import type {Bundle,Seat,Offer,Summary,GameV3,Mission}from './types';
import {SYSTEM,GAME_BYTES}from './constants';
const bundle=(r:Reader):Bundle=>[r.u16(),r.u16(),r.u16()];
const seat=(r:Reader):Seat=>({owner:r.address(),session:r.address(),expires:r.i64(),epoch:r.u32(),quota:r.u16(),actionNonce:r.u64(),offerNonce:r.u32(),ready:r.bool(),planningReady:r.bool(),resources:bundle(r),reserved:bundle(r),support:r.u16(),delivered:r.u16(),forfeited:r.bool(),seal:r.bool(),bound:r.u8(),offerCount:r.u8()});
const offer=(r:Reader):Offer=>({status:r.u8(),kind:r.u8(),maker:r.u8(),taker:r.u8(),provider:r.u8(),action:r.u8(),delivery:r.u16(),nonce:r.u32(),stage:r.u8(),gives:[bundle(r),bundle(r)],reserve:[bundle(r),bundle(r)],jobSlot:r.u8()});
const summary=(r:Reader):Summary=>({complete:r.bool(),hull:r.u8(),route:r.u8(),threat:r.u8(),guard:r.u8(),objective:r.bool(),flags:r.u8(),actions:r.array(6,()=>r.u8()),routes:r.array(6,()=>r.u8()),deliveries:r.array(6,()=>r.u16()),missing:r.u8(),rejected:r.array(6,()=>r.u8()),inputs:r.array(6,()=>bundle(r)),outputs:r.array(6,()=>bundle(r)),resources:r.array(6,()=>bundle(r)),support:r.array(6,()=>r.u16()),delivered:r.array(6,()=>r.u16()),forfeited:r.u8(),deals:r.array(3,()=>offer(r)),dealCount:r.u8(),jobs:r.array(3,()=>({slot:r.u8(),provider:r.u8(),nonce:r.u32(),executed:r.bool(),owner:r.address()})),revision:r.u64(),escortGoal:r.u8(),escortProgress:r.u8(),pledged:r.array(6,()=>r.u16()),voluntary:r.array(6,()=>r.u16()),pricesPaid:r.array(6,()=>bundle(r)),pricesReceived:r.array(6,()=>bundle(r))});
export async function decodeGameV3(bytes:Uint8Array):Promise<GameV3>{
 if(bytes.length!==GAME_BYTES)throw Error('GameV3 allocation mismatch');const r=new Reader(bytes);if(!equalBytes(r.raw(8),await discriminator('account','GameV3')))throw Error('Wrong GameV3 discriminator');
 const g:GameV3={creator:r.address(),nonce:r.raw(16),bump:r.u8(),rulesHash:r.raw(32),contentHash:r.raw(32),count:r.u8(),phase:r.u8(),stage:r.u8(),hull:r.u8(),deadline:r.i64(),revision:r.u64(),roster:r.u32(),npcMask:r.u8(),eligibleMask:r.u8(),mission:r.address(),missionRoster:r.u32(),flags:r.u8(),seats:r.array(6,()=>seat(r)),offers:r.array(6,()=>offer(r)),deals:r.array(3,()=>offer(r)),dealCount:r.u8(),commitments:r.array(6,()=>r.raw(32)),committed:r.u8(),revealed:r.u8(),actions:r.array(6,()=>r.u8()),routes:r.array(6,()=>r.u8()),deliveries:r.array(6,()=>r.u16()),history:(()=>{if(r.u32()!==6)throw Error("Invalid bounded history length");return r.array(6,()=>summary(r));})(),scores:r.array(6,()=>r.u32()),arrived:r.bool()};r.finishPadding();
 if(g.count<1||g.count>6||g.phase>6||g.stage>5||g.hull>12||g.dealCount>Math.floor(g.count/2))throw Error('Invalid GameV3 state');
 const mask=(1<<g.count)-1;if((g.committed|g.revealed|g.npcMask|g.eligibleMask)&~mask||g.npcMask&g.eligibleMask)throw Error('Invalid seat mask');if(g.revealed&~g.committed)throw Error('Reveal without commitment');
 if(g.phase>=1&&g.phase<=5&&g.count<4||g.flags>7||g.arrived&&(g.phase!==5||g.stage!==5||g.hull===0))throw Error('Invalid campaign state');
 for(const s of g.seats.slice(0,g.count)){if(s.quota>128||s.resources.some((v,i)=>v>200||s.reserved[i]>v)||s.bound!==255&&s.bound>6||s.offerCount>3||s.support>64||s.delivered>30)throw Error('Invalid V3 seat');}
 if(g.actions.some(v=>v>6||(g.stage===5?![0,1,5,6].includes(v):v>4))||g.routes.some(v=>v>1)||g.deliveries.some(v=>v>5||g.stage!==5&&v!==0))throw Error('Invalid current V3 moves');
 const validateOffer=(p:Offer,stage?:number)=>{if(p.status<1||p.status>4||p.kind>3||p.action>6||p.stage>5||stage!==undefined&&p.stage!==stage||p.maker>=g.count||p.taker>=g.count||p.provider>=g.count||p.kind!==0&&p.provider!==p.maker&&p.provider!==p.taker||p.maker===p.taker||p.jobSlot!==255&&p.jobSlot>1||p.delivery>(p.kind===3?5:3)||p.gives.some(b=>b.some(v=>v>5))||p.reserve.some(b=>b.some(v=>v>200)))throw Error('Invalid V3 offer');};
 if(g.offers.some(p=>p.status>4))throw Error('Invalid V3 offer status');
 for(const p of g.offers.filter(p=>p.status!==0))validateOffer(p,g.stage);
 for(const p of g.deals.slice(0,g.dealCount)){validateOffer(p,g.stage);if(p.status!==2)throw Error('Unaccepted V3 deal');}
 let ended=false,lastRevision=0n;
 for(let stage=0;stage<6;stage++){const h=g.history[stage];if(!h.complete){ended=true;continue;}
  if(ended||stage>g.stage||h.hull>12||h.route>1||h.flags>7||h.dealCount>Math.floor(g.count/2)||(h.missing|h.forfeited)&~mask||h.revision<=lastRevision||h.revision>g.revision||h.actions.some(v=>v>6||(stage===5?![0,1,5,6].includes(v):v>4))||h.routes.some(v=>v>1)||h.deliveries.some(v=>v>5||stage!==5&&v!==0)||h.support.some(v=>v>64)||h.delivered.some(v=>v>30)||h.rejected.some(v=>v>4)||[...h.resources,...h.inputs,...h.outputs].some(b=>b.some(v=>v>200)))throw Error('Invalid complete V3 receipt');
  for(const p of h.deals.slice(0,h.dealCount)){validateOffer(p,stage);if(p.status!==2)throw Error('Invalid historical pact');}
  for(let i=0;i<3;i++){const job=h.jobs[i],deal=h.deals[i];
   const paid=stage===1&&i<h.dealCount&&deal.jobSlot!==255;
   if(!paid){if(job.owner!==SYSTEM||job.executed||job.nonce!==0||job.provider!==0||job.slot!==0)throw Error('Unexpected work receipt');continue;}
   if(job.owner===SYSTEM||job.slot>1||job.provider>=g.count||job.owner!==g.seats[job.provider].owner||deal.jobSlot!==job.slot||deal.provider!==job.provider||deal.nonce!==job.nonce||deal.kind!==1||deal.action!==3)throw Error('Invalid canonical work receipt');
  }
  if(stage===5){
   if(h.escortGoal!==(h.route?Math.ceil(g.count/2):0)||h.escortProgress!==h.actions.slice(0,g.count).filter(a=>a===1).length||h.guard!==2*h.escortProgress||h.threat!==(h.route?g.count+4:0)||h.pledged.some((q,i)=>q>5||h.voluntary[i]+q>5||h.deliveries[i]!==q+h.voluntary[i])||h.pricesPaid.some(b=>b.some(v=>v>5))||h.pricesReceived.some(b=>b.some(v=>v>5)))throw Error('Invalid city accounting');
   for(let i=0;i<g.count;i++){const d=h.deals.slice(0,h.dealCount).find(d=>d.kind===3&&d.provider===i);if(h.pledged[i]!==(d?.delivery??0)||h.missing&(1<<i)&&h.voluntary[i]!==0)throw Error('Invalid retained pledge or voluntary delivery');}
  }else if(h.escortGoal||h.escortProgress||h.pledged.some(Boolean)||h.voluntary.some(Boolean)||h.pricesPaid.flat().some(Boolean)||h.pricesReceived.flat().some(Boolean))throw Error('City accounting in another encounter');
  lastRevision=h.revision;
 }
 return g;
}
export async function decodeMission(bytes:Uint8Array):Promise<Mission>{
 const r=new Reader(bytes);if(!equalBytes(r.raw(8),await discriminator('account','Mission')))throw Error('Wrong Mission discriminator');
 const m:Mission={game:r.address(),sponsor:r.address(),bump:r.u8(),roster:r.u32(),rulesHash:r.raw(32),contentHash:r.raw(32),eligibleMask:r.u8(),fundedAt:r.i64(),slots:r.array(2,()=>({status:r.u8(),provider:r.u8(),nonce:r.u32(),owner:r.address()}))};
 if(r.position!==bytes.length||m.slots.some(s=>s.status>3||s.status!==0&&s.provider>5||(s.status===1||s.status===2)&&(s.owner===SYSTEM||!(m.eligibleMask&(1<<s.provider))))||m.eligibleMask>63)throw Error('Invalid mission bounds');return m;
}
