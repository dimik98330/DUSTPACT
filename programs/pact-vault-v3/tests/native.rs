//! Executes the compiled V2 SBF image in an isolated LiteSVM, with generated fixture signers.
use solana_account::Account;
use pact_vault_v3::{Mission, MINT, TOKEN, associated};
use anchor_lang::{AccountDeserialize, AccountSerialize, InstructionData, ToAccountMetas};
use anchor_lang::prelude::Pubkey;
use game_v3::{Auth, GameV3, Terms};
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

#[test]
fn sponsored_unchecked_rejects_owner_discriminator_size_actor_and_mutability(){
 let mut f=Fixture::new(4);f.vault();f.fund();f.start();f.pact(0,2,2,2,3,[[2,0,0],[0,1,0]]);f.stage([2,2,3,2,0,0],0,[0;6],0);f.paid_offer(0,2,2,0).unwrap();
 let g=f.state();let auth=f.auth(2);let data=game_v3::instruction::AcceptSponsored{auth,maker:0,offer_nonce:g.offers[0].nonce,terms_hash:f.terms_hash(0)}.data();
 let metas=game_v3::accounts::Sponsored{game:f.game,actor:pk(&f.keys[2]),mission:g.mission,vault_program:pact_vault_v3::ID}.to_account_metas(None);
 let original=f.vm.get_account(&addr(f.game)).unwrap();let mission=f.vm.get_account(&addr(g.mission)).unwrap();
 for case in 0..3{let mut fake=original.clone();match case{0=>fake.owner=addr("7Fs272UohH4jF53fwsdVk3E9t4KuDptdn6DcFyxbuARd".parse().unwrap()),1=>fake.data[0]^=1,_=>fake.data.push(0)};
  f.vm.set_account(addr(f.game),fake.clone()).unwrap();assert!(f.send(2,metas.clone(),data.clone()).is_err());assert_eq!(f.vm.get_account(&addr(f.game)).unwrap().data,fake.data);assert_eq!(f.vm.get_account(&addr(g.mission)).unwrap().data,mission.data);f.vm.set_account(addr(f.game),original.clone()).unwrap();
 }
 let before=f.watched();let mut wrong=metas.clone();wrong[1].pubkey=pk(&f.keys[1]);assert!(f.send(1,wrong,data.clone()).is_err());assert_eq!(before,f.watched());
 let mut readonly=metas.clone();readonly[0].is_writable=false;assert!(f.send(2,readonly,data.clone()).is_err());assert_eq!(before,f.watched());
 let fake_key=pk(&f.keys[7]);f.vm.set_account(addr(fake_key),original).unwrap();let mut wrong_pda=metas;wrong_pda[0].pubkey=fake_key;assert!(f.send(2,wrong_pda,data).is_err());assert_eq!(before,f.watched());
}

