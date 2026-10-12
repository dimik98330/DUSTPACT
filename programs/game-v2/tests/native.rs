//! Executes the compiled V2 SBF image in an isolated LiteSVM, with generated fixture signers.
use anchor_lang::{AccountDeserialize, AccountSerialize, InstructionData, ToAccountMetas};
use anchor_lang::prelude::Pubkey;
use game_v2::{Auth, GameV2, Terms};
use litesvm::LiteSVM;
use solana_address::Address;
use solana_clock::Clock;
use solana_instruction::{AccountMeta, Instruction};
use solana_keypair::Keypair;
use solana_message::Message;
use solana_signer::Signer;
use solana_transaction::Transaction;

fn pk(k: &Keypair) -> Pubkey { Pubkey::new_from_array(k.pubkey().to_bytes()) }
fn addr(k: Pubkey) -> Address { Address::new_from_array(k.to_bytes()) }

struct Fixture { vm: LiteSVM, keys: Vec<Keypair>, game: Pubkey, max_cu: u64, max_packet: usize }
impl Fixture {
    fn new(n: usize) -> Self {
        let mut vm = LiteSVM::new();
        let binary = std::fs::read("../../target/v2-deploy/game_v2.so").expect("Build separate V2 SBF first");
        vm.add_program(addr(game_v2::ID), &binary).unwrap();
        let keys = (0..8).map(|_| Keypair::new()).collect::<Vec<_>>();
        for k in &keys { vm.airdrop(&k.pubkey(), 10_000_000_000).unwrap(); }
        vm.set_sysvar(&Clock { unix_timestamp: 1_000, ..Clock::default() });
        let nonce = [29;16]; let (game, _) = Pubkey::find_program_address(&[b"match-v2",pk(&keys[0]).as_ref(),&nonce], &game_v2::ID);
        let mut f = Self { vm, keys, game, max_cu: 0, max_packet: 0 };
        let metas = game_v2::accounts::CreateMatch { game, actor: pk(&f.keys[0]), system_program: anchor_lang::system_program::ID }.to_account_metas(None);
        f.send(0, metas, game_v2::instruction::CreateMatch { nonce }.data()).unwrap();
        for i in 1..n { f.act(i, game_v2::instruction::JoinMatch {}.data()).unwrap(); }
        f
    }
    fn state(&self) -> GameV2 { let a = self.vm.get_account(&addr(self.game)).unwrap(); GameV2::try_deserialize(&mut a.data.as_slice()).unwrap() }
    fn bytes(&self) -> Vec<u8> { let mut b=Vec::new(); self.state().try_serialize(&mut b).unwrap(); b }
    fn auth(&self, i: usize) -> Auth { let g=self.state();let p=g.seats[i]; Auth { seat:i as u8, owner:p.owner, nonce:p.action_nonce, epoch:p.epoch, stage:g.stage } }
    fn send(&mut self,i:usize,metas:Vec<anchor_lang::solana_program::instruction::AccountMeta>,data:Vec<u8>)->Result<(),String> {
        let ix=Instruction { program_id:addr(game_v2::ID),accounts:metas.into_iter().map(|m|AccountMeta {pubkey:addr(m.pubkey),is_signer:m.is_signer,is_writable:m.is_writable}).collect(),data };
        self.vm.expire_blockhash();let tx=Transaction::new(&[&self.keys[i]],Message::new(&[ix],Some(&self.keys[i].pubkey())),self.vm.latest_blockhash());
        self.max_packet=self.max_packet.max(bincode::serialize(&tx).unwrap().len());
        self.vm.send_transaction(tx).map(|m|{self.max_cu=self.max_cu.max(m.compute_units_consumed);}).map_err(|e|format!("{e:?}"))
    }
    fn act(&mut self,i:usize,data:Vec<u8>)->Result<(),String>{self.send(i,game_v2::accounts::Act {game:self.game,actor:pk(&self.keys[i])}.to_account_metas(None),data)}
    fn config(&self)->[u8;32]{game_v2::consent::config_hash(&self.state(),&self.game).unwrap()}
    fn terms_hash(&self,m:usize)->[u8;32]{let g=self.state();game_v2::consent::terms_hash(&g,&self.game,&g.offers[m]).unwrap()}
    fn ready(&mut self,i:usize){let g=self.state();self.act(i,game_v2::instruction::SetReady {auth:self.auth(i),roster:g.roster,config_hash:self.config()}.data()).unwrap();}
    fn start(&mut self){for i in 0..self.state().count as usize {self.ready(i)} self.act(0,game_v2::instruction::StartMatch {}.data()).unwrap();}
    fn time(&mut self,t:i64){let mut c=self.vm.get_sysvar::<Clock>();c.unix_timestamp=t;self.vm.set_sysvar(&c);}
    fn advance(&mut self){let g=self.state();self.act(0,game_v2::instruction::AdvancePhase {stage:g.stage,phase:g.phase}.data()).unwrap();}
    fn pact(&mut self,m:usize,t:usize,p:u8,kind:u8,action:u8,gives:[[u16;3];2]){
        let nonce=self.state().seats[m].offer_nonce;
        self.act(m,game_v2::instruction::CreateOffer {auth:self.auth(m),terms:Terms {taker:t as u8,provider:p,kind,action,delivery:0,offer_nonce:nonce,gives,job_slot:255},config_hash:self.config()}.data()).unwrap();
        self.act(t,game_v2::instruction::AcceptOffer {auth:self.auth(t),maker:m as u8,offer_nonce:nonce,terms_hash:self.terms_hash(m)}.data()).unwrap();
    }
    fn stage(&mut self,actions:[u8;6],route:u8,deliveries:[u16;6],missing:u8){
        let n=self.state().count as usize;
        for i in 0..n {self.act(i,game_v2::instruction::SetPlanReady {auth:self.auth(i),ready:true}.data()).unwrap();}
        self.advance(); let g=self.state();
        for i in 0..n {let salt=[i as u8+33;32];let commitment=game_v2::consent::commitment(&g,&self.game,i as u8,actions[i],route,deliveries[i],&salt).unwrap();self.act(i,game_v2::instruction::CommitMove {auth:self.auth(i),commitment}.data()).unwrap();}
        self.advance();
        for i in 0..n {if missing&(1<<i)==0 {self.act(i,game_v2::instruction::RevealMove {auth:self.auth(i),action:actions[i],route,delivery:deliveries[i],salt:[i as u8+33;32]}.data()).unwrap();}}
        if missing!=0 {self.time(self.state().deadline);}
        self.advance();let stage=self.state().stage;
        self.act(0,game_v2::instruction::ResolveStage {stage}.data()).unwrap();
        let bytes=self.bytes(); self.act(1,game_v2::instruction::ResolveStage {stage}.data()).unwrap();assert_eq!(self.bytes(),bytes,"settlement is idempotent");
    }
}

