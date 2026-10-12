use super::*;
fn city(n:u8)->Input {
 let mut p=[Player::default();6];for x in &mut p[..n as usize]{x.resources=[2,0,3]}
 Input{count:n,stage:5,hull:12,flags:7,players:p,moves:[Move::default();6],missing:0,deals:[Deal::default();3]}
}
fn pledge(quantity:u16,price:[u16;3])->Deal {Deal{active:true,kind:PLEDGE,maker:1,taker:0,provider:0,action:DELIVER,delivery:quantity,job:255,gives:[price,[0;3]]}}
#[test]fn pledge_reserves_owned_cargo_and_not_future_price(){
 assert_eq!(reserves(5,pledge(2,[0,0,1])).unwrap(),[[0,0,1],[0,0,2]]);
 let mut x=city(4);x.players[0].resources[2]=2;x.deals[0]=pledge(2,[0,0,1]);x.moves[0]=Move{action:DELIVER,delivery:1,..Move::default()};
 assert_eq!(resolve(x.clone()),Err(Error::Insufficient));x.moves[0].delivery=0;
 let r=resolve(x).unwrap();assert_eq!(r.state.players[0].resources[2],1);assert_eq!(r.city.paid[1],[0,0,1]);assert_eq!(r.city.received[0],[0,0,1]);
}
#[test]fn missing_preserves_pledge_price_and_drops_only_extra(){
 let mut x=city(4);x.deals[0]=pledge(2,[1,0,0]);x.moves[0]=Move{action:DELIVER,delivery:1,..Move::default()};x.moves[1]=Move{action:DELIVER,delivery:2,..Move::default()};x.missing=1;
 let r=resolve(x.clone()).unwrap();assert!(r.state.arrived);assert_eq!(r.city.pledged[0],2);assert_eq!(r.city.voluntary[0],0);assert_eq!(r.state.players[0].support,1);assert_eq!(r.state.work[0].delivered,2);assert!(r.state.work[0].executed);assert_eq!(score(r.state.players[0],true),None);
 x.deals[0].delivery=1;let r=resolve(x).unwrap();assert!(!r.state.arrived);assert_eq!(r.state.progress,3);assert_eq!(r.state.work[0].delivered,1);
}
#[test]fn extra_is_additive_and_support_is_once(){let mut x=city(4);x.deals[0]=pledge(2,[1,0,0]);x.moves[0]=Move{action:DELIVER,delivery:1,..Move::default()};x.moves[1]=Move{action:DELIVER,delivery:1,..Move::default()};let r=resolve(x).unwrap();assert_eq!(r.state.deliveries[0],3);assert_eq!(r.city.pledged[0],2);assert_eq!(r.city.voluntary[0],1);assert_eq!(r.state.players[0].support,1);assert_eq!(r.state.inputs[0][2],3);}
#[test]fn separate_actions_and_quantity_caps(){
 for action in [0,1,MARKET]{let mut x=city(4);x.moves[0]=Move{action,delivery:1,route:0};assert_eq!(resolve(x),Err(Error::Invalid));}
 assert!(!valid_city_move(DELIVER,0,0));assert!(!valid_city_move(DELIVER,4,2));assert!(!valid_city_move(2,0,0));
 let mut x=city(4);x.moves[0]=Move{action:MARKET,..Move::default()};let r=resolve(x).unwrap();assert_eq!(r.state.players[0].resources[2],4);assert_eq!(r.state.players[0].support,0);assert_eq!(r.state.deliveries[0],0);
}
#[test]fn emergency_requires_distinct_escorts_even_at_full_hull(){
 for n in 4..=6{let mut x=city(n);x.moves[..n as usize].fill(Move{route:1,..Move::default()});x.moves[0]=Move{action:DELIVER,route:1,delivery:(n as u16+1)/2};let r=resolve(x.clone()).unwrap();assert!(r.state.hull>0);assert!(!r.state.arrived);assert_eq!(r.city.escort_goal,(n+1)/2);
  for i in 1..=(n as usize+1)/2{x.moves[i].action=1;}let r=resolve(x).unwrap();assert!(r.state.arrived);assert_eq!(r.city.escort_progress,(n+1)/2);
 }
}
#[test]fn escrow_cannot_be_funded_by_market_or_nonowned_resources(){let mut x=city(4);x.players[0].resources[2]=0;x.deals[0]=pledge(1,[1,0,0]);x.moves[0].action=MARKET;assert_eq!(resolve(x),Err(Error::Insufficient));}
#[test]fn wrong_stage_provider_price_and_seal_collision_rejected(){
 assert_eq!(reserves(4,pledge(2,[1,0,0])),Err(Error::Invalid));assert_eq!(reserves(5,pledge(2,[0;3])),Err(Error::Invalid));
 let mut x=city(4);x.deals[0]=pledge(1,[1,0,0]);x.deals[1]=pledge(1,[0,1,0]);assert_eq!(resolve(x),Err(Error::DuplicateActor));
 let mut d=pledge(2,[1,0,0]);d.gives[1]=[0,0,1];assert_eq!(reserves(5,d),Err(Error::Invalid));
}
#[test]fn price_does_not_create_cargo_and_headroom_is_strict(){let mut x=city(4);x.players[0].resources[2]=200;x.deals[0]=pledge(5,[0,0,1]);assert_eq!(resolve(x),Err(Error::Overflow));}
#[test]fn legacy_encounters_keep_exact_base_result(){let mut x=city(4);x.stage=0;x.players[0].resources=[3,1,0];x.moves[0].action=3;assert_eq!(resolve(x.clone()).unwrap().state,base::resolve(x).unwrap());}
#[test]fn full_campaigns_n456_have_both_city_routes(){
 for n in 4..=6{for city_route in [0,1]{let mut x=Input{count:n,stage:0,hull:12,flags:0,players:[Player::default();6],moves:[Move::default();6],missing:0,deals:[Deal::default();3]};for i in 0..n as usize{x.players[i].resources=INITIAL[i]}
  for stage in 0..5{x.stage=stage;x.moves=[Move{action:2,..Move::default()};6];x.deals=[Deal::default();3];
   if stage==0{x.deals[0]=Deal{active:true,kind:2,maker:0,taker:2,provider:2,action:3,delivery:0,job:255,gives:[[2,0,0],[0,1,0]]};}
   if stage==1{for i in 1..=(n as usize+1)/2{x.moves[i].action=3;}}
   if stage==2{let e=if n==4{3}else{4};x.moves[0].action=if n==4{2}else{1};x.moves[1].action=1;x.moves[e].action=4;if n==6{x.moves[5].action=4;}x.deals[0]=Deal{active:true,kind:2,maker:0,taker:e as u8,provider:e as u8,action:4,delivery:0,job:255,gives:[[1,0,0],[0,1,0]]};}
   if stage==3{x.moves=[Move{action:1,..Move::default()};6];x.moves[2].action=4;x.moves[3].action=4;}
   if stage==4{x.moves[2].action=3;x.moves[3].action=3;}
   let r=resolve(x.clone()).unwrap().state;assert!(r.hull>0);x.hull=r.hull;x.players=r.players;x.flags=r.flags;
  }
  x.stage=5;x.deals=[Deal::default();3];x.moves=[Move{action:MARKET,route:city_route,delivery:0};6];let goal=if city_route==0{n as u16}else{(n as u16+1)/2};let mut need=goal;
  for i in 0..n as usize{let q=x.players[i].resources[2].min(5).min(need);if q>0{x.moves[i].action=DELIVER;x.moves[i].delivery=q;need-=q;}}
  assert_eq!(need,0);if city_route==1{let mut guards=(n+1)/2;for i in 0..n as usize{if guards>0&&x.moves[i].action!=DELIVER{x.moves[i].action=1;guards-=1;}}assert_eq!(guards,0);}
  let r=resolve(x).unwrap();assert!(r.state.arrived,"n={n},route={city_route}");assert!(r.state.hull>0);
 }}
}
