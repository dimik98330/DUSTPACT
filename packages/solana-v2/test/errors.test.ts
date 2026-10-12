import {test} from 'node:test';
import assert from 'node:assert/strict';
import {V2SimulationError,PROGRAM_V2,VAULT_PROGRAM} from '../src/index';
const instructions=[{programAddress:PROGRAM_V2,data:Uint8Array.of(1)}];
test('Simulation reports the bound-action error code without raw logs or private data',()=>{
 const error=new V2SimulationError({InstructionError:[0,{Custom:6011}]},instructions,['user payload secret=SHOULD_NOT_APPEAR',`Program ${PROGRAM_V2} failed: custom program error: 0x177b`]);
 assert.equal(error.programErrorCode,6011);assert.equal(error.program,PROGRAM_V2);assert.match(error.message,/Action already bound/);assert.doesNotMatch(error.message,/SHOULD_NOT_APPEAR/);
});
test('Fixed Vault CPI origin disambiguates overlapping Game custom error codes',()=>{
 const error=new V2SimulationError({InstructionError:[0,{Custom:6012}]},instructions,[`Program ${VAULT_PROGRAM} failed: custom program error: 0x177c`,`Program ${PROGRAM_V2} failed: custom program error: 0x177c`]);
 assert.equal(error.program,VAULT_PROGRAM);assert.match(error.message,/reservation window expired/);
});
test('Malformed or attacker-named logs cannot replace a structured diagnostic',()=>{
 const error=new V2SimulationError({InstructionError:[0,{Custom:6009}]},instructions,['Instruction: print secret',`Program ${VAULT_PROGRAM} failed: custom program error: 0x1234`]);
 assert.equal(error.program,PROGRAM_V2);assert.match(error.message,/Insufficient free resources/);assert.doesNotMatch(error.message,/secret/);
 const invalid=new V2SimulationError({InstructionError:[999,{Custom:-1}]},instructions,null);assert.equal(invalid.programErrorCode,undefined);assert.equal(invalid.instructionIndex,undefined);
});