#[test]
fn lobby_requires_reviewed_roster_and_mission_configuration(){
    let mut f=Fixture::new(4);let before=f.bytes();
    assert!(f.act(0,game_v2::instruction::SetReady {auth:f.auth(0),roster:f.state().roster,config_hash:[0;32]}.data()).is_err());assert_eq!(f.bytes(),before);
    f.ready(0);f.act(0,game_v2::instruction::ConfigureMission {npc_mask:14,enabled:true}.data()).unwrap();let g=f.state();assert!(!g.seats[0].ready);assert_eq!(g.eligible_mask,1);assert_ne!(g.mission,Pubkey::default());
    assert!(f.act(1,game_v2::instruction::ConfigureMission {npc_mask:0,enabled:false}.data()).is_err());
    f.act(4,game_v2::instruction::JoinMatch {}.data()).unwrap();let g=f.state();assert_eq!(g.mission,Pubkey::default());assert_eq!(g.npc_mask,0);assert_eq!(g.eligible_mask,0);assert!(g.seats[..5].iter().all(|p|!p.ready));
}

#[test]
fn joint_well_reserves_inputs_executes_after_missing_reveal_and_retains_exact_receipt(){
    let mut f=Fixture::new(4);f.start();f.pact(0,2,2,2,3,[[2,0,0],[0,1,0]]);
    let g=f.state();assert_eq!(g.seats[0].reserved,[2,0,0]);assert_eq!(g.seats[2].reserved,[0,1,0]);assert_eq!(g.seats[2].bound,3);assert!(!g.seats[0].seal&&!g.seats[2].seal);
    let before=f.bytes();assert!(f.act(2,game_v2::instruction::CreateOffer {auth:f.auth(2),terms:Terms {taker:1,provider:1,kind:0,action:0,delivery:0,offer_nonce:g.seats[2].offer_nonce,gives:[[0,1,0],[1,0,0]],job_slot:255},config_hash:f.config()}.data()).is_err());assert_eq!(f.bytes(),before);
    f.stage([2,2,3,2,0,0],0,[0;6],4);let g=f.state();let h=g.history[0];
    assert_eq!(g.stage,1);assert!(h.objective);assert_eq!(h.actions[2],3);assert!(g.seats[2].forfeited);assert_eq!(h.inputs[0],[2,0,0]);assert_eq!(h.inputs[2],[0,1,0]);assert_eq!(h.outputs[0],[7,0,0]);assert_eq!(h.outputs[2],[4,0,0]);assert_eq!(g.seats[2].reserved,[0;3]);
}

