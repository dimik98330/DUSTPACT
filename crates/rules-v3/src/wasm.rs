use super::*;
 static mut INPUT:[u32;128]=[0;128];static mut OUTPUT:[u32;224]=[0;224];
 #[no_mangle]pub extern "C" fn input_ptr()->*mut u32{core::ptr::addr_of_mut!(INPUT).cast()}
 #[no_mangle]pub extern "C" fn output_ptr()->*mut u32{core::ptr::addr_of_mut!(OUTPUT).cast()}
 #[no_mangle]pub extern "C" fn barter_only()->u32{
  let v=unsafe{INPUT};if v.iter().any(|&x|x>u16::MAX as u32)||v[0]>6||v[61]>5||v[62]>5{return 1}
  let mut p=[Player::default();6];for i in 0..6{let o=5+i*6;p[i]=Player{resources:[v[o]as u16,v[o+1]as u16,v[o+2]as u16],support:v[o+3]as u16,delivered:v[o+4]as u16,forfeited:v[o+5]!=0};}
  match barter(p,v[0]as u8,v[61]as u8,v[62]as u8,[[v[67]as u16,v[68]as u16,v[69]as u16],[v[70]as u16,v[71]as u16,v[72]as u16]]){
   Ok(p)=>{let mut out=[0u32;224];for i in 0..6{let o=11+i*6;for j in 0..3{out[o+j]=p[i].resources[j]as u32}out[o+3]=p[i].support as u32;out[o+4]=p[i].delivered as u32;out[o+5]=p[i].forfeited as u32;}unsafe{OUTPUT=out};0},Err(_)=>2
  }
 }
 #[no_mangle]pub extern "C" fn reserves_only()->u32{
  let v=unsafe{INPUT};if v.iter().any(|&x|x>u16::MAX as u32)||v[1]>5||v[60]>3||v[61]>5||v[62]>5||v[63]>5||v[64]>6||v[66]>255{return 1}
  let d=Deal{active:true,kind:v[60]as u8,maker:v[61]as u8,taker:v[62]as u8,provider:v[63]as u8,action:v[64]as u8,delivery:v[65]as u16,job:v[66]as u8,gives:[[v[67]as u16,v[68]as u16,v[69]as u16],[v[70]as u16,v[71]as u16,v[72]as u16]]};
  match reserves(v[1]as u8,d){Ok(r)=>{let mut out=[0u32;224];for side in 0..2{for j in 0..3{out[side*3+j]=r[side][j]as u32}}unsafe{OUTPUT=out};0},Err(_)=>2}
 }
 #[no_mangle]pub extern "C" fn settle()->u32{
  let v=unsafe{INPUT};if v.iter().any(|&x|x>u16::MAX as u32){return 1}
  let mut p=[Player::default();6];let mut m=[Move::default();6];let mut ds=[Deal::default();3];
  if v[0]>6||v[1]>5||v[2]>12||v[3]>255||v[4]>63{return 1}
  for i in 0..6{let o=5+i*6;if v[o+5]>1||v[41+i*3]>6||v[42+i*3]>1{return 1}p[i]=Player{resources:[v[o]as u16,v[o+1]as u16,v[o+2]as u16],support:v[o+3]as u16,delivered:v[o+4]as u16,forfeited:v[o+5]!=0};m[i]=Move{action:v[41+i*3]as u8,route:v[42+i*3]as u8,delivery:v[43+i*3]as u16};}
  for i in 0..3{let o=59+i*14;if v[o]>1||v[o+1]>3||v[o+2]>5||v[o+3]>5||v[o+4]>5||v[o+5]>6||v[o+7]>255{return 1}ds[i]=Deal{active:v[o]!=0,kind:v[o+1]as u8,maker:v[o+2]as u8,taker:v[o+3]as u8,provider:v[o+4]as u8,action:v[o+5]as u8,delivery:v[o+6]as u16,job:v[o+7]as u8,gives:[[v[o+8]as u16,v[o+9]as u16,v[o+10]as u16],[v[o+11]as u16,v[o+12]as u16,v[o+13]as u16]]};}
  match resolve(Input{count:v[0]as u8,stage:v[1]as u8,hull:v[2]as u8,flags:v[3]as u8,missing:v[4]as u8,players:p,moves:m,deals:ds}){
   Ok(result)=>{let s=result.state;let city=result.city;let mut out=[0u32;224];out[1]=s.hull as u32;out[2]=s.flags as u32;out[3]=s.route as u32;out[4]=s.threat as u32;out[5]=s.guard as u32;out[6]=s.objective as u32;out[7]=s.progress as u32;out[8]=s.goal as u32;out[9]=s.arrived as u32;out[10]=s.missing as u32;
    for i in 0..6{let o=11+i*6;for j in 0..3{out[o+j]=s.players[i].resources[j]as u32}out[o+3]=s.players[i].support as u32;out[o+4]=s.players[i].delivered as u32;out[o+5]=s.players[i].forfeited as u32;out[47+i]=s.actions[i]as u32;out[53+i]=s.deliveries[i]as u32;}
    for i in 0..3{let w=s.work[i];let o=59+i*9;out[o]=w.active as u32;out[o+1]=w.provider as u32;out[o+2]=w.action as u32;out[o+3]=w.job as u32;for j in 0..3{out[o+4+j]=w.consumed[j]as u32}out[o+7]=w.delivered as u32;out[o+8]=w.executed as u32;}
    for i in 0..6{for j in 0..3{out[86+i*3+j]=s.inputs[i][j]as u32;out[104+i*3+j]=s.outputs[i][j]as u32;}out[122+i]=s.rejected[i]as u32;out[128+i]=score(s.players[i],s.arrived).unwrap_or(0);}
    out[160]=city.escort_goal as u32;out[161]=city.escort_progress as u32;for i in 0..6{out[162+i]=city.pledged[i]as u32;out[168+i]=city.voluntary[i]as u32;for j in 0..3{out[174+i*3+j]=city.paid[i][j]as u32;out[192+i*3+j]=city.received[i][j]as u32;}}unsafe{OUTPUT=out};0
   },Err(e)=>match e{Error::Invalid=>1,Error::Insufficient=>2,Error::Overflow=>3,Error::DuplicateActor=>4,Error::Capacity=>5}
  }
 }
