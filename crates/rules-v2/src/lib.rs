//! V2's single deterministic settlement kernel, used by SBF and browser Wasm.
pub const MAX: usize = 6;
pub const INITIAL: [[u16; 3]; MAX] = [[3,0,0],[1,1,0],[0,2,0],[1,1,0],[2,1,0],[2,1,0]];
pub const RULES_HASH: [u8;32] = [72,144,212,167,222,49,168,175,4,177,81,77,97,13,212,124,150,33,245,22,244,57,40,156,185,38,201,86,192,61,15,33];
pub const CONTENT_HASH: [u8;32] = RULES_HASH;
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Player { pub resources:[u16;3], pub support:u16, pub delivered:u16, pub forfeited:bool }
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Move { pub action:u8, pub route:u8, pub delivery:u16 }
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Deal { pub active:bool, pub kind:u8, pub maker:u8, pub taker:u8, pub provider:u8, pub action:u8, pub delivery:u16, pub job:u8, pub gives:[[u16;3];2] }
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct WorkRecord { pub active:bool, pub provider:u8, pub action:u8, pub job:u8, pub consumed:[u16;3], pub delivered:u16, pub executed:bool }
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Input { pub count:u8, pub stage:u8, pub hull:u8, pub flags:u8, pub players:[Player;6], pub moves:[Move;6], pub missing:u8, pub deals:[Deal;3] }
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ResultState { pub players:[Player;6], pub hull:u8, pub flags:u8, pub route:u8, pub threat:u8, pub guard:u8, pub actions:[u8;6], pub deliveries:[u16;6], pub missing:u8, pub objective:bool, pub progress:u16, pub goal:u16, pub arrived:bool, pub work:[WorkRecord;3], pub inputs:[[u16;3];6], pub outputs:[[u16;3];6], pub rejected:[u8;6] }
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Error { Invalid, Insufficient, Overflow, DuplicateActor, Capacity }

pub fn recipe(stage:u8)->Result<[u16;3],Error> { match stage {0=>Ok([2,1,0]),2=>Ok([1,1,0]),_=>Err(Error::Invalid)} }
pub fn action_cost(stage:u8,action:u8)->Result<[u16;3],Error> {
 if stage>5||action>4{return Err(Error::Invalid)}
 Ok(match action {3=>if stage==0 {[2,1,0]}else{[0,1,0]},4=>match stage{2=>[1,1,0],3=>[1,0,0],_=>return Err(Error::Invalid)},_=>[0;3]})
}
/// Includes deferred price and provider inputs after receiving that price.
pub fn reserves(stage:u8,d:Deal)->Result<[[u16;3];2],Error>{
 if !d.active||d.kind>2||d.maker==d.taker||d.maker>=6||d.taker>=6||d.gives.iter().flatten().any(|&v|v>5)||!d.gives.iter().flatten().any(|&v|v>0){return Err(Error::Invalid)}
 if d.kind==0 {if d.delivery!=0||d.job!=255{return Err(Error::Invalid)}return Ok(d.gives)}
 if d.provider!=d.maker&&d.provider!=d.taker{return Err(Error::Invalid)}
 let side=if d.provider==d.maker{0}else{1};
 if d.kind==2 {
  let inputs=recipe(stage)?;
  if d.action!=if stage==0{3}else{4}||d.delivery!=0||d.job!=255{return Err(Error::Invalid)}
  for j in 0..3 {if d.gives[0][j]+d.gives[1][j]!=inputs[j]{return Err(Error::Invalid)}}
  return Ok(d.gives)
 }
 if ![1,2,3].contains(&d.action)||d.gives[side]!=[0;3]||d.delivery>3||(d.action!=2&&d.delivery!=0)||(d.job!=255&&(stage!=1||d.action!=3||d.job>1)){return Err(Error::Invalid)}
 let cost=action_cost(stage,d.action)?;
 let mut reserve=d.gives;
 for j in 0..3 {reserve[side][j]=cost[j].saturating_sub(d.gives[1-side][j]);}
 Ok(reserve)
}
fn add(p:&mut Player,j:usize,v:u16)->Result<(),Error>{p.resources[j]=p.resources[j].checked_add(v).filter(|&x|x<=200).ok_or(Error::Overflow)?;Ok(())}
fn consume(p:&mut Player,c:[u16;3])->Result<(),Error>{for j in 0..3{p.resources[j]=p.resources[j].checked_sub(c[j]).ok_or(Error::Insufficient)?}Ok(())}
fn has(p:Player,c:[u16;3])->bool{(0..3).all(|j|p.resources[j]>=c[j])}
pub fn barter(mut players:[Player;6],count:u8,maker:u8,taker:u8,gives:[[u16;3];2])->Result<[Player;6],Error>{
 if !(4..=6).contains(&count)||maker>=count||taker>=count||maker==taker||gives.iter().flatten().any(|&x|x>5)||!gives.iter().flatten().any(|&x|x>0){return Err(Error::Invalid)}
 consume(&mut players[maker as usize],gives[0])?;consume(&mut players[taker as usize],gives[1])?;
 for j in 0..3{add(&mut players[maker as usize],j,gives[1][j])?;add(&mut players[taker as usize],j,gives[0][j])?;}Ok(players)
}
pub fn score(p:Player,arrived:bool)->Option<u32>{if !arrived||p.forfeited{None}else{Some(3*p.resources[2] as u32+p.delivered as u32+p.support as u32)}}