struct Fixture { vm: LiteSVM, keys: Vec<Keypair>, game: Pubkey, max_cu: u64, max_packet: usize }
impl Fixture {
    fn new(n: usize) -> Self {
        let mut vm = LiteSVM::new();
        let binary = std::fs::read("../../target/v3-deploy/game_v3.so").expect("Build separate V2 SBF first");
        vm.add_program(addr(game_v3::ID), &binary).unwrap();
        let keys = (0..8).map(|_| Keypair::new()).collect::<Vec<_>>();
        for k in &keys { vm.airdrop(&k.pubkey(), 10_000_000_000).unwrap(); }
        vm.set_sysvar(&Clock { unix_timestamp: 1_000, ..Clock::default() });
        let nonce = [29;16]; let (game, _) = Pubkey::find_program_address(&[b"match-v3",pk(&keys[0]).as_ref(),&nonce], &game_v3::ID);
        let mut f = Self { vm, keys, game, max_cu: 0, max_packet: 0 };
        let metas = game_v3::accounts::CreateMatch { game, actor: pk(&f.keys[0]), system_program: anchor_lang::system_program::ID }.to_account_metas(None);
        f.send(0, metas, game_v3::instruction::CreateMatch { nonce }.data()).unwrap();
        for i in 1..n { f.act(i, game_v3::instruction::JoinMatch {}.data()).unwrap(); }
        f
    }
    fn state(&self) -> GameV3 { let a = self.vm.get_account(&addr(self.game)).unwrap(); GameV3::try_deserialize(&mut a.data.as_slice()).unwrap() }
    fn bytes(&self) -> Vec<u8> { let mut b=Vec::new(); self.state().try_serialize(&mut b).unwrap(); b }
    fn auth(&self, i: usize) -> Auth { let g=self.state();let p=g.seats[i]; Auth { seat:i as u8, owner:p.owner, nonce:p.action_nonce, epoch:p.epoch, stage:g.stage } }
    fn send(&mut self,i:usize,metas:Vec<anchor_lang::solana_program::instruction::AccountMeta>,data:Vec<u8>)->Result<(),String> {
        let ix=Instruction { program_id:addr(game_v3::ID),accounts:metas.into_iter().map(|m|AccountMeta {pubkey:addr(m.pubkey),is_signer:m.is_signer,is_writable:m.is_writable}).collect(),data };
        self.vm.expire_blockhash();let tx=Transaction::new(&[&self.keys[i]],Message::new(&[ix],Some(&self.keys[i].pubkey())),self.vm.latest_blockhash());
        self.max_packet=self.max_packet.max(bincode::serialize(&tx).unwrap().len());
        self.vm.send_transaction(tx).map(|m|{self.max_cu=self.max_cu.max(m.compute_units_consumed);}).map_err(|e|format!("{e:?}"))
    }
    fn act(&mut self,i:usize,data:Vec<u8>)->Result<(),String>{self.send(i,game_v3::accounts::Act {game:self.game,actor:pk(&self.keys[i])}.to_account_metas(None),data)}
    fn config(&self)->[u8;32]{game_v3::consent::config_hash(&self.state(),&self.game).unwrap()}
    fn terms_hash(&self,m:usize)->[u8;32]{let g=self.state();game_v3::consent::terms_hash(&g,&self.game,&g.offers[m]).unwrap()}
    fn ready(&mut self,i:usize){let g=self.state();self.act(i,game_v3::instruction::SetReady {auth:self.auth(i),roster:g.roster,config_hash:self.config()}.data()).unwrap();}
    fn start(&mut self){for i in 0..self.state().count as usize {self.ready(i)} self.act(0,game_v3::instruction::StartMatch {}.data()).unwrap();}
    fn time(&mut self,t:i64){let mut c=self.vm.get_sysvar::<Clock>();c.unix_timestamp=t;self.vm.set_sysvar(&c);}
    fn advance(&mut self){let g=self.state();self.act(0,game_v3::instruction::AdvancePhase {stage:g.stage,phase:g.phase}.data()).unwrap();}
    fn pact(&mut self,m:usize,t:usize,p:u8,kind:u8,action:u8,gives:[[u16;3];2]){
        let nonce=self.state().seats[m].offer_nonce;
        self.act(m,game_v3::instruction::CreateOffer {auth:self.auth(m),terms:Terms {taker:t as u8,provider:p,kind,action,delivery:0,offer_nonce:nonce,gives,job_slot:255},config_hash:self.config()}.data()).unwrap();
        self.act(t,game_v3::instruction::AcceptOffer {auth:self.auth(t),maker:m as u8,offer_nonce:nonce,terms_hash:self.terms_hash(m)}.data()).unwrap();
    }
    fn stage(&mut self,actions:[u8;6],route:u8,deliveries:[u16;6],missing:u8){
        let n=self.state().count as usize;
        for i in 0..n {self.act(i,game_v3::instruction::SetPlanReady {auth:self.auth(i),ready:true}.data()).unwrap();}
        self.advance(); let g=self.state();
        for i in 0..n {let salt=[i as u8+33;32];let commitment=game_v3::consent::commitment(&g,&self.game,i as u8,actions[i],route,deliveries[i],&salt).unwrap();self.act(i,game_v3::instruction::CommitMove {auth:self.auth(i),commitment}.data()).unwrap();}
        self.advance();
        for i in 0..n {if missing&(1<<i)==0 {self.act(i,game_v3::instruction::RevealMove {auth:self.auth(i),action:actions[i],route,delivery:deliveries[i],salt:[i as u8+33;32]}.data()).unwrap();}}
        if missing!=0 {self.time(self.state().deadline);}
        self.advance();let stage=self.state().stage;
        self.act(0,game_v3::instruction::ResolveStage {stage}.data()).unwrap();
        let bytes=self.bytes(); self.act(1,game_v3::instruction::ResolveStage {stage}.data()).unwrap();assert_eq!(self.bytes(),bytes,"settlement is idempotent");
    }
}