#[test]
fn work_order_reserves_provider_cost_and_clears_both_planning_intents(){
    let mut f=Fixture::new(4);f.start();for i in [0,2]{f.act(i,game_v2::instruction::SetPlanReady {auth:f.auth(i),ready:true}.data()).unwrap();}
    f.pact(0,2,2,1,3,[[2,0,0],[0;3]]);let g=f.state();assert_eq!(g.seats[0].reserved,[2,0,0]);assert_eq!(g.seats[2].reserved,[0,1,0]);assert!(!g.seats[0].planning_ready&&!g.seats[2].planning_ready);
    f.stage([2,2,3,2,0,0],0,[0;6],4);let g=f.state();assert_eq!(g.history[0].actions[2],3);assert_eq!(g.history[0].outputs[2],[8,0,0]);assert!(g.seats[2].forfeited);
}

#[test]
fn secret_hash_binds_route_delivery_match_and_stage_and_early_reveal_rolls_back(){
    let mut f=Fixture::new(4);f.start();let commitment=game_v2::consent::commitment(&f.state(),&f.game,0,2,0,0,&[9;32]).unwrap();
    let before=f.bytes();assert!(f.act(0,game_v2::instruction::RevealMove {auth:f.auth(0),action:2,route:0,delivery:0,salt:[9;32]}.data()).is_err());assert_eq!(f.bytes(),before);
    f.time(f.state().deadline);f.advance();f.act(0,game_v2::instruction::CommitMove {auth:f.auth(0),commitment}.data()).unwrap();f.time(f.state().deadline);f.advance();let before=f.bytes();
    assert!(f.act(0,game_v2::instruction::RevealMove {auth:f.auth(0),action:2,route:1,delivery:0,salt:[9;32]}.data()).is_err());assert_eq!(f.bytes(),before);
    f.act(0,game_v2::instruction::RevealMove {auth:f.auth(0),action:2,route:0,delivery:0,salt:[9;32]}.data()).unwrap();
}

