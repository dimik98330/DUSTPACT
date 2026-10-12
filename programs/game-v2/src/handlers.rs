use crate::*;
use dustpact_rules_v2 as rules;
use anchor_lang::solana_program::{instruction::{AccountMeta, Instruction}, program::invoke_signed};
use solana_sha256_hasher::hashv;

pub fn create(c: Context<CreateMatch>, nonce: [u8; 16]) -> Result<()> {
    let g = &mut c.accounts.game;
    g.creator = c.accounts.actor.key(); g.nonce = nonce; g.bump = c.bumps.game;
    g.count = 1; g.hull = 12; g.deadline = Clock::get()?.unix_timestamp + 900;
    g.rules_hash = rules::RULES_HASH;
    g.content_hash = rules::CONTENT_HASH;
    g.seats[0] = Seat::new(g.creator, 0);
    g.history = vec![Summary::default(); 6];
    Ok(())
}

pub fn join(c: Context<Act>) -> Result<()> {
    let g = &mut c.accounts.game; g.open(LOBBY)?;
    require!(g.count < 6, GameError::Full);
    let actor = c.accounts.actor.key();
    require!(!g.seats[..g.count as usize].iter().any(|p| p.owner == actor), GameError::Duplicate);
    let index = g.count as usize; g.seats[index] = Seat::new(actor, index); g.count += 1;
    g.reset_roster()
}

pub fn leave(c: Context<Act>, auth: Auth) -> Result<()> {
    let g = &mut c.accounts.game; g.open(LOBBY)?;
    require!(g.count > 1, GameError::Invalid);
    g.authorize(&c.accounts.actor.key(), &auth, false)?;
    for index in auth.seat as usize..g.count as usize - 1 {
        g.seats[index] = g.seats[index + 1]; g.seats[index].resources = rules::INITIAL[index];
    }
    g.count -= 1; let end = g.count as usize; g.seats[end] = Seat::default();
    g.reset_roster()
}

pub fn configure(c: Context<Act>, npc_mask: u8, enabled: bool) -> Result<()> {
    let address = c.accounts.game.key(); let g = &mut c.accounts.game; g.open(LOBBY)?;
    require!(c.accounts.actor.key() == g.creator && npc_mask & !g.mask() == 0, GameError::Authority);
    require!(!enabled || g.count >= 4, GameError::NotReady);
    g.npc_mask = npc_mask; g.eligible_mask = if enabled { g.mask() & !npc_mask } else { 0 };
    g.mission = if enabled { Pubkey::find_program_address(&[b"mission", address.as_ref()], &VAULT_ID).0 } else { Pubkey::default() };
    g.mission_roster = g.roster;
    for p in &mut g.seats { p.ready = false; }
    g.bump_revision()
}

pub fn ready(c: Context<Act>, auth: Auth, roster: u32, config_hash: [u8; 32]) -> Result<()> {
    let address = c.accounts.game.key(); let g = &mut c.accounts.game; g.open(LOBBY)?;
    require!(roster == g.roster, GameError::Stale);
    require!(config_hash == consent::config_hash(g, &address)?, GameError::Consent);
    g.authorize(&c.accounts.actor.key(), &auth, true)?; g.seats[auth.seat as usize].ready = true;
    Ok(())
}

pub fn start(c: Context<Act>) -> Result<()> {
    let g = &mut c.accounts.game; g.open(LOBBY)?;
    require!(g.count >= 4 && g.seats[..g.count as usize].iter().all(|p| p.ready), GameError::NotReady);
    g.phase = PLAN; g.deadline = Clock::get()?.unix_timestamp + 90; g.bump_revision()
}

pub fn session(c: Context<Act>, auth: Auth, key: Pubkey, expires: i64) -> Result<()> {
    let g = &mut c.accounts.game; g.authorize(&c.accounts.actor.key(), &auth, false)?;
    let now = Clock::get()?.unix_timestamp;
    require!(key != Pubkey::default() && key != g.seats[auth.seat as usize].owner && expires > now && expires <= now + 7200, GameError::Invalid);
    let p = &mut g.seats[auth.seat as usize]; p.session = key; p.expires = expires;
    p.epoch = p.epoch.checked_add(1).ok_or(GameError::Overflow)?; p.quota = 128;
    Ok(())
}