impl Fixture {
 fn vault(&mut self) {
  self.vm.add_program(addr(pact_vault_v3::ID),&std::fs::read("../../target/v3-deploy/pact_vault_v3.so").expect("Build PactVault SBF first")).unwrap();
  self.vm=self.vm.clone().with_default_programs();
  self.act(0,game_v3::instruction::ConfigureMission{npc_mask:0,enabled:true}.data()).unwrap();
  let mission=self.state().mission;
  let mut mint=vec![0;82];mint[36..44].copy_from_slice(&100_000_000u64.to_le_bytes());mint[44]=6;mint[45]=1;
  self.vm.set_account(addr(MINT),Account{lamports:10_000_000,data:mint,owner:addr(TOKEN),executable:false,rent_epoch:0}).unwrap();
  for (owner,balance) in [(pk(&self.keys[0]),100_000_000u64),(mission,0),(pk(&self.keys[1]),0),(pk(&self.keys[2]),0),(pk(&self.keys[3]),0)] {
   let mut data=vec![0;165];data[..32].copy_from_slice(MINT.as_ref());data[32..64].copy_from_slice(owner.as_ref());data[64..72].copy_from_slice(&balance.to_le_bytes());data[108]=1;
   self.vm.set_account(addr(associated(owner)),Account{lamports:10_000_000,data,owner:addr(TOKEN),executable:false,rent_epoch:0}).unwrap();
  }
 }
 fn mission(&self)->Mission{let a=self.vm.get_account(&addr(self.state().mission)).unwrap();Mission::try_deserialize(&mut a.data.as_slice()).unwrap()}
 fn balance(&self,owner:Pubkey)->u64{let a=self.vm.get_account(&addr(associated(owner))).unwrap();u64::from_le_bytes(a.data[64..72].try_into().unwrap())}
 fn vault_send(&mut self,signer:usize,metas:Vec<anchor_lang::solana_program::instruction::AccountMeta>,data:Vec<u8>)->Result<(),String>{
  let ix=Instruction{program_id:addr(pact_vault_v3::ID),accounts:metas.into_iter().map(|m|AccountMeta{pubkey:addr(m.pubkey),is_signer:m.is_signer,is_writable:m.is_writable}).collect(),data};
  self.vm.expire_blockhash();let tx=Transaction::new(&[&self.keys[signer]],Message::new(&[ix],Some(&self.keys[signer].pubkey())),self.vm.latest_blockhash());
  self.vm.send_transaction(tx).map(|m|{self.max_cu=self.max_cu.max(m.compute_units_consumed);}).map_err(|e|format!("{e:?}"))
 }
 fn funding(&self,sponsor:Pubkey)->Vec<anchor_lang::solana_program::instruction::AccountMeta>{let mission=self.state().mission;pact_vault_v3::accounts::FundMission{mission,game:self.game,sponsor,mint:MINT,source:associated(sponsor),escrow:associated(mission),token_program:TOKEN,system_program:anchor_lang::system_program::ID}.to_account_metas(None)}
 fn fund(&mut self){let sponsor=pk(&self.keys[0]);self.vault_send(0,self.funding(sponsor),pact_vault_v3::instruction::Fund{}.data()).unwrap();assert_eq!(self.balance(sponsor),80_000_000);assert_eq!(self.balance(self.state().mission),20_000_000);}
 fn settle(&self,payer:usize,owner:Pubkey)->Vec<anchor_lang::solana_program::instruction::AccountMeta>{let mission=self.state().mission;pact_vault_v3::accounts::Settle{mission,game:self.game,mint:MINT,escrow:associated(mission),destination:associated(owner),token_program:TOKEN,payer:pk(&self.keys[payer])}.to_account_metas(None)}
 fn paid(&mut self,m:usize,t:usize,provider:u8,slot:u8)->Result<(),String>{
  self.paid_offer(m,t,provider,slot)?;
  self.accept_paid(m,t)
 }
 fn paid_offer(&mut self,m:usize,t:usize,provider:u8,slot:u8)->Result<(),String>{
  let nonce=self.state().seats[m].offer_nonce;
  self.act(m,game_v3::instruction::CreateOffer{auth:self.auth(m),terms:Terms{taker:t as u8,provider,kind:1,action:3,delivery:0,offer_nonce:nonce,gives:if provider==t as u8{[[1,0,0],[0;3]]}else{[[0;3],[1,0,0]]},job_slot:slot},config_hash:self.config()}.data())
 }
 fn accept_paid(&mut self,m:usize,t:usize)->Result<(),String>{
  let nonce=self.state().offers[m].nonce;
  let metas=game_v3::accounts::Sponsored{game:self.game,actor:pk(&self.keys[t]),mission:self.state().mission,vault_program:pact_vault_v3::ID}.to_account_metas(None);
  self.send(t,metas,game_v3::instruction::AcceptSponsored{auth:self.auth(t),maker:m as u8,offer_nonce:nonce,terms_hash:self.terms_hash(m)}.data())
 }
 fn watched(&self)->Vec<Vec<u8>>{[self.game,self.state().mission,associated(self.state().mission),MINT,associated(pk(&self.keys[0])),associated(pk(&self.keys[1])),associated(pk(&self.keys[2])),associated(pk(&self.keys[3]))].iter().map(|k|self.vm.get_account(&addr(*k)).map(|a|a.data).unwrap_or_default()).collect()}
 /// A real permissionless resolution can be delayed past funding expiry.
 /// Time travel is a local LiteSVM fixture only, not a validator or network claim.
 fn enter_bridge_after_delay(&mut self,at:i64){
  self.start();let n=self.state().count as usize;
  for i in 0..n{self.act(i,game_v3::instruction::SetPlanReady{auth:self.auth(i),ready:true}.data()).unwrap();}self.advance();let g=self.state();
  for i in 0..n{let salt=[41+i as u8;32];let commitment=game_v3::consent::commitment(&g,&self.game,i as u8,2,0,0,&salt).unwrap();self.act(i,game_v3::instruction::CommitMove{auth:self.auth(i),commitment}.data()).unwrap();}self.advance();
  for i in 0..n{self.act(i,game_v3::instruction::RevealMove{auth:self.auth(i),action:2,route:0,delivery:0,salt:[41+i as u8;32]}.data()).unwrap();}self.advance();
  self.time(at);self.act(0,game_v3::instruction::ResolveStage{stage:0}.data()).unwrap();assert_eq!(self.state().stage,1);
 }
 fn export_public_fixture(&self,name:&str){
  let folder="../../tests/fixtures/native/v3/vault-sdk/fixtures";std::fs::create_dir_all(folder).unwrap();
  let mission=self.state().mission;
  for (suffix,key) in [("game",self.game),("mission",mission),("sponsor-token",associated(pk(&self.keys[0]))),("provider-token",associated(pk(&self.keys[2]))),("escrow-token",associated(mission))]{std::fs::write(format!("{folder}/{name}-{suffix}.bin"),self.vm.get_account(&addr(key)).unwrap().data).unwrap();}
  let digest=|v:&[u8]|v.iter().map(|x|format!("{x:02x}")).collect::<String>();let g=self.state();let open=g.offers[0];
  let terms=if open.status==1{format!("\"{}\"",digest(&game_v3::consent::terms_hash(&g,&self.game,&open).unwrap()))}else{"null".to_string()};
  std::fs::write(format!("{folder}/{name}.json"),format!("{{\"source\":\"compiled-SBF-LiteSVM-generated-local-fixture\",\"game\":\"{}\",\"mission\":\"{}\",\"sponsor\":\"{}\",\"provider\":\"{}\",\"sponsorBalance\":{},\"providerBalance\":{},\"escrowBalance\":{},\"phase\":{},\"stage\":{},\"configHash\":\"{}\",\"openTermsHash\":{}}}",self.game,mission,pk(&self.keys[0]),pk(&self.keys[2]),self.balance(pk(&self.keys[0])),self.balance(pk(&self.keys[2])),self.balance(mission),g.phase,g.stage,digest(&game_v3::consent::config_hash(&g,&self.game).unwrap()),terms)).unwrap();
 }
}