#[test]
fn session_cannot_escalate_is_epoch_bound_and_exact_quota_exhausts(){
    let mut f=Fixture::new(4);f.start();let key=pk(&f.keys[6]);f.act(0,game_v2::instruction::AuthorizeSession {auth:f.auth(0),key,expires:2000}.data()).unwrap();
    let before=f.bytes();assert!(f.act(6,game_v2::instruction::AuthorizeSession {auth:f.auth(0),key:pk(&f.keys[7]),expires:2000}.data()).is_err());assert_eq!(f.bytes(),before);
    for i in 0..128 {f.act(6,game_v2::instruction::SetPlanReady {auth:f.auth(0),ready:i%2==0}.data()).unwrap();}
    assert_eq!(f.state().seats[0].quota,0);let before=f.bytes();assert!(f.act(6,game_v2::instruction::SetPlanReady {auth:f.auth(0),ready:true}.data()).is_err());assert_eq!(f.bytes(),before);
    f.act(0,game_v2::instruction::RevokeSession {auth:f.auth(0)}.data()).unwrap();let before=f.bytes();assert!(f.act(6,game_v2::instruction::SetPlanReady {auth:f.auth(0),ready:true}.data()).is_err());assert_eq!(f.bytes(),before);
}

#[test]
fn native_full_campaigns_four_five_six_have_distinct_encounters_and_earned_scores(){
    for n in 4..=6 {
        let mut f=Fixture::new(n);f.start();f.pact(0,2,2,2,3,[[2,0,0],[0,1,0]]);
        let mut a=[2;6];a[2]=3;f.stage(a,0,[0;6],0);
        let mut a=[2;6];a[1]=3;a[2]=3;if n>=5{a[3]=3}f.stage(a,0,[0;6],0);assert_eq!(f.state().flags&2,2);
        let mut a=[2;6];if n==4{a[3]=4}else{a[4]=4;if n==6{a[5]=4}}a[0]=1;f.stage(a,0,[0;6],0);
        let mut a=[1;6];a[2]=4;a[3]=4;f.stage(a,0,[0;6],0);
        let mut a=[2;6];a[2]=3;a[3]=3;f.stage(a,0,[0;6],0);
        let mut delivery=[0;6];for i in 0..n{delivery[i]=f.state().seats[i].resources[2].min(5)}f.stage([2;6],0,delivery,0);
        let g=f.state();assert_eq!(g.phase,5);assert!(g.arrived,"N{n} failed arrival hull{}",g.hull);assert!(g.hull>0);assert!(g.history.iter().all(|h|h.complete));assert!(g.scores[..n].iter().any(|&s|s>0));
        std::fs::create_dir_all("../../tests/fixtures/native/v2/program/replay").unwrap();
        std::fs::write(format!("../../tests/fixtures/native/v2/program/replay/v2-native-n{n}.bin"),f.vm.get_account(&addr(f.game)).unwrap().data).unwrap();
        std::fs::write(format!("../../tests/fixtures/native/v2/program/replay/v2-native-n{n}.json"),format!("{{\"fixture\":\"isolated-generated-signers\",\"program\":\"{}\",\"match\":\"{}\",\"count\":{n},\"hull\":{},\"arrived\":true,\"scores\":{:?},\"maxComputeUnits\":{},\"maxPacketBytes\":{}}}",game_v2::ID,f.game,g.hull,&g.scores[..n],f.max_cu,f.max_packet)).unwrap();
        println!("V2_NATIVE_CAMPAIGN n={n} hull={} bytes={} max_cu={} max_packet={} scores={:?}",g.hull,f.bytes().len(),f.max_cu,f.max_packet,&g.scores[..n]);
    }
}

#[test]
fn repeated_guard_cannot_arrive_and_unfunded_action_retains_rejection(){
    let mut f=Fixture::new(4);f.start();f.stage([3,1,1,1,0,0],0,[0;6],0);let h=f.state().history[0];assert_eq!(h.actions[0],0);assert_eq!(h.rejected[0],2);
    while f.state().phase!=5 {f.stage([1;6],0,[0;6],0);}assert!(!f.state().arrived);assert_eq!(f.state().scores,[0;6]);
}