pub fn revoke(c: Context<Act>, auth: Auth) -> Result<()> {
    let g = &mut c.accounts.game; g.authorize(&c.accounts.actor.key(), &auth, false)?;
    let p = &mut g.seats[auth.seat as usize]; p.session = Pubkey::default(); p.quota = 0;
    p.epoch = p.epoch.checked_add(1).ok_or(GameError::Overflow)?;
    Ok(())
}

pub fn rule_deal(p: Offer) -> rules::Deal {
    rules::Deal { active: p.status == 1 || p.status == 2, kind: p.kind, maker: p.maker, taker: p.taker, provider: p.provider, action: p.action, delivery: p.delivery, job: p.job_slot, gives: p.gives }
}

fn validate_offer(g: &GameV2, p: Offer) -> Result<[[u16; 3]; 2]> {
    require!(p.maker < g.count && p.taker < g.count && p.maker != p.taker && p.provider < g.count && p.stage == g.stage, GameError::Invalid);
    let reserve = rules::reserves(g.stage, rule_deal(p)).map_err(|_| error!(GameError::Invalid))?;
    if p.kind == 0 { require!(p.action == 0, GameError::Invalid); }
    if p.kind != 0 { require!(g.seats[p.provider as usize].bound == NONE, GameError::Bound); }
    if p.kind == 2 && g.stage == 2 {
        let used = g.deals.iter().filter(|d| d.status == 2 && d.kind == 2).count();
        require!(used < if g.flags & 2 != 0 { 2 } else { 1 }, GameError::Full);
    }
    if p.job_slot != NONE {
        require!(p.job_slot < 2 && p.kind == 1 && p.action == 3 && g.stage == 1 && g.mission != Pubkey::default() && g.mission_roster == g.roster && g.eligible_mask & (1 << p.provider) != 0, GameError::Mission);
        require!(!g.deals.iter().any(|d| d.status == 2 && d.job_slot == p.job_slot), GameError::Full);
    }
    Ok(reserve)
}

fn accepted_headroom(g: &GameV2, p: Offer) -> Result<()> {
    if p.kind == 0 { return Ok(()); }
    let mut projected = [g.seats[p.maker as usize].resources, g.seats[p.taker as usize].resources];
    let provider_side = usize::from(p.provider != p.maker);
    if p.kind == 2 {
        let output_resource = if g.stage == 0 { 0 } else { 2 };
        for side in 0..2 {
            for j in 0..3 { projected[side][j] = projected[side][j].checked_sub(p.gives[side][j]).ok_or(GameError::Resource)?; }
            projected[side][output_resource] = projected[side][output_resource].checked_add(4).ok_or(GameError::Overflow)?;
        }
    } else {
        for side in 0..2 { for j in 0..3 { projected[side][j] = projected[side][j].checked_sub(p.gives[side][j]).and_then(|v| v.checked_add(p.gives[1 - side][j])).ok_or(GameError::Resource)?; } }
        let cost = rules::action_cost(g.stage, p.action).map_err(|_| error!(GameError::Invalid))?;
        for j in 0..3 { projected[provider_side][j] = projected[provider_side][j].checked_sub(cost[j]).ok_or(GameError::Resource)?; }
        if p.action == 2 { projected[provider_side][0] += 3 - p.delivery; projected[1 - provider_side][0] += p.delivery; }
        if p.action == 3 && g.stage == 0 { projected[provider_side][0] += 8; }
    }
    require!(projected.iter().flatten().all(|&v| v <= 200), GameError::Resource);
    Ok(())
}