#[test]
fn funding_is_exact_and_wrong_mint_authority_and_second_fund_are_atomic(){
 let mut f=Fixture::new(4);f.vault();let before=f.watched();
 let mut metas=f.funding(pk(&f.keys[0]));metas[3].pubkey=pk(&f.keys[1]);
 assert!(f.vault_send(0,metas,pact_vault_v3::instruction::Fund{}.data()).is_err());assert_eq!(f.watched(),before);
 let mut metas=f.funding(pk(&f.keys[1]));metas[4].pubkey=associated(pk(&f.keys[0]));
 assert!(f.vault_send(1,metas,pact_vault_v3::instruction::Fund{}.data()).is_err());assert_eq!(f.watched(),before);
 f.fund();let before=f.watched();assert!(f.vault_send(0,f.funding(pk(&f.keys[0])),pact_vault_v3::instruction::Fund{}.data()).is_err());assert_eq!(f.watched(),before);
 assert_eq!(f.mission().slots[0].status,0);
}

#[test]
fn game_cpi_reserves_then_missing_reveal_earns_exact_payout_despite_forfeit_and_failure(){
 let mut f=Fixture::new(4);f.vault();f.fund();f.start();f.stage([2;6],0,[0;6],0);assert_eq!(f.state().stage,1);
 f.paid(0,2,2,0).unwrap();assert_eq!(f.mission().slots[0].status,1);assert_eq!(f.mission().slots[0].owner,pk(&f.keys[2]));
 let before=f.watched();assert!(f.vault_send(3,f.settle(3,pk(&f.keys[2])),pact_vault_v3::instruction::Claim{slot:0}.data()).is_err());assert_eq!(f.watched(),before);
 f.time(90_000);let before=f.watched();assert!(f.vault_send(3,f.settle(3,pk(&f.keys[0])),pact_vault_v3::instruction::Refund{slot:0}.data()).is_err());assert_eq!(f.watched(),before,"accepted slot cannot expire after 24h");
 // Test Clock is restored to live Planning deadline; no elapsed session is used.
 f.time(1_000);f.stage([2,3,3,2,0,0],0,[0;6],4);assert!(f.state().seats[2].forfeited);assert!(f.state().history[1].jobs.iter().any(|r|r.slot==0&&r.executed));
 while f.state().phase!=5{f.stage([1;6],0,[0;6],0);}assert!(!f.state().arrived);
 let before=f.watched();assert!(f.vault_send(3,f.settle(3,pk(&f.keys[3])),pact_vault_v3::instruction::Claim{slot:0}.data()).is_err());assert_eq!(f.watched(),before,"cannot redirect earned payment");
 f.vault_send(3,f.settle(3,pk(&f.keys[2])),pact_vault_v3::instruction::Claim{slot:0}.data()).unwrap();assert_eq!(f.balance(pk(&f.keys[2])),10_000_000);assert_eq!(f.balance(f.state().mission),10_000_000);assert_eq!(f.mission().slots[0].status,2);
 let before=f.watched();assert!(f.vault_send(1,f.settle(1,pk(&f.keys[2])),pact_vault_v3::instruction::Claim{slot:0}.data()).is_err());assert!(f.vault_send(1,f.settle(1,pk(&f.keys[0])),pact_vault_v3::instruction::Refund{slot:0}.data()).is_err());assert_eq!(f.watched(),before);
 f.export_public_fixture("paid");
 f.vault_send(3,f.settle(3,pk(&f.keys[0])),pact_vault_v3::instruction::Refund{slot:1}.data()).unwrap();assert_eq!(f.balance(pk(&f.keys[0])),90_000_000);assert_eq!(f.balance(f.state().mission),0);assert_eq!(f.mission().slots[1].status,3);f.export_public_fixture("paid-and-refunded");
 println!("V3_VAULT_NATIVE paid_once=10000000 refund_unfilled=10000000 provider_missing=true campaign_failed=true max_cu={}",f.max_cu);
}

