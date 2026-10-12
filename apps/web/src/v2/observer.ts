import type { Address } from '@solana/kit';
import { V2Reader, ObservationConflict, type ObservationCommitment, type V2Observation } from '../../../../packages/solana-v2/src/reader';
import { verifyV2History } from '../../../../packages/engine/src/v2-replay';

type ReaderAccess = Pick<V2Reader,'read'|'dispose'>;
export type ObserverState = {
 status:'loading'|'live'|'stale'|'resync'|'closed'; commitment:ObservationCommitment;
 observation?:V2Observation; seenAt?:number; error?:string;
 replay?:Awaited<ReturnType<typeof verifyV2History>>;
};
/** Deliberately separate from GameController: no signing, seat, chat or game mutations. */
export class ObserverController {
 private state:ObserverState={status:'loading',commitment:'finalized'};
 private listeners=new Set<()=>void>();
 private disposed=false;
 private started=false;
 private generation=0;
 private flight:Promise<void>|null=null;
 private timer:ReturnType<typeof setTimeout>|undefined;
 constructor(readonly match:Address,private reader:ReaderAccess,
  private replay:typeof verifyV2History=verifyV2History) {}
 snapshot=()=>this.state;
 subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>this.listeners.delete(listener);};
 private publish(state:ObserverState){if(this.disposed)return;this.state=state;for(const f of this.listeners)f();}
 async refresh():Promise<void>{
  if(this.disposed)return;
  if(this.flight)return this.flight;
  const generation=this.generation,commitment=this.state.commitment;
  const live=()=>!this.disposed&&generation===this.generation;
  this.flight=(async()=>{
   try {
    const observation=await this.reader.read(this.match,commitment);if(!live())return;
    // A proof never survives a failed read or a different snapshot/commitment.
    const proof=observation.game.phase===5&&commitment==='finalized'?await this.replay(observation.game):undefined;
    if(!live())return;
    this.publish({status:'live',commitment,observation,seenAt:Date.now(),...(proof?{replay:proof}:{})});
   } catch(e) {
    if(live())this.publish({...this.state,status:e instanceof ObservationConflict?'resync':'stale',replay:undefined,error:e instanceof Error?e.message:String(e)});
   }
  })().finally(()=>{this.flight=null;});
  return this.flight;
 }
 async setCommitment(commitment:ObservationCommitment){
  if(commitment!=='confirmed'&&commitment!=='finalized')throw Error('Invalid observation commitment');
  if(this.disposed)return;
  ++this.generation;
  this.publish({...this.state,status:this.state.observation?'stale':'loading',commitment,replay:undefined,error:undefined});
  if(this.flight)await this.flight;
  await this.refresh();
 }
 start(){if(this.started||this.disposed)return;this.started=true;const poll=async()=>{await this.refresh();if(!this.disposed)this.timer=setTimeout(()=>void poll(),this.state.observation?.game.phase===5?5000:2400);};void poll();}
 dispose(){this.disposed=true;++this.generation;if(this.timer)clearTimeout(this.timer);this.reader.dispose();this.listeners.clear();this.state={status:'closed',commitment:this.state.commitment};}
}
