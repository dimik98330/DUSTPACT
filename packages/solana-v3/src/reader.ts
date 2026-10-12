import { address, createSolanaRpcFromTransport, createDefaultRpcTransport, type Address } from '@solana/kit';
import { getSysvarClockDecoder, SYSVAR_CLOCK_ADDRESS } from '@solana/sysvars';
import { LOCAL_RPC_V3 } from './constants';
import { missionAddress, tokenAddress } from './addressing';
import { accountBytesV3, checkedGameV3, checkedMissionV3, checkedTokenAmount } from './accounts';
import type { GameV3, Mission } from './types';

export type ObservationCommitment = 'confirmed' | 'finalized';
export type V3Observation = {
 game: GameV3; mission: Mission | null; missionActive:boolean; escrowAmount: bigint | null;
 genesis: string; slot: bigint; chainNow: bigint; commitment: ObservationCommitment;
};
const SYSVAR_OWNER = address('Sysvar1111111111111111111111111111111111111');
export const observationKey = (value: unknown) => JSON.stringify(value, (_, v) =>
 typeof v === 'bigint' ? v.toString() : v instanceof Uint8Array ? Array.from(v) : v);
export class ObservationConflict extends Error {}
class ClockObservationConflict extends ObservationConflict {}

/** A higher bank slot alone cannot establish continuity of a confirmed fork. */
export function assertObservationContinuity(previous: GameV3, next: GameV3) {
 if (next.revision < previous.revision || next.stage < previous.stage ||
     next.revision === previous.revision && observationKey(next) !== observationKey(previous))
  throw new ObservationConflict('Observation revision changed or regressed; verify a finalized snapshot');
 for (let stage = 0; stage < previous.history.length; stage++)
  if (previous.history[stage].complete && observationKey(previous.history[stage]) !== observationKey(next.history[stage]))
   throw new ObservationConflict('Retained outcome changed; verify a finalized snapshot');
}

/** Public account reader. No signer, wallet, actor journal, funding or transaction methods. */
export class V3Reader {
 readonly rpc;
 private context = new AbortController();
 private genesis: string | undefined;
 private watermarks: Partial<Record<ObservationCommitment, bigint>> = {};
 private previous: Partial<Record<ObservationCommitment, { match: Address; game: GameV3 }>> = {};
 constructor(readonly url = LOCAL_RPC_V3, readonly expectedGenesis?: string) {
  const u = new URL(url);
  if (u.username || u.password || u.hash || !['http:', 'https:'].includes(u.protocol) ||
      u.protocol === 'http:' && !['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname))
   throw Error('Use HTTPS or loopback RPC without credentials');
  const transport = createDefaultRpcTransport({ url });
  this.rpc = createSolanaRpcFromTransport(c => transport({ ...c,
   signal: AbortSignal.any([this.context.signal, AbortSignal.timeout(8000), ...(c.signal ? [c.signal] : [])]) }));
 }
 async read(match: Address, commitment: ObservationCommitment = 'confirmed'): Promise<V3Observation> {
  // Reject an inconsistent bank/Clock, then obtain a fresh complete snapshot.
  // Bounded read retries never retry a signature or relax retained watermarks.
  for(let attempt=0;;attempt++){
   try{return await this.readOnce(match,commitment);}catch(e){
    if(!(e instanceof ClockObservationConflict)||attempt>=2)throw e;
    this.context.signal.throwIfAborted();await new Promise(r=>setTimeout(r,40));
   }
  }
 }
 private async readOnce(match: Address, commitment: ObservationCommitment): Promise<V3Observation> {
  this.context.signal.throwIfAborted();
  if (commitment !== 'confirmed' && commitment !== 'finalized') throw Error('Invalid observation commitment');
  const genesis = await this.rpc.getGenesisHash().send();
  if ((this.expectedGenesis && genesis !== this.expectedGenesis) || (this.genesis && genesis !== this.genesis))
   throw Error('Observation RPC network changed');
  this.genesis = genesis;
  const [mission] = await missionAddress(match), [escrow] = await tokenAddress(mission);
  const minimum = this.watermarks[commitment];
  const response = await this.rpc.getMultipleAccounts([match, mission, escrow, SYSVAR_CLOCK_ADDRESS], {
   encoding: 'base64', commitment, ...(minimum === undefined ? {} : { minContextSlot: minimum }),
  }).send();
  if (response.value.length !== 4 || response.context.slot < 0n || minimum !== undefined && response.context.slot < minimum)
   throw new ObservationConflict('Observation slot regressed');
  const game = await checkedGameV3(match, response.value[0]);
  const vault = await checkedMissionV3(match, response.value[1]);
  const escrowAmount = checkedTokenAmount(response.value[2], mission);
  if (vault && escrowAmount === null) throw Error('Funded mission has no canonical escrow');
  const clock = getSysvarClockDecoder().decode(accountBytesV3(response.value[3], SYSVAR_OWNER, 40));
  if (clock.slot !== response.context.slot) throw new ClockObservationConflict('Clock does not match the observation bank');
  if (await this.rpc.getGenesisHash().send() !== genesis) throw Error('Observation network changed during read');
  this.context.signal.throwIfAborted();
  if(this.genesis!==genesis)throw Error('Observation context changed during read');
  if(this.watermarks[commitment]!==undefined&&response.context.slot<this.watermarks[commitment]!)
   throw new ObservationConflict('Concurrent observation slot regressed');
  const prior = this.previous[commitment];
  if (prior?.match === match) assertObservationContinuity(prior.game, game);
  this.watermarks[commitment] = response.context.slot;
  this.previous[commitment] = { match, game: structuredClone(game) };
  const missionActive=!!vault&&game.mission===mission&&game.missionRoster===vault.roster&&game.roster===vault.roster&&game.eligibleMask===vault.eligibleMask;
  return { game, mission: vault, missionActive, escrowAmount, genesis, slot: response.context.slot, chainNow: clock.unixTimestamp, commitment };
 }
 dispose() { this.context.abort(); }
}