pub fn resolve(input:Input)->Result<ResultState,Error>{
 let n=input.count as usize;let stage=input.stage;
 if !(4..=6).contains(&n)||stage>5||input.hull>12||input.missing&!((1u8<<n)-1)!=0||input.players[..n].iter().any(|p|p.resources.iter().any(|&x|x>200)||p.support>64||p.delivered>30)||input.moves[..n].iter().any(|m|m.action>4||m.route>1||m.delivery>5||(stage!=5&&m.delivery!=0)){return Err(Error::Invalid)}
 let mut p=input.players;let mut m=input.moves;let mut actions=[0u8;6];let mut deliveries=[0u16;6];let mut work=[WorkRecord::default();3];let mut parties=0u8;let mut joint=0u8;let mut projects=0usize;
 let mut inputs=[[0u16;3];6];let mut outputs=[[0u16;3];6];let mut rejected=[0u8;6];
 for i in 0..n {if input.missing&(1<<i)!=0{p[i].forfeited=true;m[i]=Move::default()}}
 for (index,d) in input.deals.iter().enumerate().filter(|(_,d)|d.active){
  if d.maker as usize>=n||d.taker as usize>=n{return Err(Error::Invalid)}
  let reserve=reserves(stage,*d)?;let bits=(1<<d.maker)|(1<<d.taker);if parties&bits!=0{return Err(Error::DuplicateActor)}parties|=bits;
  let a=d.provider as usize;
  if d.kind==0{continue} // Barter was already executed atomically at acceptance.
  if d.kind==1 {
   let ma=d.maker as usize;let ta=d.taker as usize;
   consume(&mut p[ma],d.gives[0])?;consume(&mut p[ta],d.gives[1])?;
   for j in 0..3{add(&mut p[ma],j,d.gives[1][j])?;add(&mut p[ta],j,d.gives[0][j])?;}
  }else{
   projects+=1;
   if stage==2&&projects>if input.flags&2!=0{2}else{1}{return Err(Error::Capacity)}
   consume(&mut p[d.maker as usize],d.gives[0])?;consume(&mut p[d.taker as usize],d.gives[1])?;
   inputs[d.maker as usize]=d.gives[0];inputs[d.taker as usize]=d.gives[1];joint|=1<<a;
  }
  let _=reserve;
  m[a].action=d.action;
  work[index]=WorkRecord{active:true,provider:d.provider,action:d.action,job:d.job,consumed:if d.kind==2{d.gives[if d.provider==d.maker{0}else{1}]}else{action_cost(stage,d.action)?},delivered:0,executed:false};
 }
 let route=if m[..n].iter().filter(|x|x.route==1).count()>n/2{1}else{0};
 let mut slots=if stage==2{if input.flags&2!=0{2usize}else{1}}else if stage==3{2}else{0};
 slots=slots.saturating_sub(if stage==2{projects}else{0});
 let mut solo_salvage=0u8;
 if stage==2||stage==3 {for k in 0..n{let i=(stage as usize+k)%n;if m[i].action==4&&joint&(1<<i)==0&&slots>0&&has(p[i],action_cost(stage,4)?){solo_salvage|=1<<i;slots-=1}}}
 let(mut guard,mut repair,mut wells,mut repairers)=(0u8,0u8,0u16,0u16);
 let bound_mask=work.iter().filter(|w|w.active).fold(0u8,|mask,w|mask|(1<<w.provider));
 for pass in 0..2 {for i in 0..n {
  if (bound_mask&(1<<i)!=0)!=(pass==0){continue}
  let a=m[i].action;
  if joint&(1<<i)!=0 {
   let d=input.deals.iter().find(|d|d.active&&d.kind==2&&d.provider as usize==i).ok_or(Error::Invalid)?;
   let(resource,yield_each)=if stage==0{(0,4)}else{(2,if route==0{3}else{4})};
   add(&mut p[d.maker as usize],resource,yield_each)?;add(&mut p[d.taker as usize],resource,yield_each)?;
   outputs[d.maker as usize][resource]+=yield_each;outputs[d.taker as usize][resource]+=yield_each;
   if stage==0{wells+=1;p[i].support+=2;}
   actions[i]=a;
  }else {
   let cost=match action_cost(stage,a){Ok(c)=>c,Err(_)=>{rejected[i]=1;continue}};
   if !has(p[i],cost){rejected[i]=2;continue}
   if a==4&&solo_salvage&(1<<i)==0{rejected[i]=3;continue}
   let mut produced=[0u16;3];
   match a{2=>produced[0]=3-input.deals.iter().find(|d|d.active&&d.kind==1&&d.provider as usize==i&&d.action==2).map(|d|d.delivery).unwrap_or(0),3=>if stage==0{produced[0]=8},4=>if stage==2{produced[2]=if route==0{6}else{8}}else{produced[1]=2},_=>{}}
   if (0..3).any(|j|p[i].resources[j]-cost[j]+produced[j]>200){if bound_mask&(1<<i)!=0{return Err(Error::Overflow)}rejected[i]=4;continue}
   for j in 0..3{inputs[i][j]+=cost[j];}
   consume(&mut p[i],cost)?;
   match a {
    0=>{},1=>{guard+=2;p[i].support+=1},
    2=>{
     let d=input.deals.iter().find(|d|d.active&&d.kind==1&&d.provider as usize==i&&d.action==2);
     let delivery=d.map(|x|x.delivery).unwrap_or(0);
     add(&mut p[i],0,3-delivery)?;outputs[i][0]+=3-delivery;
     if let Some(d)=d {let buyer=if d.maker as usize==i{d.taker}else{d.maker}as usize;add(&mut p[buyer],0,delivery)?;outputs[buyer][0]+=delivery;}
     for record in &mut work{if record.active&&record.provider as usize==i{record.delivered=delivery;}}
    },
    3=>{p[i].support+=2;if stage==0{add(&mut p[i],0,8)?;outputs[i][0]+=8;wells+=1;}else{repair+=2;repairers+=1;}},
    4=>if stage==2{let loot=if route==0{6}else{8};add(&mut p[i],2,loot)?;outputs[i][2]+=loot;}else{add(&mut p[i],1,2)?;outputs[i][1]+=2;},
    _=>return Err(Error::Invalid)
   }
   actions[i]=a;
  }
  for record in &mut work{if record.active&&record.provider as usize==i{record.executed=actions[i]==record.action;}}
 }
 }
 let mut flags=input.flags;let(goal,progress,objective);let mut extra_damage=0u8;
 let mut drink=1u16;
 let threat=match stage{2=>n as u8-2+route*2,3=>n as u8+2+route*2,5=>if route==1{n as u8+4}else{0},_=>0};
 match stage {
  0=>{goal=1;progress=wells;objective=wells>0;if wells>0{flags|=1}if route==1{drink=2}else if !objective{extra_damage=2}},
  1=>{goal=((n+1)/2)as u16;progress=repairers;objective=route==1||repairers>=goal;if route==0&&repairers>=goal{flags|=2}else{drink=2;if route==0{extra_damage=4}}},
  2=>{goal=1;progress=actions[..n].iter().filter(|&&a|a==4).count()as u16;objective=progress>0;if objective{flags|=4}},
  3=>{goal=threat as u16;progress=guard as u16;objective=guard>=threat;},
  4=>{goal=((n+2)/3)as u16;progress=repairers;objective=progress>=goal;extra_damage=goal.saturating_sub(progress)as u8*2;drink=2;},
  5=>{
   for i in 0..n{let value=m[i].delivery.min(p[i].resources[2]);p[i].resources[2]-=value;p[i].delivered+=value;deliveries[i]=value;inputs[i][2]+=value;}
   goal=if route==0{n as u16}else{((n+1)/2)as u16};progress=deliveries[..n].iter().sum();objective=progress>=goal;
  },_=>return Err(Error::Invalid)
 }
 let combat=threat.saturating_sub(guard);
 if stage==3 {
  let mut loss=combat as u16;
  while loss>0{
   let best=(0..n).map(|k|(stage as usize+k)%n).filter(|&i|p[i].resources[2]>0).max_by_key(|&i|p[i].resources[2]);
   if let Some(i)=best{p[i].resources[2]-=1;loss-=1}else{break}
  }
 }
 let mut thirst=0u8;
 for player in p.iter_mut().take(n){let used=player.resources[0].min(drink);player.resources[0]-=used;thirst=thirst.checked_add((drink-used)as u8).ok_or(Error::Overflow)?;}
 if p[..n].iter().any(|p|p.support>64||p.delivered>30){return Err(Error::Overflow)}
 let hull=(input.hull+repair).min(12).saturating_sub(combat.saturating_add(extra_damage).saturating_add(thirst));
 Ok(ResultState{players:p,hull,flags,route,threat,guard,actions,deliveries,missing:input.missing,objective,progress,goal,arrived:stage==5&&hull>0&&objective,work,inputs,outputs,rejected})
}