pub fn offer(c: Context<Act>, auth: Auth, terms: Terms, config_hash: [u8; 32]) -> Result<()> {
    let address = c.accounts.game.key(); let g = &mut c.accounts.game; g.open(PLAN)?;
    require!(config_hash == consent::config_hash(g, &address)?, GameError::Consent);
    g.authorize(&c.accounts.actor.key(), &auth, true)?;
    let maker = auth.seat as usize;
    require!(g.seats[maker].seal && g.offers[maker].status != 1, GameError::Seal);
    require!(g.seats[maker].offer_count < 3 && terms.offer_nonce == g.seats[maker].offer_nonce, GameError::Stale);
    let mut p = Offer { status: 1, kind: terms.kind, maker: auth.seat, taker: terms.taker, provider: terms.provider, action: terms.action, delivery: terms.delivery, nonce: terms.offer_nonce, stage: g.stage, gives: terms.gives, job_slot: terms.job_slot, ..Offer::default() };
    p.reserve = validate_offer(g, p)?;
    g.seats[maker].reserve(p.reserve[0])?; g.seats[maker].seal = false;
    g.seats[maker].planning_ready = false; g.seats[maker].offer_count += 1;
    g.seats[maker].offer_nonce = g.seats[maker].offer_nonce.checked_add(1).ok_or(GameError::Overflow)?;
    g.offers[maker] = p; g.invariants()
}

pub fn cancel(c: Context<Act>, auth: Auth, offer_nonce: u32) -> Result<()> {
    let g = &mut c.accounts.game; g.open(PLAN)?; g.authorize(&c.accounts.actor.key(), &auth, true)?;
    let index = auth.seat as usize; let p = g.offers[index];
    require!(p.status == 1 && p.nonce == offer_nonce, GameError::Stale);
    g.seats[index].unreserve(p.reserve[0])?; g.seats[index].seal = true;
    g.seats[index].planning_ready = false; g.offers[index].status = 3;
    g.invariants()
}

fn accept_engine(g: &mut GameV2, address: &Pubkey, actor: &Pubkey, auth: Auth, maker: u8, offer_nonce: u32, terms_hash: [u8; 32], sponsored: bool) -> Result<Offer> {
    g.open(PLAN)?; g.authorize(actor, &auth, true)?;
    require!(maker < g.count && maker != auth.seat, GameError::Invalid);
    let m = maker as usize; let t = auth.seat as usize; let mut p = g.offers[m];
    require!(p.status == 1 && p.taker == auth.seat && p.nonce == offer_nonce, GameError::Stale);
    require!(terms_hash == consent::terms_hash(g, address, &p)?, GameError::Consent);
    require!((p.job_slot != NONE) == sponsored, GameError::Mission);
    require!(g.deal_count < g.count / 2 && g.seats[t].seal, GameError::Seal);
    require!(validate_offer(g, p)? == p.reserve, GameError::Consent);
    g.seats[t].reserve(p.reserve[1])?; g.seats[t].seal = false;
    accepted_headroom(g, p)?;
    if p.kind == 0 {
        for j in 0..3 {
            g.seats[m].resources[j] = g.seats[m].resources[j].checked_sub(p.gives[0][j]).and_then(|v| v.checked_add(p.gives[1][j])).ok_or(GameError::Resource)?;
            g.seats[t].resources[j] = g.seats[t].resources[j].checked_sub(p.gives[1][j]).and_then(|v| v.checked_add(p.gives[0][j])).ok_or(GameError::Resource)?;
        }
        g.seats[m].unreserve(p.reserve[0])?; g.seats[t].unreserve(p.reserve[1])?;
    } else { g.seats[p.provider as usize].bound = p.action; }
    g.seats[m].planning_ready = false; g.seats[t].planning_ready = false;
    p.status = 2; g.offers[m] = p; let index = g.deal_count as usize;
    g.deals[index] = p; g.deal_count += 1; g.invariants()?;
    Ok(p)
}

pub fn accept(c: Context<Act>, auth: Auth, maker: u8, offer_nonce: u32, terms_hash: [u8; 32]) -> Result<()> {
    let address = c.accounts.game.key();
    accept_engine(&mut c.accounts.game, &address, &c.accounts.actor.key(), auth, maker, offer_nonce, terms_hash, false)?;
    Ok(())
}

