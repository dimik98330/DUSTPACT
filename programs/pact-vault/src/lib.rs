//! Fixed two-job TEST-USDC vault. No instruction can choose a mint, amount or recipient.
use anchor_lang::prelude::*;
use game_v2::GameV2;
use anchor_lang::solana_program::{instruction::{AccountMeta, Instruction},program::invoke_signed};
declare_id!("FdmDeHDFdxrraqSXdprzDPieSLZMbQCkEPr5rjokRtBR");
pub const TOKEN: Pubkey = pubkey!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
pub const ATA: Pubkey = pubkey!("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
pub const MINT: Pubkey = pubkey!("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
pub const FUND: u64 = 20_000_000;
pub const PAY: u64 = 10_000_000;
pub const RESERVATION_SECONDS: i64 = 86_400;
pub const AVAILABLE:u8=0; pub const RESERVED:u8=1; pub const PAID:u8=2; pub const REFUNDED:u8=3;

#[program]
pub mod pact_vault {
 use super::*;
 /// The sponsor signs for its own canonical ATA; a Game session cannot debit another owner.
 pub fn fund(c:Context<FundMission>)->Result<()> {
  let game=&c.accounts.game;
  require!(game.phase==0 && game.count>=4 && game.count<=6,VaultError::Phase);
  require!(game.mission==c.accounts.mission.key() && game.mission_roster==game.roster,VaultError::Config);
  require!(game.eligible_mask & game.npc_mask ==0 && game.eligible_mask & !((1u8<<game.count)-1)==0,VaultError::Config);
  validate_mint(&c.accounts.mint)?;
  token_account(&c.accounts.source,c.accounts.sponsor.key())?;
  token_account(&c.accounts.escrow,c.accounts.mission.key())?;
  transfer(&c.accounts.source,&c.accounts.mint,&c.accounts.escrow,&c.accounts.sponsor.to_account_info(),&c.accounts.token_program,FUND,&[])?;
  let m=&mut c.accounts.mission;
  m.game=game.key();m.sponsor=c.accounts.sponsor.key();m.bump=c.bumps.mission;
  m.roster=game.roster;m.rules_hash=game.rules_hash;m.content_hash=game.content_hash;
  m.eligible_mask=game.eligible_mask;m.funded_at=Clock::get()?.unix_timestamp;
  m.slots=[JobSlot::default();2];
  Ok(())
 }
 /// Invoked only by the canonical Game Match PDA, after serializing accepted terms.
 pub fn reserve_job(c:Context<ReserveJob>,slot:u8,provider:u8,job_nonce:u32)->Result<()> {
  require!(slot<2,VaultError::Slot);let g=&c.accounts.game;
  check_current(&c.accounts.mission,g)?;
  require!(g.phase==1 && g.stage==1 && provider<g.count,VaultError::Phase);
  // At the exact expiry boundary an AVAILABLE slot can only be refunded.
  // A delayed Game resolver must not reopen expired sponsor obligations.
  require!(Clock::get()?.unix_timestamp<c.accounts.mission.funded_at.checked_add(RESERVATION_SECONDS).ok_or(VaultError::Overflow)?,VaultError::ReservationExpired);
  require!(c.accounts.game.to_account_info().is_signer,VaultError::GameAuthority);
  require!(g.eligible_mask & (1<<provider)!=0 && g.npc_mask & (1<<provider)==0,VaultError::Eligibility);
  require!(g.deals.iter().take(g.deal_count as usize).any(|p|p.status==2&&p.kind==1&&p.action==3&&p.stage==1&&p.provider==provider&&p.nonce==job_nonce&&p.job_slot==slot),VaultError::Job);
  require!(c.accounts.mission.slots[slot as usize].status==AVAILABLE,VaultError::Slot);
  require!(!c.accounts.mission.slots.iter().any(|s|s.status==RESERVED&&s.provider==provider),VaultError::Slot);
  c.accounts.mission.slots[slot as usize]=JobSlot{status:RESERVED,provider,nonce:job_nonce,owner:g.seats[provider as usize].owner};
  Ok(())
 }
 /// Any fee payer may settle, but output is the recorded seat owner's exact ATA.
 pub fn claim(c:Context<Settle>,slot:u8)->Result<()> {
  require!(slot<2,VaultError::Slot);let m=&c.accounts.mission;let s=m.slots[slot as usize];
  require!(s.status==RESERVED,VaultError::Slot);
  check_pinned(m,&c.accounts.game)?;
  let receipt=job_receipt(&c.accounts.game,slot,s.provider,s.nonce,s.owner)?;
  require!(receipt,VaultError::Unperformed);
  validate_mint(&c.accounts.mint)?;token_account(&c.accounts.escrow,m.key())?;
  token_account(&c.accounts.destination,s.owner)?;
  let bump=[m.bump];let seeds:&[&[u8]]=&[b"mission",m.game.as_ref(),&bump];
  transfer(&c.accounts.escrow,&c.accounts.mint,&c.accounts.destination,&m.to_account_info(),&c.accounts.token_program,PAY,&[seeds])?;
  c.accounts.mission.slots[slot as usize].status=PAID;Ok(())
 }
 /// Unfilled slots close when Bridge ends, the lobby pin changes, or the offer expires.
 /// Accepted jobs do not expire: only a canonical unperformed receipt releases them.
 pub fn refund(c:Context<Settle>,slot:u8)->Result<()> {
  require!(slot<2,VaultError::Slot);let m=&c.accounts.mission;let s=m.slots[slot as usize];let g=&c.accounts.game;
  require!(s.status==AVAILABLE||s.status==RESERVED,VaultError::Slot);check_pinned(m,g)?;
  if s.status==AVAILABLE {
   let invalidated_lobby=g.phase==0 && (m.roster!=g.roster || g.mission_roster!=g.roster || g.mission!=m.key() || m.eligible_mask!=g.eligible_mask);
   require!(Clock::get()?.unix_timestamp>=m.funded_at.checked_add(RESERVATION_SECONDS).ok_or(VaultError::Overflow)? || g.history[1].complete || g.stage>1 || g.phase>=5 || invalidated_lobby,VaultError::Early);
  } else { require!(!job_receipt(g,slot,s.provider,s.nonce,s.owner)?,VaultError::Executed); }
  validate_mint(&c.accounts.mint)?;token_account(&c.accounts.escrow,m.key())?;token_account(&c.accounts.destination,m.sponsor)?;
  let bump=[m.bump];let seeds:&[&[u8]]=&[b"mission",m.game.as_ref(),&bump];
  transfer(&c.accounts.escrow,&c.accounts.mint,&c.accounts.destination,&m.to_account_info(),&c.accounts.token_program,PAY,&[seeds])?;
  c.accounts.mission.slots[slot as usize].status=REFUNDED;Ok(())
 }
}

fn check_pinned(m:&Account<Mission>,g:&Account<GameV2>)->Result<()> {require!(m.game==g.key()&&m.rules_hash==g.rules_hash&&m.content_hash==g.content_hash,VaultError::Config);Ok(())}
fn check_current(m:&Account<Mission>,g:&Account<GameV2>)->Result<()> {check_pinned(m,g)?;require!(m.roster==g.roster&&g.mission_roster==g.roster&&g.mission==m.key()&&m.eligible_mask==g.eligible_mask,VaultError::Config);Ok(())}
fn job_receipt(g:&GameV2,slot:u8,provider:u8,nonce:u32,owner:Pubkey)->Result<bool>{
 require!(g.history[1].complete,VaultError::Early);
 let r=g.history[1].jobs.iter().find(|r|r.slot==slot&&r.provider==provider&&r.nonce==nonce&&r.owner==owner).ok_or(VaultError::Job)?;
 Ok(r.executed)
}
pub fn associated(owner:Pubkey)->Pubkey{Pubkey::find_program_address(&[owner.as_ref(),TOKEN.as_ref(),MINT.as_ref()],&ATA).0}
fn validate_mint(info:&AccountInfo)->Result<()> {require_keys_eq!(*info.key,MINT,VaultError::Token);require_keys_eq!(*info.owner,TOKEN,VaultError::Token);let b=info.try_borrow_data()?;require!(b.len()==82&&b[44]==6&&b[45]==1,VaultError::Token);Ok(())}
fn token_account(info:&AccountInfo,owner:Pubkey)->Result<()> {
 require_keys_eq!(*info.key,associated(owner),VaultError::Destination);require_keys_eq!(*info.owner,TOKEN,VaultError::Token);
 let b=info.try_borrow_data()?;require!(b.len()==165&&b[..32]==MINT.to_bytes()&&b[32..64]==owner.to_bytes()&&b[108]==1,VaultError::Token);
 // Vault balances cannot have a delegate or close authority, which could bypass settlement.
 require!(u32::from_le_bytes(b[72..76].try_into().unwrap())==0&&u32::from_le_bytes(b[129..133].try_into().unwrap())==0,VaultError::Token);Ok(())
}
fn transfer<'a>(source:&AccountInfo<'a>,mint:&AccountInfo<'a>,destination:&AccountInfo<'a>,authority:&AccountInfo<'a>,program:&AccountInfo<'a>,amount:u64,seeds:&[&[&[u8]]])->Result<()> {
 require_keys_eq!(*program.key,TOKEN,VaultError::Token);require!(program.executable,VaultError::Token);
 let mut data=vec![12];data.extend_from_slice(&amount.to_le_bytes());data.push(6);
 let ix=Instruction{program_id:TOKEN,accounts:vec![AccountMeta::new(*source.key,false),AccountMeta::new_readonly(MINT,false),AccountMeta::new(*destination.key,false),AccountMeta::new_readonly(*authority.key,true)],data};
 invoke_signed(&ix,&[source.clone(),mint.clone(),destination.clone(),authority.clone(),program.clone()],seeds)?;Ok(())
}

#[account]#[derive(InitSpace)] pub struct Mission {pub game:Pubkey,pub sponsor:Pubkey,pub bump:u8,pub roster:u32,pub rules_hash:[u8;32],pub content_hash:[u8;32],pub eligible_mask:u8,pub funded_at:i64,pub slots:[JobSlot;2]}
#[derive(AnchorSerialize,AnchorDeserialize,Copy,Clone,Default,InitSpace)]pub struct JobSlot{pub status:u8,pub provider:u8,pub nonce:u32,pub owner:Pubkey}
#[derive(Accounts)]pub struct FundMission<'info>{
 #[account(init,payer=sponsor,space=8+Mission::INIT_SPACE,seeds=[b"mission",game.key().as_ref()],bump)]pub mission:Box<Account<'info,Mission>>,
 #[account(seeds=[b"match-v2",game.creator.as_ref(),&game.nonce],bump=game.bump,seeds::program=game_v2::ID)]pub game:Box<Account<'info,GameV2>>,
 #[account(mut)]pub sponsor:Signer<'info>,
 /// CHECK: fixed classic USDC mint, checked byte layout and decimals.
 pub mint:AccountInfo<'info>,
 /// CHECK: sponsor canonical USDC ATA and token authority validated.
 #[account(mut)]pub source:AccountInfo<'info>,
 /// CHECK: mission canonical USDC ATA and token authority validated.
 #[account(mut)]pub escrow:AccountInfo<'info>,
 /// CHECK: fixed executable Token Program.
 pub token_program:AccountInfo<'info>,pub system_program:Program<'info,System>
}
#[derive(Accounts)]pub struct ReserveJob<'info>{
 #[account(mut,seeds=[b"mission",game.key().as_ref()],bump=mission.bump)]pub mission:Box<Account<'info,Mission>>,
 #[account(seeds=[b"match-v2",game.creator.as_ref(),&game.nonce],bump=game.bump,seeds::program=game_v2::ID)]pub game:Box<Account<'info,GameV2>>
}
#[derive(Accounts)]pub struct Settle<'info>{
 #[account(mut,seeds=[b"mission",game.key().as_ref()],bump=mission.bump)]pub mission:Box<Account<'info,Mission>>,
 #[account(seeds=[b"match-v2",game.creator.as_ref(),&game.nonce],bump=game.bump,seeds::program=game_v2::ID)]pub game:Box<Account<'info,GameV2>>,
 /// CHECK: fixed mint checked in handler.
 pub mint:AccountInfo<'info>,
 /// CHECK: canonical vault token account checked in handler.
 #[account(mut)]pub escrow:AccountInfo<'info>,
 /// CHECK: canonical recipient owner ATA checked in handler.
 #[account(mut)]pub destination:AccountInfo<'info>,
 /// CHECK: fixed executable Token Program checked in transfer.
 pub token_program:AccountInfo<'info>,pub payer:Signer<'info>
}
#[error_code]pub enum VaultError{#[msg("Invalid phase")]Phase,#[msg("Mission configuration changed")]Config,#[msg("Invalid token account or mint")]Token,#[msg("Noncanonical destination")]Destination,#[msg("Job slot unavailable")]Slot,#[msg("Only Game Match PDA may reserve")]GameAuthority,#[msg("Seat not eligible")]Eligibility,#[msg("Canonical job mismatch")]Job,#[msg("Receipt not yet complete")]Early,#[msg("Work not performed")]Unperformed,#[msg("Executed work cannot refund")]Executed,#[msg("Overflow")]Overflow,#[msg("Unfilled reservation window expired")]ReservationExpired}