#[cfg(all(target_arch="wasm32", not(feature="no-wasm-exports")))]
mod wasm {
 use super::*;
 static mut INPUT:[u32;128]=[0;128];static mut OUTPUT:[u32;160]=[0;160];
 #[no_mangle]pub extern "C" fn input_ptr()->*mut u32{core::ptr::addr_of_mut!(INPUT).cast()}
 #[no_mangle]pub extern "C" fn output_ptr()->*mut u32{core::ptr::addr_of_mut!(OUTPUT).cast()}
 #[no_mangle]pub extern "C" fn barter_only()->u32{
  let v=unsafe{INPUT};if v.iter().any(|&x|x>u16::MAX as u32)||v[0]>6||v[61]>5||v[62]>5{return 1}
  let mut p=[Player::default();6];for i in 0..6{let o=5+i*6;p[i]=Player{resources:[v[o]as u16,v[o+1]as u16,v[o+2]as u16],support:v[o+3]as u16,delivered:v[o+4]as u16,forfeited:v[o+5]!=0};}
  match barter(p,v[0]as u8,v[61]as u8,v[62]as u8,[[v[67]as u16,v[68]as u16,v[69]as u16],[v[70]as u16,v[71]as u16,v[72]as u16]]){
   Ok(p)=>{let mut out=[0u32;160];for i in 0..6{let o=11+i*6;for j in 0..3{out[o+j]=p[i].resources[j]as u32}out[o+3]=p[i].support as u32;out[o+4]=p[i].delivered as u32;out[o+5]=p[i].forfeited as u32;}unsafe{OUTPUT=out};0},Err(_)=>2
  }
 }
 #[no_mangle]pub extern "C" fn reserves_only()->u32{
  let v=unsafe{INPUT};if v.iter().any(|&x|x>u16::MAX as u32)||v[1]>5||v[60]>2||v[61]>5||v[62]>5||v[63]>5||v[64]>4||v[66]>255{return 1}
  let d=Deal{active:true,kind:v[60]as u8,maker:v[61]as u8,taker:v[62]as u8,provider:v[63]as u8,action:v[64]as u8,delivery:v[65]as u16,job:v[66]as u8,gives:[[v[67]as u16,v[68]as u16,v[69]as u16],[v[70]as u16,v[71]as u16,v[72]as u16]]};
  match reserves(v[1]as u8,d){Ok(r)=>{let mut out=[0u32;160];for side in 0..2{for j in 0..3{out[side*3+j]=r[side][j]as u32}}unsafe{OUTPUT=out};0},Err(_)=>2}
 }
 #[no_mangle]pub extern "C" fn settle()->u32{
  let v=unsafe{INPUT};if v.iter().any(|&x|x>u16::MAX as u32){return 1}
  let mut p=[Player::default();6];let mut m=[Move::default();6];let mut ds=[Deal::default();3];
  if v[0]>6||v[1]>5||v[2]>12||v[3]>255||v[4]>63{return 1}
  for i in 0..6{let o=5+i*6;if v[o+5]>1||v[41+i*3]>4||v[42+i*3]>1{return 1}p[i]=Player{resources:[v[o]as u16,v[o+1]as u16,v[o+2]as u16],support:v[o+3]as u16,delivered:v[o+4]as u16,forfeited:v[o+5]!=0};m[i]=Move{action:v[41+i*3]as u8,route:v[42+i*3]as u8,delivery:v[43+i*3]as u16};}
  for i in 0..3{let o=59+i*14;if v[o]>1||v[o+1]>2||v[o+2]>5||v[o+3]>5||v[o+4]>5||v[o+5]>4||v[o+7]>255{return 1}ds[i]=Deal{active:v[o]!=0,kind:v[o+1]as u8,maker:v[o+2]as u8,taker:v[o+3]as u8,provider:v[o+4]as u8,action:v[o+5]as u8,delivery:v[o+6]as u16,job:v[o+7]as u8,gives:[[v[o+8]as u16,v[o+9]as u16,v[o+10]as u16],[v[o+11]as u16,v[o+12]as u16,v[o+13]as u16]]};}
  match resolve(Input{count:v[0]as u8,stage:v[1]as u8,hull:v[2]as u8,flags:v[3]as u8,missing:v[4]as u8,players:p,moves:m,deals:ds}){
   Ok(s)=>{let mut out=[0u32;160];out[1]=s.hull as u32;out[2]=s.flags as u32;out[3]=s.route as u32;out[4]=s.threat as u32;out[5]=s.guard as u32;out[6]=s.objective as u32;out[7]=s.progress as u32;out[8]=s.goal as u32;out[9]=s.arrived as u32;out[10]=s.missing as u32;
    for i in 0..6{let o=11+i*6;for j in 0..3{out[o+j]=s.players[i].resources[j]as u32}out[o+3]=s.players[i].support as u32;out[o+4]=s.players[i].delivered as u32;out[o+5]=s.players[i].forfeited as u32;out[47+i]=s.actions[i]as u32;out[53+i]=s.deliveries[i]as u32;}
    for i in 0..3{let w=s.work[i];let o=59+i*9;out[o]=w.active as u32;out[o+1]=w.provider as u32;out[o+2]=w.action as u32;out[o+3]=w.job as u32;for j in 0..3{out[o+4+j]=w.consumed[j]as u32}out[o+7]=w.delivered as u32;out[o+8]=w.executed as u32;}
    for i in 0..6{for j in 0..3{out[86+i*3+j]=s.inputs[i][j]as u32;out[104+i*3+j]=s.outputs[i][j]as u32;}out[122+i]=s.rejected[i]as u32;out[128+i]=score(s.players[i],s.arrived).unwrap_or(0);}
    unsafe{OUTPUT=out};0
   },Err(e)=>match e{Error::Invalid=>1,Error::Insufficient=>2,Error::Overflow=>3,Error::DuplicateActor=>4,Error::Capacity=>5}
  }
 }
}