pub fn sponsored(c: Context<Sponsored>, auth: Auth, maker: u8, offer_nonce: u32, terms_hash: [u8; 32]) -> Result<()> {
    let address = c.accounts.game.key();
    let p = accept_engine(&mut c.accounts.game, &address, &c.accounts.actor.key(), auth, maker, offer_nonce, terms_hash, true)?;
    // Vault reads the canonical accepted record in this same atomic transaction.
    c.accounts.game.exit(&crate::ID)?;
    let mut data = hashv(&[b"global:reserve_job"]).to_bytes()[..8].to_vec();
    data.extend_from_slice(&[p.job_slot, p.provider]); data.extend_from_slice(&p.nonce.to_le_bytes());
    let instruction = Instruction { program_id: VAULT_ID, accounts: vec![AccountMeta::new(c.accounts.mission.key(), false), AccountMeta::new_readonly(address, true)], data };
    let g = &c.accounts.game; let bump = [g.bump];
    invoke_signed(&instruction, &[c.accounts.mission.to_account_info(), g.to_account_info(), c.accounts.vault_program.to_account_info()], &[&[b"match-v2", g.creator.as_ref(), &g.nonce, &bump]])?;
    Ok(())
}

pub fn plan_ready(c: Context<Act>, auth: Auth, ready: bool) -> Result<()> {
    let g = &mut c.accounts.game; g.open(PLAN)?; g.authorize(&c.accounts.actor.key(), &auth, true)?;
    g.seats[auth.seat as usize].planning_ready = ready; Ok(())
}

pub fn commit(c: Context<Act>, auth: Auth, commitment: [u8; 32]) -> Result<()> {
    let g = &mut c.accounts.game; g.open(COMMIT)?; g.authorize(&c.accounts.actor.key(), &auth, true)?;
    let bit = 1 << auth.seat;
    require!(g.committed & bit == 0 && commitment != [0; 32], GameError::Duplicate);
    g.commitments[auth.seat as usize] = commitment; g.committed |= bit; Ok(())
}

pub fn reveal(c: Context<Act>, auth: Auth, action: u8, route: u8, delivery: u16, salt: [u8; 32]) -> Result<()> {
    let address = c.accounts.game.key(); let g = &mut c.accounts.game; g.open(REVEAL)?;
    g.authorize(&c.accounts.actor.key(), &auth, true)?; let index = auth.seat as usize; let bit = 1 << auth.seat;
    require!(g.committed & bit != 0 && g.revealed & bit == 0, GameError::Duplicate);
    require!(action <= 4 && route <= 1 && delivery <= 5 && (g.stage == 5 || delivery == 0), GameError::Invalid);
    require!(consent::commitment(g, &address, auth.seat, action, route, delivery, &salt)? == g.commitments[index], GameError::Commitment);
    require!(g.seats[index].bound == NONE || g.seats[index].bound == action, GameError::Bound);
    // Unfunded ordinary actions resolve as Rest; they must not prevent permissionless progress.
    if g.seats[index].bound == NONE {
        if let Ok(cost) = rules::action_cost(g.stage, action) {
            if (0..3).all(|j| g.seats[index].resources[j] - g.seats[index].reserved[j] >= cost[j]) { g.seats[index].reserve(cost)?; }
        }
    }
    require!(delivery <= g.seats[index].resources[2] - g.seats[index].reserved[2], GameError::Resource);
    g.actions[index] = action; g.routes[index] = route; g.deliveries[index] = delivery; g.revealed |= bit;
    g.invariants()
}

pub fn advance(c: Context<Act>, stage: u8, phase: u8) -> Result<()> {
    let g = &mut c.accounts.game;
    require!(stage < 6 && stage <= g.stage && (PLAN..=REVEAL).contains(&phase), GameError::Invalid);
    if stage < g.stage || g.phase > phase { return Ok(()); }
    require!(g.phase == phase, GameError::Phase); let now = Clock::get()?.unix_timestamp;
    match phase {
        PLAN => {
            require!(now >= g.deadline || g.seats[..g.count as usize].iter().all(|p| p.planning_ready), GameError::Early);
            for index in 0..g.count as usize { let p = g.offers[index]; if p.status == 1 { g.seats[index].unreserve(p.reserve[0])?; g.seats[index].seal = true; g.offers[index].status = 4; } }
            g.phase = COMMIT; g.deadline = now + 60;
        }
        COMMIT => { require!(now >= g.deadline || g.committed == g.mask(), GameError::Early); g.phase = REVEAL; g.deadline = now + 60; }
        REVEAL => { require!(now >= g.deadline || g.revealed == g.committed, GameError::Early); g.phase = RESOLVE; }
        _ => return err!(GameError::Phase),
    }
    g.bump_revision()?; g.invariants()
}