#[test]
fn stale_intent_wrong_signer_expired_session_and_cross_match_review_roll_back(){
    let mut f=Fixture::new(4);f.start();let old=f.auth(0);
    f.act(0,game_v2::instruction::SetPlanReady {auth:old,ready:true}.data()).unwrap();let before=f.bytes();
    assert!(f.act(0,game_v2::instruction::SetPlanReady {auth:old,ready:false}.data()).is_err());assert_eq!(f.bytes(),before);
    assert!(f.act(1,game_v2::instruction::SetPlanReady {auth:f.auth(0),ready:false}.data()).is_err());assert_eq!(f.bytes(),before);
    f.act(0,game_v2::instruction::AuthorizeSession {auth:f.auth(0),key:pk(&f.keys[6]),expires:1002}.data()).unwrap();f.time(1002);let before=f.bytes();
    assert!(f.act(6,game_v2::instruction::SetPlanReady {auth:f.auth(0),ready:false}.data()).is_err());assert_eq!(f.bytes(),before);
    let first_game=f.game;let first_config=f.config();let nonce=[30;16];let (game,_)=Pubkey::find_program_address(&[b"match-v2",pk(&f.keys[0]).as_ref(),&nonce],&game_v2::ID);f.game=game;
    let metas=game_v2::accounts::CreateMatch {game,actor:pk(&f.keys[0]),system_program:anchor_lang::system_program::ID}.to_account_metas(None);f.send(0,metas,game_v2::instruction::CreateMatch {nonce}.data()).unwrap();for i in 1..4{f.act(i,game_v2::instruction::JoinMatch {}.data()).unwrap();}
    let before=f.bytes();assert!(f.act(0,game_v2::instruction::SetReady {auth:f.auth(0),roster:f.state().roster,config_hash:first_config}.data()).is_err());assert_eq!(f.bytes(),before);
    assert!(f.act(6,game_v2::instruction::SetReady {auth:f.auth(0),roster:f.state().roster,config_hash:f.config()}.data()).is_err());assert_eq!(f.bytes(),before);
    assert_ne!(first_game,game);
}

#[test]
fn anchor_owner_discriminator_pda_mutability_and_system_target_checks_are_native(){
    let mut f=Fixture::new(4);let original=f.vm.get_account(&addr(f.game)).unwrap();
    let mut fake=original.clone();fake.owner=addr(anchor_lang::system_program::ID);f.vm.set_account(addr(f.game),fake).unwrap();
    assert!(f.act(0,game_v2::instruction::SetReady {auth:f.auth(0),roster:f.state().roster,config_hash:f.config()}.data()).is_err());f.vm.set_account(addr(f.game),original.clone()).unwrap();
    let mut fake=original.clone();fake.data[0]^=1;f.vm.set_account(addr(f.game),fake).unwrap();let metas=game_v2::accounts::Act {game:f.game,actor:pk(&f.keys[0])}.to_account_metas(None);
    assert!(f.send(0,metas,game_v2::instruction::StartMatch {}.data()).is_err());f.vm.set_account(addr(f.game),original.clone()).unwrap();
    let fake_game=pk(&f.keys[7]);f.vm.set_account(addr(fake_game),original.clone()).unwrap();let metas=game_v2::accounts::Act {game:fake_game,actor:pk(&f.keys[0])}.to_account_metas(None);
    assert!(f.send(0,metas,game_v2::instruction::StartMatch {}.data()).is_err());
    let mut metas=game_v2::accounts::Act {game:f.game,actor:pk(&f.keys[0])}.to_account_metas(None);metas[0].is_writable=false;let before=f.bytes();assert!(f.send(0,metas,game_v2::instruction::SetReady {auth:f.auth(0),roster:f.state().roster,config_hash:f.config()}.data()).is_err());assert_eq!(f.bytes(),before);
    let nonce=[31;16];let (game,_)=Pubkey::find_program_address(&[b"match-v2",pk(&f.keys[0]).as_ref(),&nonce],&game_v2::ID);let mut metas=game_v2::accounts::CreateMatch {game,actor:pk(&f.keys[0]),system_program:anchor_lang::system_program::ID}.to_account_metas(None);metas[2].pubkey=pk(&f.keys[6]);assert!(f.send(0,metas,game_v2::instruction::CreateMatch {nonce}.data()).is_err());assert!(f.vm.get_account(&addr(game)).is_none());
}

