import { address, type Address } from '@solana/kit';
import { configBytes, prepareMove } from './consent';
import { equalBytes } from './codec';
import { PROGRAM_V2, VAULT_PROGRAM, SYSTEM } from './constants';
import type { GameV2, PreparedMove } from './types';
import { decodeDirectPendingRecord, type DirectPendingRecord } from '../../solana-client/src/pending';

export const RECOVERY_COPY_LIMIT=16*1024;
export type RecoveryScope={match:Address;genesis:string;seat:number;game:GameV2};
export const recoveryMoveScope=(s:RecoveryScope)=>JSON.stringify({config:Array.from(configBytes(s.match,s.game)),stage:s.game.stage,seat:s.seat,bound:s.game.seats[s.seat]?.bound});
function object(value:unknown,allowed:string[]){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!allowed.includes(k)))throw Error('Invalid recovery copy shape');
 return value as Record<string,unknown>;
}
const bytes=(v:unknown)=>{if(!Array.isArray(v)||v.length!==32||v.some(n=>!Number.isInteger(n)||n<0||n>255))throw Error('Invalid move bytes');return Uint8Array.from(v);};
export function privateMoveEnvelope(p:PreparedMove,genesis:string){return {version:2,program:PROGRAM_V2,genesis,match:p.match,seat:p.seat,owner:p.owner,stage:p.stage,action:p.action,route:p.route,delivery:p.delivery,salt:Array.from(p.salt),commitment:Array.from(p.commitment)};}
/** The salt is private until reveal. A copy supplies a choice, never wallet/session authority. */
export async function verifyPrivateMoveCopy(json:string,scope:RecoveryScope):Promise<PreparedMove>{
 if(json.length>RECOVERY_COPY_LIMIT)throw Error('Recovery copy exceeds 16 KiB');
 const d=object(JSON.parse(json),['version','program','genesis','match','seat','owner','stage','action','route','delivery','salt','commitment']);
 const g=structuredClone(scope.game),s=g.seats[scope.seat];
 if(!s||scope.seat>=g.count||d.version!==2||d.program!==PROGRAM_V2||d.genesis!==scope.genesis||d.match!==scope.match||d.seat!==scope.seat||d.owner!==s.owner||d.stage!==g.stage)throw Error('Move copy belongs to another network, Match, owner or stage');
 const p=await prepareMove(scope.match,g,scope.seat,{action:d.action as number,route:d.route as number,delivery:d.delivery as number},bytes(d.salt));
 if(!equalBytes(p.commitment,bytes(d.commitment))||s.bound!==255&&s.bound!==p.action||g.committed&(1<<scope.seat)&&!equalBytes(g.commitments[scope.seat],p.commitment))throw Error('Move copy does not match the canonical commitment or bound work');
 return p;
}
/** Validate recovery material without approving it for the current stage/bound action.
 * Call verifyPrivateMoveCopy again against fresh canonical state before any signing. */
export async function verifyPrivateBackupCandidate(json:string,scope:RecoveryScope):Promise<PreparedMove>{
 if(json.length>RECOVERY_COPY_LIMIT)throw Error('Recovery copy exceeds 16 KiB');
 const d=JSON.parse(json);if(!Number.isInteger(d?.stage)||d.stage<0||d.stage>5)throw Error('Invalid backup stage');
 const game=structuredClone(scope.game);game.stage=d.stage;game.committed=0;game.seats[scope.seat].bound=255;
 return verifyPrivateMoveCopy(json,{...scope,game});
}
export function recoveryBundle(scope:RecoveryScope,move:PreparedMove|null,pending:readonly DirectPendingRecord[],sessionActor?:Address){
 if(pending.length>16)throw Error('Too many recovery records');
 const actors=[scope.game.seats[scope.seat].owner,...(sessionActor&&sessionActor!==SYSTEM?[sessionActor]:[])];
 for(const r of pending)if(r.match!==scope.match||r.genesis!==scope.genesis||!([PROGRAM_V2,VAULT_PROGRAM]as Address[]).includes(r.program)||!actors.includes(r.actor))throw Error('Pending recovery context mismatch');
 const copy={version:2,recoveryBundle:1,program:PROGRAM_V2,genesis:scope.genesis,match:scope.match,seat:scope.seat,owner:scope.game.seats[scope.seat].owner,actors,move:move?privateMoveEnvelope(move,scope.genesis):null,pending};
 const json=JSON.stringify(copy,(_,v)=>typeof v==='bigint'?v.toString():v);
 if(json.length>RECOVERY_COPY_LIMIT)throw Error('Recovery copy exceeds 16 KiB');return json;
}
export async function verifyRecoveryBundle(json:string,scope:RecoveryScope){
 if(json.length>RECOVERY_COPY_LIMIT)throw Error('Recovery copy exceeds 16 KiB');
 const raw=JSON.parse(json);
 const currentMove=async(value:unknown)=>{
  const d=object(value,['version','program','genesis','match','seat','owner','stage','action','route','delivery','salt','commitment']);
  if(!Number.isInteger(d.stage)||(d.stage as number)<0||(d.stage as number)>scope.game.stage)throw Error('Move copy belongs to an invalid or future stage');
  if(d.stage===scope.game.stage)return {move:await verifyPrivateMoveCopy(JSON.stringify(d),scope),staleMove:false};
  // Old preimages cannot be used for signing, but must not discard a current public journal.
  // Verify the old bytes under the same immutable roster/config without today's bound action.
  const prior=structuredClone(scope.game);prior.stage=d.stage as number;prior.committed=0;prior.seats[scope.seat].bound=255;
  await verifyPrivateMoveCopy(JSON.stringify(d),{...scope,game:prior});
  return {move:null,staleMove:true};
 };
 if(raw?.recoveryBundle===undefined)return {...await currentMove(raw),pending:[] as DirectPendingRecord[],legacyMoveOnly:true};
 const d=object(raw,['version','recoveryBundle','program','genesis','match','seat','owner','actors','move','pending']);
 if(d.version!==2||d.recoveryBundle!==1||d.program!==PROGRAM_V2||d.genesis!==scope.genesis||d.match!==scope.match||d.seat!==scope.seat||d.owner!==scope.game.seats[scope.seat]?.owner||!Array.isArray(d.actors)||d.actors.length<1||d.actors.length>2||!Array.isArray(d.pending)||d.pending.length>16)throw Error('Recovery bundle context mismatch');
 const actors=d.actors.map(a=>address(a as string));
 if(actors[0]!==d.owner||new Set(actors).size!==actors.length||actors.includes(SYSTEM))throw Error('Invalid recovery actor context');
 const pending=d.pending.map(value=>{
  const r=value as Record<string,unknown>,program=address(r.program as string),actor=address(r.actor as string);
  if(!([PROGRAM_V2,VAULT_PROGRAM]as Address[]).includes(program)||!actors.includes(actor)||r.match!==scope.match)throw Error('Foreign recovery journal scope');
  return decodeDirectPendingRecord(value,{program,actor,genesis:scope.genesis});
 });
 if(new Set(pending.map(r=>r.signature)).size!==pending.length)throw Error('Duplicate recovery signature');
 let choice:{move:PreparedMove|null;staleMove:boolean;invalidMove?:boolean}={move:null,staleMove:false};
 if(d.move!==null){try{choice=await currentMove(d.move);}catch{choice={move:null,staleMove:false,invalidMove:true};}}
 // A superseded bound action/commitment cannot reveal. Its failure must not discard
 // the separately validated public journal that prevents an unsafe second signature.
 return {...choice,pending,legacyMoveOnly:false};
}