#[test]
fn reserve_requires_game_pda_signature_and_npc_exclusion_and_cpi_rollback(){
 let mut f=Fixture::new(4);f.vault();f.fund();f.start();f.stage([2;6],0,[0;6],0);
 let before=f.watched();let metas=pact_vault_v3::accounts::ReserveJob{mission:f.state().mission,game:f.game}.to_account_metas(None);
 assert!(f.vault_send(3,metas,pact_vault_v3::instruction::ReserveJob{slot:0,provider:2,job_nonce:0}.data()).is_err());assert_eq!(f.watched(),before);
 // Corrupted public mission fixture simulates changed pin: Game reservations/nonce roll back on failed fixed CPI.
 let mut account=f.vm.get_account(&addr(f.state().mission)).unwrap();let mut mission=f.mission();mission.roster+=1;let mut bytes=Vec::new();mission.try_serialize(&mut bytes).unwrap();account.data=bytes;f.vm.set_account(addr(f.state().mission),account).unwrap();
 let nonce=f.state().seats[0].offer_nonce;f.act(0,game_v3::instruction::CreateOffer{auth:f.auth(0),terms:Terms{taker:2,provider:2,kind:1,action:3,delivery:0,offer_nonce:nonce,gives:[[1,0,0],[0;3]],job_slot:0},config_hash:f.config()}.data()).unwrap();
 let before=f.watched();let metas=game_v3::accounts::Sponsored{game:f.game,actor:pk(&f.keys[2]),mission:f.state().mission,vault_program:pact_vault_v3::ID}.to_account_metas(None);
 assert!(f.send(2,metas,game_v3::instruction::AcceptSponsored{auth:f.auth(2),maker:0,offer_nonce:nonce,terms_hash:f.terms_hash(0)}.data()).is_err());assert_eq!(f.watched(),before);
}

