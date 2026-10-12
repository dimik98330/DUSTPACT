/** Typed Wasm ABI only. All settlement and scores execute in crates/rules-v3. */
export type V3Bundle = [number, number, number];
export interface V3Player { resources: V3Bundle; support: number; delivered: number; forfeited: boolean; }
export interface V3Move { action: number; route: number; delivery: number; }
export interface V3Deal { active: boolean; kind: number; maker: number; taker: number; provider: number; action: number; delivery: number; job: number; gives: [V3Bundle,V3Bundle]; }
export interface V3WorkRecord { active: boolean; provider: number; action: number; job: number; consumed: V3Bundle; delivered: number; executed: boolean; }
export interface V3Input { count: number; stage: number; hull: number; flags: number; players: V3Player[]; moves: V3Move[]; missing: number; deals: V3Deal[]; }
export interface V3Result { players: V3Player[]; hull: number; flags: number; route: number; threat: number; guard: number; actions: number[]; deliveries: number[]; missing: number; objective: boolean; progress: number; goal: number; arrived: boolean; work: V3WorkRecord[]; inputs: V3Bundle[]; outputs: V3Bundle[]; rejected: number[]; scores: number[]; city: V3City; }
export type V3City={escortGoal:number;escortProgress:number;pledged:number[];voluntary:number[];pricesPaid:V3Bundle[];pricesReceived:V3Bundle[]};
export interface V3State { count: number; stage: number; hull: number; flags: number; players: V3Player[]; history: V3Result[]; arrived: boolean; finished: boolean; scores: number[]; }
export const V3_RULES_HASH = '0b7e1aeda6a963473dcaf5d700633ad02c4ed3dba8cd196e0ca7d76bbb7462a3';
export const V3_INITIAL: V3Bundle[] = [[3,0,0],[1,1,0],[0,2,0],[1,1,0],[2,1,0],[2,1,0]];
export const V3_STAGES = [
 { name:'Разрушенный колодец', nameEn:'Broken well', goal:'Создайте воду совместной работой или подготовьте запас для сухого обхода.', goalEn:'Produce water together or prepare supplies for the dry detour.', inputs:[2,1,0], safe:'Починить колодец', risk:'Сухой обход' },
 { name:'Сломанный мост', nameEn:'Broken bridge', goal:'Нужны ремонтные работы. Обход расходует дополнительную воду и закрывает часть находок.', goalEn:'Repair the bridge. The detour uses extra water and limits the next finds.', inputs:[0,1,0], safe:'Починить мост', risk:'Обойти ущелье' },
 { name:'Заброшенная кладовая', nameEn:'Abandoned cache', goal:'Вложите воду и инструмент в ограниченное место добычи. Договор резервирует место и раздел груза.', goalEn:'Invest water and a tool in a limited extraction slot. A pact reserves the slot and cargo split.', inputs:[1,1,0], safe:'Ближняя кладовая', risk:'Дальний склад' },
 { name:'Засада', nameEn:'Ambush', goal:'Прикройте груз или восстановите инструменты для будущего укрытия.', goalEn:'Protect your cargo or recover tools needed for the coming shelter.', inputs:[1,0,0], safe:'Защитить обоз', risk:'Рискнуть на гребне' },
 { name:'Пыльная буря', nameEn:'Dust storm', goal:'Соберите укрытия и воду. Охрана не заменяет ремонтные работы.', goalEn:'Prepare shelter and water. Guarding cannot replace shelter work.', inputs:[0,1,0], safe:'Подготовить укрытие', risk:'Продолжить путь' },
 { name:'Город за туманом', nameEn:'City in the mist', goal:'Доставьте общий груз. Без добытого груза охрана не откроет ворота.', goalEn:'Deliver the shared cargo. Guarding alone cannot open the city gates.', inputs:[0,0,0], safe:'Городские ворота', risk:'Опасный обход' },
] as const;
let kernel: WebAssembly.Instance | null = null;
let loading: Promise<WebAssembly.Instance> | null = null;
export async function loadV3Kernel(source: string | BufferSource = '/engine/rules-v3.wasm') {
 if (kernel) return kernel;
 if (!loading) loading=(async()=>{
  const bytes=typeof source==='string'?await fetch(source).then(r=>{if(!r.ok)throw Error('V3 rules unavailable');return r.arrayBuffer()}):source;
  const instance=(await WebAssembly.instantiate(bytes,{})).instance;
  for(const name of ['memory','input_ptr','output_ptr','settle'])if(!(name in instance.exports))throw Error('Wrong V3 kernel');
  kernel=instance;return instance;
 })().catch(e=>{loading=null;throw e});
 return loading;
}
const integer=(value:number,min:number,max:number)=>Number.isInteger(value)&&value>=min&&value<=max;
export function createV3State(count=4):V3State {
 if(!integer(count,4,6))throw Error('V3 requires 4–6 seats');
 return {count,stage:0,hull:12,flags:0,players:V3_INITIAL.slice(0,count).map(resources=>({resources:[...resources] as V3Bundle,support:0,delivered:0,forfeited:false})),history:[],arrived:false,finished:false,scores:Array(count).fill(0)};
}
export function v3Input(state:V3State,moves:V3Move[],deals:V3Deal[]=[],missing=0):V3Input {return {count:state.count,stage:state.stage,hull:state.hull,flags:state.flags,players:state.players,moves,deals,missing};}
export function advanceV3State(state:V3State,result:V3Result):V3State {
 if(state.finished)throw Error('Expedition already finished');
 return {count:state.count,stage:state.stage===5?5:state.stage+1,hull:result.hull,flags:result.flags,players:result.players,history:[...state.history,result],arrived:result.arrived,finished:result.hull===0||state.stage===5,scores:result.scores};
}
export async function resolveV3(input:V3Input):Promise<V3Result> {
 const n=input.count;
 if(!integer(n,4,6)||!integer(input.stage,0,5)||!integer(input.hull,0,12)||!integer(input.flags,0,255)||!integer(input.missing,0,(1<<n)-1)||input.players.length!==n||input.moves.length!==n||input.deals.length>3)throw Error('Invalid V3 input');
 if(input.players.some(p=>p.resources.length!==3||!p.resources.every(v=>integer(v,0,200))||!integer(p.support,0,64)||!integer(p.delivered,0,30)||typeof p.forfeited!=='boolean')||input.moves.some(m=>!integer(m.action,0,6)||!integer(m.route,0,1)||!integer(m.delivery,0,5)||(input.stage!==5&&m.delivery!==0)))throw Error('Invalid V3 state/move');
 const instance=await loadV3Kernel();const e=instance.exports as any;
 const values=new Uint32Array(128);values.set([n,input.stage,input.hull,input.flags,input.missing]);
 input.players.forEach((p,i)=>values.set([...p.resources,p.support,p.delivered,Number(p.forfeited)],5+i*6));
 input.moves.forEach((m,i)=>values.set([m.action,m.route,m.delivery],41+i*3));
 input.deals.forEach((d,i)=>{
  const fields=[Number(d.active),d.kind,d.maker,d.taker,d.provider,d.action,d.delivery,d.job,...d.gives[0],...d.gives[1]];
  if(fields.length!==14||fields.some(v=>!integer(v,0,65535))||typeof d.active!=='boolean')throw Error('Invalid V3 pact');
  values.set(fields,59+i*14);
 });
 new Uint32Array(e.memory.buffer,e.input_ptr(),128).set(values);
 const code=e.settle();if(code!==0)throw Error(`V3 settlement rejected (${code})`);
 const v=Uint32Array.from(new Uint32Array(e.memory.buffer,e.output_ptr(),224));
 const players=Array.from({length:n},(_,i)=>{const o=11+i*6;return {resources:Array.from(v.slice(o,o+3)) as V3Bundle,support:v[o+3],delivered:v[o+4],forfeited:!!v[o+5]}});
 const work=Array.from({length:3},(_,i)=>{const o=59+i*9;return {active:!!v[o],provider:v[o+1],action:v[o+2],job:v[o+3],consumed:Array.from(v.slice(o+4,o+7)) as V3Bundle,delivered:v[o+7],executed:!!v[o+8]}});
 return {players,hull:v[1],flags:v[2],route:v[3],threat:v[4],guard:v[5],objective:!!v[6],progress:v[7],goal:v[8],arrived:!!v[9],missing:v[10],actions:Array.from(v.slice(47,47+n)),deliveries:Array.from(v.slice(53,53+n)),work,inputs:Array.from({length:n},(_,i)=>Array.from(v.slice(86+i*3,89+i*3)) as V3Bundle),outputs:Array.from({length:n},(_,i)=>Array.from(v.slice(104+i*3,107+i*3)) as V3Bundle),rejected:Array.from(v.slice(122,122+n)),scores:Array.from(v.slice(128,128+n)),city:{escortGoal:v[160],escortProgress:v[161],pledged:Array.from(v.slice(162,162+n)),voluntary:Array.from(v.slice(168,168+n)),pricesPaid:Array.from({length:n},(_,i)=>Array.from(v.slice(174+i*3,177+i*3))as V3Bundle),pricesReceived:Array.from({length:n},(_,i)=>Array.from(v.slice(192+i*3,195+i*3))as V3Bundle)}};
}
export const settleV3=resolveV3;
export async function applyV3Barter(players:V3Player[],maker:number,taker:number,gives:[V3Bundle,V3Bundle]):Promise<V3Player[]> {
 const e=(await loadV3Kernel()).exports as any;const v=new Uint32Array(128);v[0]=players.length;
 if(!integer(players.length,4,6)||!integer(maker,0,players.length-1)||!integer(taker,0,players.length-1)||maker===taker||gives.flat().some(x=>!integer(x,0,5)))throw Error('Invalid barter');
 players.forEach((p,i)=>{if(!p.resources.every(x=>integer(x,0,200)))throw Error('Invalid inventory');v.set([...p.resources,p.support,p.delivered,Number(p.forfeited)],5+i*6)});
 v[61]=maker;v[62]=taker;v.set([...gives[0],...gives[1]],67);new Uint32Array(e.memory.buffer,e.input_ptr(),128).set(v);
 if(e.barter_only()!==0)throw Error('Barter rejected by V3 rules');
 const out=Uint32Array.from(new Uint32Array(e.memory.buffer,e.output_ptr(),160));
 return players.map((_,i)=>{const o=11+i*6;return {resources:Array.from(out.slice(o,o+3)) as V3Bundle,support:out[o+3],delivered:out[o+4],forfeited:!!out[o+5]}});
}
export async function reservesV3(stage:number,deal:V3Deal):Promise<[V3Bundle,V3Bundle]> {
 const e=(await loadV3Kernel()).exports as any;const v=new Uint32Array(128);if(!integer(stage,0,5))throw Error('Invalid stage');v[1]=stage;
 const fields=[Number(deal.active),deal.kind,deal.maker,deal.taker,deal.provider,deal.action,deal.delivery,deal.job,...deal.gives[0],...deal.gives[1]];
 if(fields.length!==14||fields.some(x=>!integer(x,0,65535)))throw Error('Invalid terms');v.set(fields,59);new Uint32Array(e.memory.buffer,e.input_ptr(),128).set(v);
 if(e.reserves_only()!==0)throw Error('V3 terms rejected');const o=Uint32Array.from(new Uint32Array(e.memory.buffer,e.output_ptr(),6));
 return [Array.from(o.slice(0,3)) as V3Bundle,Array.from(o.slice(3,6)) as V3Bundle];
}
