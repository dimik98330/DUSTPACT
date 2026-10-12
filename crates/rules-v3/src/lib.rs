//! Protocol3: shared SBF/Wasm rules. Earlier encounters delegate to unchanged base rules.
pub use dustpact_rules_v2::{Player,Move,Deal,Input,ResultState,WorkRecord,Error,MAX,INITIAL,barter,score,recipe};
use dustpact_rules_v2 as base;
pub const RULES_HASH:[u8;32]=[11,126,26,237,166,169,99,71,61,202,245,215,0,99,58,208,44,78,211,219,168,205,25,110,12,167,215,107,187,116,98,163];
pub const CONTENT_HASH:[u8;32]=RULES_HASH;
pub const DELIVER:u8=5;pub const MARKET:u8=6;pub const PLEDGE:u8=3;

#[derive(Clone,Debug,Default,PartialEq,Eq)]
pub struct CityReceipt {
 pub escort_goal:u8,pub escort_progress:u8,pub pledged:[u16;6],pub voluntary:[u16;6],
 pub paid:[[u16;3];6],pub received:[[u16;3];6],
}
#[derive(Clone,Debug,PartialEq,Eq)]
pub struct ResultV3 {pub state:ResultState,pub city:CityReceipt}
pub fn action_cost(stage:u8,action:u8)->Result<[u16;3],Error>{
 if stage==5 {if [0,1,DELIVER,MARKET].contains(&action){Ok([0;3])}else{Err(Error::Invalid)}}else{base::action_cost(stage,action)}
}
pub fn reserves(stage:u8,d:Deal)->Result<[[u16;3];2],Error>{
 if d.kind==0&&d.action!=0{return Err(Error::Invalid)}
 if d.kind!=PLEDGE {
  if stage==5&&d.kind==1&&d.action!=1{return Err(Error::Invalid)}
  return base::reserves(stage,d)
 }
 if !d.active||stage!=5||d.maker>=6||d.taker>=6||d.maker==d.taker||![d.maker,d.taker].contains(&d.provider)||d.action!=DELIVER||d.job!=255||!(1..=5).contains(&d.delivery){return Err(Error::Invalid)}
 let side=usize::from(d.provider!=d.maker);
 if d.gives[side]!=[0;3]||d.gives[1-side].iter().any(|&x|x>5)||d.gives[1-side]==[0;3]{return Err(Error::Invalid)}
 let mut r=d.gives;r[side]=[0,0,d.delivery];Ok(r)
}
pub fn valid_city_move(action:u8,extra:u16,pledged:u16)->bool {
 extra<=5&&pledged<=5&&if action==DELIVER {extra+pledged<=5&&(extra+pledged)>0}else{[0,1,MARKET].contains(&action)&&extra==0&&pledged==0}
}
fn consume(p:&mut Player,c:[u16;3])->Result<(),Error>{for(j,v)in c.into_iter().enumerate(){p.resources[j]=p.resources[j].checked_sub(v).ok_or(Error::Insufficient)?;}Ok(())}
fn credit(p:&mut Player,c:[u16;3])->Result<(),Error>{for(j,v)in c.into_iter().enumerate(){p.resources[j]=p.resources[j].checked_add(v).filter(|&x|x<=200).ok_or(Error::Overflow)?;}Ok(())}
pub fn resolve(input:Input)->Result<ResultV3,Error>{
 if input.stage!=5{return Ok(ResultV3{state:base::resolve(input)?,city:CityReceipt::default()})}
 let n=input.count as usize;
 if !(4..=6).contains(&n)||input.hull>12||input.missing&!((1u8<<n)-1)!=0||input.players[..n].iter().any(|p|p.resources.iter().any(|&x|x>200)||p.support>64||p.delivered>30)||input.moves[..n].iter().any(|m|m.route>1||m.delivery>5||![0,1,DELIVER,MARKET].contains(&m.action)){return Err(Error::Invalid)}
 let mut players=input.players;let mut moves=input.moves;let mut city=CityReceipt::default();
 let mut work=[WorkRecord::default();3];let mut reserved=[[0u16;3];6];let mut parties=0u8;
 for(i,p)in players.iter_mut().enumerate().take(n){if input.missing&(1<<i)!=0{p.forfeited=true;moves[i]=Move::default();}}
 // Validate every reserve against pre-payment resources. Incoming prices never fund delivery.
 for(index,d)in input.deals.iter().enumerate().filter(|(_,d)|d.active){
  if d.maker as usize>=n||d.taker as usize>=n{return Err(Error::Invalid)}
  let r=reserves(5,*d)?;let bits=(1<<d.maker)|(1<<d.taker);if parties&bits!=0{return Err(Error::DuplicateActor)}parties|=bits;
  if d.kind==0{continue}
  for(side,seat)in [d.maker as usize,d.taker as usize].into_iter().enumerate(){for j in 0..3{if r[side][j]>input.players[seat].resources[j]{return Err(Error::Insufficient)}reserved[seat][j]=r[side][j];}}
  let provider=d.provider as usize;moves[provider].action=d.action;
  if d.kind==PLEDGE{city.pledged[provider]=d.delivery;}
  work[index]=WorkRecord{active:true,provider:d.provider,action:d.action,job:d.job,consumed:if d.kind==PLEDGE{[0,0,d.delivery]}else{[0;3]},delivered:if d.kind==PLEDGE{d.delivery}else{0},executed:true};
 }
 for i in 0..n{
  if !valid_city_move(moves[i].action,moves[i].delivery,city.pledged[i]){return Err(Error::Invalid)}
  if moves[i].delivery>input.players[i].resources[2].checked_sub(reserved[i][2]).ok_or(Error::Insufficient)?{return Err(Error::Insufficient)}
 }
 // All deferred prices settle once, independently of personal forfeiture or overall arrival.
 for d in input.deals.iter().filter(|d|d.active&&d.kind!=0){
  for(side,seat)in [d.maker as usize,d.taker as usize].into_iter().enumerate(){consume(&mut players[seat],d.gives[side])?;city.paid[seat]=d.gives[side];}
  for(side,seat)in [d.maker as usize,d.taker as usize].into_iter().enumerate(){credit(&mut players[seat],d.gives[1-side])?;city.received[seat]=d.gives[1-side];}
 }
 let route=u8::from(moves[..n].iter().filter(|m|m.route==1).count()>n/2);
 let mut actions=[0u8;6];let mut deliveries=[0u16;6];let mut inputs=[[0u16;3];6];let mut outputs=[[0u16;3];6];let mut rejected=[0u8;6];let mut guards=0u8;
 for i in 0..n{
  let action=moves[i].action;
  match action {
   0=>{},
   1=>{guards+=1;players[i].support+=1;},
   DELIVER=>{let quantity=city.pledged[i]+moves[i].delivery;consume(&mut players[i],[0,0,quantity])?;players[i].delivered=players[i].delivered.checked_add(quantity).ok_or(Error::Overflow)?;players[i].support+=1;city.voluntary[i]=moves[i].delivery;deliveries[i]=quantity;inputs[i][2]=quantity;},
   MARKET=>{if players[i].resources[2]==200{rejected[i]=4;continue}players[i].resources[2]+=1;outputs[i][2]=1;},
   _=>return Err(Error::Invalid),
  }
  actions[i]=action;
 }
 // Only Guard actors count as escorts; spare hull cannot replace the route requirement.
 city.escort_goal=if route==1{((n+1)/2)as u8}else{0};city.escort_progress=guards;
 let threat=if route==1{n as u8+4}else{0};let guard=guards*2;let mut thirst=0u8;
 for p in players.iter_mut().take(n){if p.resources[0]>0{p.resources[0]-=1}else{thirst+=1}if p.support>64||p.delivered>30{return Err(Error::Overflow)}}
 let hull=input.hull.saturating_sub(threat.saturating_sub(guard).saturating_add(thirst));
 let goal=if route==0{n as u16}else{((n+1)/2)as u16};let progress=deliveries[..n].iter().sum();let objective=progress>=goal&&guards>=city.escort_goal;
 Ok(ResultV3{state:ResultState{players,hull,flags:input.flags,route,threat,guard,actions,deliveries,missing:input.missing,objective,progress,goal,arrived:hull>0&&objective,work,inputs,outputs,rejected},city})
}

#[cfg(target_arch="wasm32")]
mod wasm;

#[cfg(test)]
mod tests;