#[test]
fn disclosed_npc_cannot_offer_paid_job_and_forged_game_owner_or_pda_cannot_settle(){
 let mut f=Fixture::new(4);f.vault();f.act(0,game_v3::instruction::ConfigureMission{npc_mask:4,enabled:true}.data()).unwrap();f.fund();f.start();f.stage([2;6],0,[0;6],0);
 let before=f.watched();assert!(f.paid(0,2,2,0).is_err());assert_eq!(f.watched(),before,"excluded NPC proposal cannot alter game or vault");
 // Public malicious RPC account fixture cannot become an accepted vault receipt.
 let fake=pk(&f.keys[5]);let original=f.vm.get_account(&addr(f.game)).unwrap();f.vm.set_account(addr(fake),original).unwrap();
 let mut metas=f.settle(3,pk(&f.keys[0]));metas[1].pubkey=fake;let before=f.watched();assert!(f.vault_send(3,metas,pact_vault_v3::instruction::Refund{slot:0}.data()).is_err());assert_eq!(f.watched(),before);
 let mut a=f.vm.get_account(&addr(f.game)).unwrap();a.owner=addr(pk(&f.keys[7]));f.vm.set_account(addr(f.game),a).unwrap();let before=f.watched();assert!(f.vault_send(3,f.settle(3,pk(&f.keys[0])),pact_vault_v3::instruction::Refund{slot:0}.data()).is_err());assert_eq!(f.watched(),before);
}

#[test]
fn expiry_boundary_closes_only_unfilled_reservations_and_failed_cpi_rolls_back_game(){
 for (offset,allowed) in [(-1,true),(0,false),(1,false)]{
  let mut f=Fixture::new(4);f.vault();f.fund();f.enter_bridge_after_delay(1_000+pact_vault_v3::RESERVATION_SECONDS+offset);
  f.paid_offer(0,2,2,0).unwrap();let before=f.watched();let result=f.accept_paid(0,2);
  if allowed{result.unwrap();assert_eq!(f.mission().slots[0].status,1);assert_eq!(f.state().deals[0].job_slot,0);}
  else{assert!(result.is_err());assert_eq!(f.watched(),before,"failed fixed CPI preserves maker offer, taker seal, reserves and nonce");f.vault_send(3,f.settle(3,pk(&f.keys[0])),pact_vault_v3::instruction::Refund{slot:0}.data()).unwrap();assert_eq!(f.mission().slots[0].status,3);}
 }
}

#[test]
fn completed_bridge_releases_unfilled_slot_immediately_and_earned_job_never_refunds(){
 let mut f=Fixture::new(4);f.vault();f.fund();f.start();f.stage([2;6],0,[0;6],0);
 let before=f.watched();assert!(f.vault_send(3,f.settle(3,pk(&f.keys[0])),pact_vault_v3::instruction::Refund{slot:1}.data()).is_err());assert_eq!(f.watched(),before);
 f.paid_offer(0,2,2,0).unwrap();f.export_public_fixture("open-paid-offer");f.accept_paid(0,2).unwrap();f.export_public_fixture("reserved");
 f.stage([2,3,3,2,0,0],0,[0;6],4);assert_eq!(f.state().stage,2);assert!(f.state().history[1].complete);
 f.vault_send(3,f.settle(3,pk(&f.keys[0])),pact_vault_v3::instruction::Refund{slot:1}.data()).unwrap();assert_eq!(f.balance(pk(&f.keys[0])),90_000_000);assert_eq!(f.balance(f.state().mission),10_000_000);
 f.time(1_000+20*pact_vault_v3::RESERVATION_SECONDS);let before=f.watched();assert!(f.vault_send(3,f.settle(3,pk(&f.keys[0])),pact_vault_v3::instruction::Refund{slot:0}.data()).is_err());assert_eq!(f.watched(),before);
 f.vault_send(3,f.settle(3,pk(&f.keys[2])),pact_vault_v3::instruction::Claim{slot:0}.data()).unwrap();assert_eq!(f.balance(pk(&f.keys[2])),10_000_000);assert_eq!(f.balance(f.state().mission),0);
}

