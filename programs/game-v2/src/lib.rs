use anchor_lang::prelude::*;
pub mod state;
pub mod consent;
pub mod handlers;
pub use state::*;

declare_id!("7Fs272UohH4jF53fwsdVk3E9t4KuDptdn6DcFyxbuARd");

#[program]
pub mod game_v2 {
    use super::*;
    pub fn create_match(c: Context<CreateMatch>, nonce: [u8; 16]) -> Result<()> { handlers::create(c, nonce) }
    pub fn join_match(c: Context<Act>) -> Result<()> { handlers::join(c) }
    pub fn leave_lobby(c: Context<Act>, auth: Auth) -> Result<()> { handlers::leave(c, auth) }
    pub fn configure_mission(c: Context<Act>, npc_mask: u8, enabled: bool) -> Result<()> { handlers::configure(c, npc_mask, enabled) }
    pub fn set_ready(c: Context<Act>, auth: Auth, roster: u32, config_hash: [u8; 32]) -> Result<()> { handlers::ready(c, auth, roster, config_hash) }
    pub fn start_match(c: Context<Act>) -> Result<()> { handlers::start(c) }
    pub fn authorize_session(c: Context<Act>, auth: Auth, key: Pubkey, expires: i64) -> Result<()> { handlers::session(c, auth, key, expires) }
    pub fn revoke_session(c: Context<Act>, auth: Auth) -> Result<()> { handlers::revoke(c, auth) }
    pub fn create_offer(c: Context<Act>, auth: Auth, terms: Terms, config_hash: [u8; 32]) -> Result<()> { handlers::offer(c, auth, terms, config_hash) }
    pub fn cancel_offer(c: Context<Act>, auth: Auth, offer_nonce: u32) -> Result<()> { handlers::cancel(c, auth, offer_nonce) }
    pub fn accept_offer(c: Context<Act>, auth: Auth, maker: u8, offer_nonce: u32, terms_hash: [u8; 32]) -> Result<()> { handlers::accept(c, auth, maker, offer_nonce, terms_hash) }
    pub fn accept_sponsored(c: Context<Sponsored>, auth: Auth, maker: u8, offer_nonce: u32, terms_hash: [u8; 32]) -> Result<()> { handlers::sponsored(c, auth, maker, offer_nonce, terms_hash) }
    pub fn set_plan_ready(c: Context<Act>, auth: Auth, ready: bool) -> Result<()> { handlers::plan_ready(c, auth, ready) }
    pub fn commit_move(c: Context<Act>, auth: Auth, commitment: [u8; 32]) -> Result<()> { handlers::commit(c, auth, commitment) }
    pub fn reveal_move(c: Context<Act>, auth: Auth, action: u8, route: u8, delivery: u16, salt: [u8; 32]) -> Result<()> { handlers::reveal(c, auth, action, route, delivery, salt) }
    pub fn advance_phase(c: Context<Act>, stage: u8, phase: u8) -> Result<()> { handlers::advance(c, stage, phase) }
    pub fn resolve_stage(c: Context<Act>, stage: u8) -> Result<()> { handlers::resolve(c, stage) }
    pub fn cancel_expired_lobby(c: Context<Act>) -> Result<()> { handlers::abort(c) }
}

#[derive(Accounts)]
#[instruction(nonce: [u8; 16])]
pub struct CreateMatch<'info> {
    #[account(init, payer = actor, space = 8192, seeds = [b"match-v2", actor.key().as_ref(), &nonce], bump)]
    pub game: Box<Account<'info, GameV2>>,
    #[account(mut)]
    pub actor: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Act<'info> {
    #[account(mut, seeds = [b"match-v2", game.creator.as_ref(), &game.nonce], bump = game.bump)]
    pub game: Box<Account<'info, GameV2>>,
    pub actor: Signer<'info>,
}

#[derive(Accounts)]
pub struct Sponsored<'info> {
    #[account(mut, seeds = [b"match-v2", game.creator.as_ref(), &game.nonce], bump = game.bump)]
    pub game: Box<Account<'info, GameV2>>,
    pub actor: Signer<'info>,
    /// CHECK: canonical Vault PDA, exact owner, discriminator and terms additionally verified by fixed callee.
    #[account(mut, address = game.mission, owner = VAULT_ID, seeds = [b"mission", game.key().as_ref()], bump, seeds::program = VAULT_ID)]
    pub mission: UncheckedAccount<'info>,
    /// CHECK: the only permitted executable CPI destination; no caller-supplied target/data.
    #[account(address = VAULT_ID, executable)]
    pub vault_program: UncheckedAccount<'info>,
}
