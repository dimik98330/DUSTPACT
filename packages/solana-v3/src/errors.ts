import type {Address,Instruction} from '@solana/kit';
import {PROGRAM_V3,VAULT_PROGRAM} from './constants';

const gameReasons=['Wrong phase','Window expired','Roster or plans not ready','Too early','Invalid arguments','Stale nonce, stage or epoch','Unauthorized owner or session','Duplicate action','No seat, recipe or pact capacity','Insufficient free resources','Seal unavailable','Action already bound','Commitment mismatch','Arithmetic overflow','Reviewed configuration or terms changed','Mission or paid slot mismatch'];
const vaultReasons=['Invalid phase','Mission configuration changed','Invalid token account or mint','Noncanonical destination','Job slot unavailable','Only Game Match PDA may reserve','Seat not eligible','Canonical job mismatch','Receipt not yet complete','Work not performed','Executed work cannot refund','Arithmetic overflow','Unfilled reservation window expired'];

/** Whitelisted public diagnostics only. Never exposes raw RPC logs or transaction bytes. */
export class V3SimulationError extends Error {
 readonly instructionIndex?:number;
 readonly program?:Address;
 readonly programErrorCode?:number;
 constructor(error:unknown,instructions:readonly Instruction[],logs:readonly string[]|null|undefined){
  const failure=error&&typeof error==='object'&&!Array.isArray(error)?(error as {InstructionError?:unknown}).InstructionError:undefined;
  let index:number|undefined,code:number|undefined,program:Address|undefined;
  if(Array.isArray(failure)&&failure.length===2&&Number.isInteger(failure[0])&&failure[0]>=0&&failure[0]<instructions.length){
   index=failure[0];const value=failure[1];if(value&&typeof value==='object'&&!Array.isArray(value)&&Number.isSafeInteger(value.Custom)&&value.Custom>=0&&value.Custom<=0xffffffff)code=value.Custom;
   program=instructions[index!].programAddress;
  }
  // The final CPI error may originate in Vault rather than the top-level Game instruction.
  // Read only a bounded, exact Solana failure line naming one of our two fixed programs.
  for(const line of (logs??[]).slice(0,200)){
   if(typeof line!=='string'||line.length>256)continue;
   const match=/^Program ([1-9A-HJ-NP-Za-km-z]{32,44}) failed: custom program error: (0x[0-9a-f]+|[0-9]+)$/.exec(line);
   if(match&&Number(match[2])===code&&([PROGRAM_V3,VAULT_PROGRAM] as Address[]).includes(match[1] as Address)){
    // Solana logs inner failure before the outer caller; retain the first/deepest fixed-program match.
    program=match[1] as Address;break;
   }
  }
  const known=code===undefined?undefined:program===PROGRAM_V3?gameReasons[code-6000]:program===VAULT_PROGRAM?vaultReasons[code-6000]:undefined;
  super(`V3 program simulation rejected the reviewed action${code===undefined?'':`: custom error ${code}${known?` (${known})`:''}`}`);
  this.name='V3SimulationError';this.instructionIndex=index;this.program=program;this.programErrorCode=code;
 }
}