#[test]
fn changed_lobby_pin_or_cancelled_campaign_releases_unfilled_funding_without_timeout(){
 for change in [0,1,2]{let mut f=Fixture::new(4);f.vault();f.fund();
  if change==0{f.act(4,game_v3::instruction::JoinMatch{}.data()).unwrap();}
  else if change==1{f.act(0,game_v3::instruction::ConfigureMission{npc_mask:0,enabled:false}.data()).unwrap();}
  else{f.time(1_900);f.act(3,game_v3::instruction::CancelExpiredLobby{}.data()).unwrap();}
  let mission=Pubkey::find_program_address(&[b"mission",f.game.as_ref()],&pact_vault_v3::ID).0;
  // Lobby invalidation clears Game.mission, so use canonical derivation rather than its old pointer.
  let metas=pact_vault_v3::accounts::Settle{mission,game:f.game,mint:MINT,escrow:associated(mission),destination:associated(pk(&f.keys[0])),token_program:TOKEN,payer:pk(&f.keys[3])}.to_account_metas(None);
  f.vault_send(3,metas.clone(),pact_vault_v3::instruction::Refund{slot:0}.data()).unwrap();f.vault_send(3,metas,pact_vault_v3::instruction::Refund{slot:1}.data()).unwrap();assert_eq!(f.balance(pk(&f.keys[0])),100_000_000);assert_eq!(f.balance(mission),0);
 }
}

#[test]
fn altered_token_program_mint_ata_or_delegate_never_moves_escrow(){
 for index in [2usize,3,4,5]{let mut f=Fixture::new(4);f.vault();f.fund();f.start();f.stage([2;6],0,[0;6],0);f.stage([2;6],1,[0;6],0);
  let mut metas=f.settle(3,pk(&f.keys[0]));metas[index].pubkey=if index==4{associated(pk(&f.keys[1]))}else{pk(&f.keys[7])};let before=f.watched();assert!(f.vault_send(3,metas,pact_vault_v3::instruction::Refund{slot:0}.data()).is_err());assert_eq!(f.watched(),before);
 }
 for offset in [72usize,129]{let mut f=Fixture::new(4);f.vault();f.fund();f.start();f.stage([2;6],0,[0;6],0);f.stage([2;6],1,[0;6],0);
  let escrow=associated(f.state().mission);let mut a=f.vm.get_account(&addr(escrow)).unwrap();a.data[offset..offset+4].copy_from_slice(&1u32.to_le_bytes());f.vm.set_account(addr(escrow),a).unwrap();let before=f.watched();assert!(f.vault_send(3,f.settle(3,pk(&f.keys[0])),pact_vault_v3::instruction::Refund{slot:0}.data()).is_err());assert_eq!(f.watched(),before);
 }
}

#[test]
fn delegated_game_session_cannot_debit_owner_ata_but_its_own_tokens_remain_its_own(){
 let mut f=Fixture::new(4);f.vault();f.act(0,game_v3::instruction::AuthorizeSession{auth:f.auth(0),key:pk(&f.keys[4]),expires:2_000}.data()).unwrap();
 let session=pk(&f.keys[4]);let mut metas=f.funding(session);metas[4].pubkey=associated(pk(&f.keys[0]));let before=f.watched();assert!(f.vault_send(4,metas,pact_vault_v3::instruction::Fund{}.data()).is_err());assert_eq!(f.watched(),before);
 // An independent key can fund its OWN canonical ATA. No onchain claim of global "session keys cannot spend".
 let mut account=f.vm.get_account(&addr(associated(pk(&f.keys[0])))).unwrap();account.data[32..64].copy_from_slice(session.as_ref());f.vm.set_account(addr(associated(session)),account).unwrap();
 f.vault_send(4,f.funding(session),pact_vault_v3::instruction::Fund{}.data()).unwrap();assert_eq!(f.balance(session),80_000_000);assert_eq!(f.mission().sponsor,session);assert_eq!(f.balance(pk(&f.keys[0])),100_000_000);
}