#[test]
fn native_bypass_path_can_arrive_via_risk_city_with_one_cache_slot(){
    for n in 4..=6 {
        let mut f=Fixture::new(n);f.start();f.pact(0,2,2,2,3,[[2,0,0],[0,1,0]]);
        let mut a=[2;6];a[2]=3;f.stage(a,0,[0;6],0);
        f.stage([2;6],1,[0;6],0);assert_eq!(f.state().flags&2,0);
        let mut a=[2;6];a[2]=4;f.stage(a,0,[0;6],0);assert_eq!(f.state().history[2].actions[..n].iter().filter(|&&x|x==4).count(),1);
        f.stage([1;6],0,[0;6],0);
        let mut a=[2;6];a[1]=3;a[3]=3;f.stage(a,0,[0;6],0);
        let mut delivery=[0;6];delivery[2]=((n+1)/2)as u16;f.stage([1;6],1,delivery,0);
        let g=f.state();assert!(g.arrived);assert_eq!(g.hull,12);assert_eq!(g.history[1].route,1);assert_eq!(g.history[5].route,1);assert_eq!(g.seats[2].delivered,((n+1)/2)as u16);
        println!("V2_NATIVE_BYPASS n={n} hull={} delivered={} max_cu={}",g.hull,g.seats[2].delivered,f.max_cu);
    }
}

#[test]
fn open_offer_expiry_releases_exact_reservation_and_missing_commit_keeps_bound_work(){
    let mut f=Fixture::new(4);f.start();
    f.act(1,game_v2::instruction::CreateOffer {auth:f.auth(1),terms:Terms {taker:3,provider:3,kind:0,action:0,delivery:0,offer_nonce:0,gives:[[0,1,0],[1,0,0]],job_slot:255},config_hash:f.config()}.data()).unwrap();
    f.pact(0,2,2,1,3,[[2,0,0],[0;3]]);assert_eq!(f.state().seats[1].reserved,[0,1,0]);
    f.time(f.state().deadline);f.advance();assert_eq!(f.state().offers[1].status,4);assert_eq!(f.state().seats[1].reserved,[0;3]);assert!(f.state().seats[1].seal);
    f.time(f.state().deadline);f.advance();f.advance();f.act(7,game_v2::instruction::ResolveStage {stage:0}.data()).unwrap();let g=f.state();
    assert_eq!(g.history[0].missing,15);assert!(g.seats[..4].iter().all(|p|p.forfeited));assert_eq!(g.history[0].actions[2],3);assert_eq!(g.history[0].outputs[2],[8,0,0]);
}

#[test]
fn barter_settles_once_and_work_order_incoming_price_funds_missing_recipe_input(){
    let mut f=Fixture::new(4);f.start();f.pact(0,2,2,0,0,[[2,0,0],[0,1,0]]);let g=f.state();
    assert_eq!(g.seats[0].resources,[1,1,0]);assert_eq!(g.seats[2].resources,[2,1,0]);assert_eq!(g.seats[0].reserved,[0;3]);assert_eq!(g.seats[2].reserved,[0;3]);
    f.stage([2;6],0,[0;6],0);let g=f.state();assert_eq!(g.seats[0].resources,[3,1,0]);assert_eq!(g.seats[2].resources,[4,1,0]);assert_eq!(g.history[0].deals[0].kind,0);
    let mut f=Fixture::new(4);f.start();f.pact(2,0,0,1,3,[[0,1,0],[0;3]]);let g=f.state();
    assert_eq!(g.seats[0].resources[1],0);assert_eq!(g.seats[0].reserved,[2,0,0]);assert_eq!(g.seats[2].reserved,[0,1,0]);
    f.stage([3,2,2,2,0,0],0,[0;6],1);let g=f.state();assert_eq!(g.history[0].actions[0],3);assert_eq!(g.history[0].inputs[0],[2,1,0]);assert_eq!(g.history[0].outputs[0],[8,0,0]);assert!(g.seats[0].forfeited);assert_eq!(g.seats[0].resources,[8,0,0]);
}
