import type { TransactionSigner, Address } from '@solana/kit';
import { CommunityClient, type ChatMessage, type ChatEvent } from '../../../../packages/ui/src/community';
import { PROGRAM_V2, VAULT_PROGRAM } from '../../../../packages/solana-v2/src/index';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID=/^[1-9]\d{0,18}$/;
type Outgoing={clientId:string;text:string;status:'pending'|'unknown'};
export type CommunityState={status:'idle'|'opening'|'connected'|'offline'|'waiting-room';messages:ChatMessage[];outgoing:Outgoing[];present:string[];muted:string[];error:string;older:string|null;room:string|null;atLatest:boolean};
export interface CommunityAccess {
 snapshot():CommunityState;subscribe(listener:()=>void):()=>void;
 connect():Promise<void>;send(text:string):string;check(clientId:string):Promise<void>;retry(clientId:string):void;
 older():Promise<void>;latest():Promise<void>;mute(address:string):void;report(messageId:string):Promise<void>;hide(messageId:string):Promise<void>;
 disconnect():void;dispose():void;readonly host:boolean;
}
export function validV2Message(value:unknown):value is ChatMessage {
 const m=value as ChatMessage;return !!m&&typeof m.id==='string'&&ID.test(m.id)&&BigInt(m.id)<=9223372036854775807n&&typeof m.address==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(m.address)&&
 (typeof m.text==='string'&&Array.from(m.text).length<=500||m.hidden===true&&m.text===null)&&typeof m.createdAt==='string'&&Number.isFinite(Date.parse(m.createdAt))&&(m.clientId==null||typeof m.clientId==='string'&&UUID.test(m.clientId));
}
export function mergeChatMessages(previous:ChatMessage[],incoming:ChatMessage[],hidden=new Set<string>(),direction:'latest'|'older'='latest'){
 const map=new Map(previous.map(m=>[m.id,m]));
 for(const m of incoming.filter(validV2Message)){const old=map.get(m.id);map.set(m.id,{...m,...(old?.hidden||m.hidden||hidden.has(m.id)?{hidden:true,text:null}:{})});}
 const sorted=[...map.values()].map(m=>m.hidden||hidden.has(m.id)?{...m,hidden:true,text:null}:m).sort((a,b)=>BigInt(a.id)<BigInt(b.id)?-1:BigInt(a.id)>BigInt(b.id)?1:0);
 return direction==='older'?sorted.slice(0,300):sorted.slice(-300);
}
/** Optional promises only. This object has no game action, preimage, wallet-transfer or keeper API. */
export class V2Community implements CommunityAccess {
 private view:CommunityState={status:'idle',messages:[],outgoing:[],present:[],muted:[],error:'',older:null,room:null,atLatest:true};
 private live:ChatMessage[]=[];
 private client:CommunityClient<'localnet-v2'|'devnet'>;private listeners=new Set<()=>void>();private socket:WebSocket|null=null;
 private context:AbortController|null=null;private generation=0;private disposed=false;private timers=new Map<string,ReturnType<typeof setTimeout>>();private hidden=new Set<string>();
 private storageKey:string;
 readonly host:boolean;
 constructor(private options:{base:string;origin:string;cluster:'localnet-v2'|'devnet';signer:TransactionSigner;match:string;creator:string;genesis:string;validateContext():Promise<void>;storage?:Pick<Storage,'getItem'|'setItem'>;protocol?:{game:Address;vault:Address;version:2|3}}){
  this.client=new CommunityClient(options.base,options.origin,options.cluster,'v2');this.host=options.creator===options.signer.address;
  this.storageKey=`dustpact:v${options.protocol?.version??2}:chat-outbox:${options.genesis}:${options.protocol?.game??PROGRAM_V2}:${options.match}:${options.signer.address}`;
  try{const raw=options.storage?.getItem(this.storageKey);if(raw){const entries=JSON.parse(raw);if(Array.isArray(entries)&&entries.length<=10)this.view.outgoing=entries.filter(o=>UUID.test(o.clientId)&&typeof o.text==='string'&&Array.from(o.text).length<=500).map(o=>({...o,status:'unknown'}));}}catch{/* Chat cache is optional and never a signature or game authority. */}
 }
 snapshot=()=>this.view;
 subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>this.listeners.delete(listener);};
 private emit(change:Partial<CommunityState>){if(this.disposed)return;this.view={...this.view,...change};try{this.options.storage?.setItem(this.storageKey,JSON.stringify(this.view.outgoing));}catch{}for(const f of this.listeners)f();}
 private alive(generation=this.generation){if(this.disposed||generation!==this.generation)throw new DOMException('Chat context closed','AbortError');this.context?.signal.throwIfAborted();}
 private error(e:unknown){return e instanceof Error?e.message:String(e);}
 private request<T>(path:string,body?:unknown){return this.client.request<T>(path,body,body===undefined?'GET':'POST',{abortSignal:this.context?.signal});}
 private async scope(generation=this.generation){this.alive(generation);await this.options.validateContext();this.alive(generation);}
 connect=async()=>{
  if(this.view.status==='opening'||this.disposed)return;
  this.disconnect();const generation=this.generation;this.context=new AbortController();this.emit({status:'opening',error:''});
  try{
   await this.scope(generation);
   const v=await this.request<{genesis:string;programId:string;vaultProgramId:string;cluster:string}>('/version');this.alive(generation);
   if(v.genesis!==this.options.genesis||v.programId!==(this.options.protocol?.game??PROGRAM_V2)||v.vaultProgramId!==(this.options.protocol?.vault??VAULT_PROGRAM)||v.cluster!==this.options.cluster)throw Error('Сервис сообщений относится к другой сети. / Chat service network mismatch.');
   await this.client.authenticate(this.options.signer,{abortSignal:this.context.signal,validateContext:()=>this.scope(generation)});this.alive(generation);
   const listing=await this.request<{genesis:string;rooms:Array<{id:string;matchAddress:string;hostAddress:string}>}>(`/rooms?matchAddress=${encodeURIComponent(this.options.match)}`);this.alive(generation);
   if(listing.genesis!==this.options.genesis||!Array.isArray(listing.rooms))throw Error('Invalid room scope');
   let room=listing.rooms.find(r=>r.matchAddress===this.options.match&&r.hostAddress===this.options.creator);
   if(!room){
    if(!this.host){this.emit({status:'waiting-room',error:''});return;}
    const created=await this.request<{id:string;match_address:string;host_address:string}>('/rooms',{matchAddress:this.options.match,ownerAddress:this.options.creator,title:'DUSTPACT V2',keeperEnabled:false});this.alive(generation);
    room={id:created.id,matchAddress:created.match_address,hostAddress:created.host_address};
   }
   if(!UUID.test(room.id)||room.matchAddress!==this.options.match||room.hostAddress!==this.options.creator)throw Error('Invalid room response');
   this.emit({room:room.id});
   const ws=await this.client.connect(room.id,e=>this.event(e,generation),()=>{if(!this.disposed&&generation===this.generation){this.unknownAll();this.emit({status:'offline',present:[]});}},{abortSignal:this.context.signal});
   if(this.disposed||generation!==this.generation){ws.close();return;}this.socket=ws;
   await new Promise<void>((resolve,reject)=>{
    if(ws.readyState===WebSocket.OPEN){resolve();return;}
    const timeout=setTimeout(()=>{cleanup();ws.close();reject(Error('Chat connection timed out'));},7000);
    const cleanup=()=>{clearTimeout(timeout);ws.removeEventListener('open',open);ws.removeEventListener('error',error);ws.removeEventListener('close',error);};
    const open=()=>{cleanup();resolve();},error=()=>{cleanup();reject(Error('Chat disconnected'));};
    ws.addEventListener('open',open);ws.addEventListener('error',error);ws.addEventListener('close',error);
   });this.alive(generation);this.emit({status:'connected'});
   // Connect first: live events received while history loads are merged by ID.
   await this.history();this.alive(generation);
   for(const p of [...this.view.outgoing])await this.check(p.clientId);
  }catch(e){if(!this.disposed&&generation===this.generation){this.socket?.close();this.unknownAll();this.emit({status:'offline',error:this.error(e)});}}
 };
 private event(event:ChatEvent,generation:number){
  if(this.disposed||generation!==this.generation)return;
  if(event.type==='message'||event.type==='ack'){
   const m=event.message;if(!validV2Message(m))return;
   this.live=mergeChatMessages(this.live,[m],this.hidden);
   this.emit({messages:this.view.atLatest?this.live:mergeChatMessages(this.view.messages,[m],this.hidden,'older'),...(this.view.atLatest&&this.live.length===300?{older:this.live[0].id}:{})});
   if(m.address===this.options.signer.address&&m.clientId){const pending=this.view.outgoing.find(p=>p.clientId===m.clientId);if(pending&&(m.hidden||m.text===pending.text))this.ack(m.clientId);}
  }else if(event.type==='moderated'){this.hidden.add(event.messageId);this.emit({messages:this.view.messages.map(m=>m.id===event.messageId?{...m,hidden:true,text:null}:m)});}
  else if(event.type==='presence')this.emit({present:event.addresses});
  else if(event.type==='error'){if(event.clientId)this.unknown(event.clientId);this.emit({error:event.code});}
 }
 private ack(id:string){const timer=this.timers.get(id);if(timer)clearTimeout(timer);this.timers.delete(id);this.emit({outgoing:this.view.outgoing.filter(p=>p.clientId!==id)});}
 private unknown(id:string){const timer=this.timers.get(id);if(timer)clearTimeout(timer);this.timers.delete(id);this.emit({outgoing:this.view.outgoing.map(p=>p.clientId===id?{...p,status:'unknown'}:p)});}
 private unknownAll(){for(const t of this.timers.values())clearTimeout(t);this.timers.clear();this.emit({outgoing:this.view.outgoing.map(p=>({...p,status:'unknown'}))});}
 private transmit(p:Outgoing){if(this.socket?.readyState!==WebSocket.OPEN)throw Error('Подключите переговоры. / Connect chat first.');this.emit({outgoing:this.view.outgoing.map(o=>o.clientId===p.clientId?{...o,status:'pending'}:o),error:''});try{this.socket.send(JSON.stringify({type:'message',text:p.text,clientId:p.clientId}));this.timers.set(p.clientId,setTimeout(()=>this.unknown(p.clientId),6500));}catch{this.unknown(p.clientId);}}
 send=(text:string)=>{const body=text.normalize('NFC').trim();if(!body||Array.from(body).length>500||/[\u0000-\u0008\u000b-\u001f\u007f]/.test(body))throw Error('Сообщение: 1–500 символов. / Message: 1–500 characters.');if(this.disposed||this.view.status!=='connected')throw Error('Chat offline');if(this.view.outgoing.length>=10)throw Error('Сначала проверьте неизвестные отправки. / Reconcile pending messages first.');const p:Outgoing={clientId:crypto.randomUUID(),text:body,status:'pending'};this.emit({outgoing:[...this.view.outgoing,p]});this.transmit(p);return p.clientId;};
 retry=(id:string)=>{const p=this.view.outgoing.find(p=>p.clientId===id);if(!p||p.status!=='unknown')return;this.transmit(p);};
 check=async(id:string)=>{if(!UUID.test(id)||!this.view.room)return;const generation=this.generation;const found=await this.request<{messages:ChatMessage[]}>(`/rooms/${this.view.room}/messages?clientId=${encodeURIComponent(id)}`);this.alive(generation);const matches=found.messages?.filter(m=>validV2Message(m)&&m.clientId===id&&m.address===this.options.signer.address)??[];const pending=this.view.outgoing.find(p=>p.clientId===id);if(matches.length){if(pending&&!matches[0].hidden&&matches[0].text!==pending.text){this.unknown(id);throw Error('Тот же ID сохранён с другим текстом. / The same ID is stored with different text.');}this.live=mergeChatMessages(this.live,matches,this.hidden);this.emit({messages:this.view.atLatest?this.live:mergeChatMessages(this.view.messages,matches,this.hidden,'older')});this.ack(id);}else this.unknown(id);};
 private async history(before?:string){if(!this.view.room)return;const generation=this.generation;const result=await this.request<{messages:ChatMessage[];nextCursor:string|null}>(`/rooms/${this.view.room}/messages${before?`?before=${encodeURIComponent(before)}`:''}`);this.alive(generation);if(!Array.isArray(result.messages)||result.messages.length>100||result.nextCursor!==null&&!ID.test(result.nextCursor))throw Error('Invalid chat history');if(!before)this.live=mergeChatMessages(this.live,result.messages,this.hidden);const messages=before?mergeChatMessages(this.view.messages,result.messages,this.hidden,'older'):this.live;this.emit({messages,atLatest:!before,older:result.nextCursor!==null?messages[0]?.id??null:null});}
 older=async()=>{if(this.view.older)await this.history(this.view.older);};
 latest=async()=>{await this.history();};
 mute=(address:string)=>this.emit({muted:this.view.muted.includes(address)?this.view.muted.filter(a=>a!==address):[...this.view.muted,address].slice(-12)});
 report=async(id:string)=>{if(!ID.test(id)||!this.view.room)throw Error('Invalid message');await this.request('/reports',{roomId:this.view.room,messageId:id,reason:'Сообщение мешает игре / Disruptive message'});};
 hide=async(id:string)=>{if(!this.host||!ID.test(id)||!this.view.room)throw Error('Host required');await this.request(`/rooms/${this.view.room}/moderate`,{messageId:id});};
 disconnect=()=>{this.generation++;this.context?.abort();this.socket?.close();this.socket=null;this.unknownAll();this.emit({status:'offline',present:[]});};
 dispose=()=>{this.disconnect();this.disposed=true;this.listeners.clear();};
}