#[cfg(test)]mod tests{
 use super::*;
 fn input(n:usize)->Input{let mut p=[Player::default();6];for i in 0..n{p[i].resources=INITIAL[i]}Input{count:n as u8,stage:0,hull:12,flags:0,players:p,moves:[Move::default();6],missing:0,deals:[Deal::default();3]}}
 #[test]fn well_has_real_joint_inputs_and_no_double_output(){let mut x=input(4);x.deals[0]=Deal{active:true,kind:2,maker:0,taker:2,provider:2,action:3,gives:[[2,0,0],[0,1,0]],job:255,..Deal::default()};x.moves[0].action=2;x.moves[1].action=2;x.moves[3].action=2;let r=resolve(x).unwrap();assert!(r.objective);assert_eq!(r.players[0].resources,[7,0,0]);assert_eq!(r.players[2].resources,[3,1,0]);assert_eq!(r.players[2].support,2);assert!(r.work[0].executed);}
 #[test]fn repeated_guard_is_not_a_complete_expedition(){for n in 4..=6{let mut x=input(n);for stage in 0..6{x.stage=stage;x.moves=[Move{action:1,..Move::default()};6];let r=resolve(x.clone()).unwrap();assert!(!r.arrived);if r.hull==0{break}x.hull=r.hull;x.flags=r.flags;x.players=r.players;}}}
 #[test]fn accepted_bridge_work_survives_missing_reveal(){let mut x=input(4);x.stage=1;x.players[0].resources[0]=5;x.players[1].resources[1]=1;x.deals[0]=Deal{active:true,kind:1,maker:0,taker:1,provider:1,action:3,job:0,gives:[[1,0,0],[0;3]],..Deal::default()};x.missing=2;let r=resolve(x).unwrap();assert_eq!(r.actions[1],3);assert!(r.work[0].executed);assert_eq!(r.work[0].consumed,[0,1,0]);assert!(r.players[1].forfeited);assert_eq!(r.players[1].resources[1],0);}
 #[test]fn slot_capacity_and_cargo_toll_are_real(){let mut x=input(4);x.stage=2;for p in &mut x.players[..4]{p.resources=[8,2,0]}x.moves=[Move{action:4,..Move::default()};6];let r=resolve(x).unwrap();assert_eq!(r.actions[..4].iter().filter(|&&a|a==4).count(),1);assert_eq!(r.players[..4].iter().map(|p|p.resources[2]).sum::<u16>(),6);}
 #[test]fn funding_reserves_include_unpaid_provider_cost(){let d=Deal{active:true,kind:1,maker:0,taker:2,provider:2,action:3,gives:[[2,0,0],[0;3]],job:255,..Deal::default()};assert_eq!(reserves(0,d).unwrap(),[[2,0,0],[0,1,0]]);}
}