pub fn resolve(c: Context<Act>, stage: u8) -> Result<()> {
    let g = &mut c.accounts.game; require!(stage < 6, GameError::Invalid);
    if g.history[stage as usize].complete { return Ok(()); }
    require!(stage == g.stage && g.phase == RESOLVE, GameError::Phase);
    let mut players = [rules::Player::default(); 6]; let mut moves = [rules::Move::default(); 6]; let mut deals = [rules::Deal::default(); 3];
    for index in 0..g.count as usize { let p = g.seats[index]; players[index] = rules::Player { resources: p.resources, support: p.support, delivered: p.delivered, forfeited: p.forfeited }; moves[index] = rules::Move { action: g.actions[index], route: g.routes[index], delivery: g.deliveries[index] }; }
    for index in 0..g.deal_count as usize { deals[index] = rule_deal(g.deals[index]); }
    let missing = g.mask() & !g.revealed;
    let result = rules::resolve(rules::Input { count: g.count, stage, hull: g.hull, flags: g.flags, players, moves, missing, deals }).map_err(|_| error!(GameError::Resource))?;
    g.bump_revision()?;
    let mut h = Summary { complete: true, hull: result.hull, route: result.route, threat: result.threat, guard: result.guard, objective: result.objective, flags: result.flags, actions: result.actions, routes: g.routes, deliveries: result.deliveries, missing, rejected: result.rejected, inputs: result.inputs, outputs: result.outputs, deals: g.deals, deal_count: g.deal_count, revision: g.revision, ..Summary::default() };
    for index in 0..g.count as usize {
        let p = result.players[index]; g.seats[index].resources = p.resources; g.seats[index].reserved = [0; 3];
        g.seats[index].support = p.support; g.seats[index].delivered = p.delivered; g.seats[index].forfeited = p.forfeited;
        h.resources[index] = p.resources; h.support[index] = p.support; h.delivered[index] = p.delivered;
        if p.forfeited { h.forfeited |= 1 << index; }
    }
    for index in 0..g.deal_count as usize {
        let d = g.deals[index]; let w = result.work[index];
        if stage == 1 && d.job_slot != NONE { h.jobs[index] = JobReceipt { slot: d.job_slot, provider: d.provider, nonce: d.nonce, executed: w.active && w.executed, owner: g.seats[d.provider as usize].owner }; }
    }
    g.hull = result.hull; g.flags = result.flags; g.history[stage as usize] = h;
    if result.hull == 0 || stage == 5 {
        g.phase = FINISHED; g.arrived = result.arrived;
        for index in 0..g.count as usize { g.scores[index] = rules::score(result.players[index], result.arrived).unwrap_or(0); }
    } else {
        g.stage += 1; g.phase = PLAN; g.deadline = Clock::get()?.unix_timestamp + 90;
        g.offers = [Offer::default(); 6]; g.deals = [Offer::default(); 3]; g.deal_count = 0;
        g.committed = 0; g.revealed = 0; g.commitments = [[0; 32]; 6]; g.actions = [0; 6]; g.routes = [0; 6]; g.deliveries = [0; 6];
        let count = g.count as usize;
        for p in g.seats.iter_mut().take(count) { p.seal = true; p.bound = NONE; p.offer_count = 0; p.planning_ready = false; }
    }
    g.invariants()
}

pub fn abort(c: Context<Act>) -> Result<()> {
    let g = &mut c.accounts.game; require!(g.phase == LOBBY && Clock::get()?.unix_timestamp >= g.deadline, GameError::Phase);
    g.phase = CANCELLED; g.bump_revision()
}
