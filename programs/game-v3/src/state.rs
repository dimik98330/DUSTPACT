use anchor_lang::prelude::*;

pub const LOBBY: u8 = 0;
pub const PLAN: u8 = 1;
pub const COMMIT: u8 = 2;
pub const REVEAL: u8 = 3;
pub const RESOLVE: u8 = 4;
pub const FINISHED: u8 = 5;
pub const CANCELLED: u8 = 6;
pub const NONE: u8 = 255;

#[cfg(test)]
mod allocation_test {
    use super::*;
    #[test]
    fn exact_schema_three_allocation() { assert_eq!(8 + GameV3::INIT_SPACE, 4500); }
}
pub const VAULT_ID: Pubkey = pubkey!("E6rQv7ohsEL1XtCySvQodTRiEY2sdaMiwDoJdktaiseA");

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub struct Auth {
    pub seat: u8,
    pub owner: Pubkey,
    pub nonce: u64,
    pub epoch: u32,
    pub stage: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub struct Terms {
    pub taker: u8,
    pub provider: u8,
    pub kind: u8,
    pub action: u8,
    pub delivery: u16,
    pub offer_nonce: u32,
    pub gives: [[u16; 3]; 2],
    pub job_slot: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, InitSpace)]
pub struct Seat {
    pub owner: Pubkey,
    pub session: Pubkey,
    pub expires: i64,
    pub epoch: u32,
    pub quota: u16,
    pub action_nonce: u64,
    pub offer_nonce: u32,
    pub ready: bool,
    pub planning_ready: bool,
    pub resources: [u16; 3],
    pub reserved: [u16; 3],
    pub support: u16,
    pub delivered: u16,
    pub forfeited: bool,
    pub seal: bool,
    pub bound: u8,
    pub offer_count: u8,
}

impl Seat {
    pub fn new(owner: Pubkey, index: usize) -> Self {
        Self { owner, resources: dustpact_rules_v3::INITIAL[index], seal: true, bound: NONE, ..Self::default() }
    }
    pub fn reserve(&mut self, amounts: [u16; 3]) -> Result<()> {
        for (j, amount) in amounts.into_iter().enumerate() {
            let next = self.reserved[j].checked_add(amount).ok_or(GameError::Overflow)?;
            require!(next <= self.resources[j], GameError::Resource);
            self.reserved[j] = next;
        }
        Ok(())
    }
    pub fn unreserve(&mut self, amounts: [u16; 3]) -> Result<()> {
        for (j, amount) in amounts.into_iter().enumerate() {
            self.reserved[j] = self.reserved[j].checked_sub(amount).ok_or(GameError::Resource)?;
        }
        Ok(())
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, InitSpace)]
pub struct Offer {
    pub status: u8,
    pub kind: u8,
    pub maker: u8,
    pub taker: u8,
    pub provider: u8,
    pub action: u8,
    pub delivery: u16,
    pub nonce: u32,
    pub stage: u8,
    pub gives: [[u16; 3]; 2],
    pub reserve: [[u16; 3]; 2],
    pub job_slot: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, InitSpace)]
pub struct JobReceipt {
    pub slot: u8,
    pub provider: u8,
    pub nonce: u32,
    pub executed: bool,
    pub owner: Pubkey,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, InitSpace)]
pub struct Summary {
    pub complete: bool,
    pub hull: u8,
    pub route: u8,
    pub threat: u8,
    pub guard: u8,
    pub objective: bool,
    pub flags: u8,
    pub actions: [u8; 6],
    pub routes: [u8; 6],
    pub deliveries: [u16; 6],
    pub missing: u8,
    pub rejected: [u8; 6],
    pub inputs: [[u16; 3]; 6],
    pub outputs: [[u16; 3]; 6],
    pub resources: [[u16; 3]; 6],
    pub support: [u16; 6],
    pub delivered: [u16; 6],
    pub forfeited: u8,
    pub deals: [Offer; 3],
    pub deal_count: u8,
    pub jobs: [JobReceipt; 3],
    pub revision: u64,
    pub escort_goal: u8,
    pub escort_progress: u8,
    pub pledged: [u16; 6],
    pub voluntary: [u16; 6],
    pub prices_paid: [[u16; 3]; 6],
    pub prices_received: [[u16; 3]; 6],
}

#[account]
#[derive(InitSpace)]
pub struct GameV3 {
    pub creator: Pubkey,
    pub nonce: [u8; 16],
    pub bump: u8,
    pub rules_hash: [u8; 32],
    pub content_hash: [u8; 32],
    pub count: u8,
    pub phase: u8,
    pub stage: u8,
    pub hull: u8,
    pub deadline: i64,
    pub revision: u64,
    pub roster: u32,
    pub npc_mask: u8,
    pub eligible_mask: u8,
    pub mission: Pubkey,
    pub mission_roster: u32,
    pub flags: u8,
    pub seats: [Seat; 6],
    pub offers: [Offer; 6],
    pub deals: [Offer; 3],
    pub deal_count: u8,
    pub commitments: [[u8; 32]; 6],
    pub committed: u8,
    pub revealed: u8,
    pub actions: [u8; 6],
    pub routes: [u8; 6],
    pub deliveries: [u16; 6],
    // Heap-backed fixed campaign history avoids an oversized SBF deserialize stack frame.
    #[max_len(6)]
    pub history: Vec<Summary>,
    pub scores: [u32; 6],
    pub arrived: bool,
}

impl GameV3 {
    pub fn mask(&self) -> u8 { ((1u16 << self.count) - 1) as u8 }
    pub fn open(&self, phase: u8) -> Result<()> {
        require!(self.phase == phase, GameError::Phase);
        require!(Clock::get()?.unix_timestamp < self.deadline, GameError::Expired);
        Ok(())
    }
    pub fn reset_roster(&mut self) -> Result<()> {
        for p in &mut self.seats { p.ready = false; }
        self.roster = self.roster.checked_add(1).ok_or(GameError::Overflow)?;
        self.mission = Pubkey::default();
        self.eligible_mask = 0;
        self.npc_mask = 0;
        self.bump_revision()
    }
    pub fn bump_revision(&mut self) -> Result<()> {
        self.revision = self.revision.checked_add(1).ok_or(GameError::Overflow)?;
        Ok(())
    }
    pub fn authorize(&mut self, actor: &Pubkey, auth: &Auth, session: bool) -> Result<()> {
        require!(auth.seat < self.count && auth.stage == self.stage, GameError::Stale);
        let p = &mut self.seats[auth.seat as usize];
        require!(auth.owner == p.owner && auth.nonce == p.action_nonce && auth.epoch == p.epoch, GameError::Stale);
        if *actor != p.owner {
            require!(session && *actor == p.session && Clock::get()?.unix_timestamp < p.expires && p.quota > 0, GameError::Authority);
            p.quota -= 1;
        }
        p.action_nonce = p.action_nonce.checked_add(1).ok_or(GameError::Overflow)?;
        self.bump_revision()
    }
    pub fn invariants(&self) -> Result<()> {
        require!((1..=6).contains(&self.count) && self.stage < 6 && self.hull <= 12 && self.deal_count <= self.count / 2 && self.history.len() == 6, GameError::Invalid);
        for p in self.seats.iter().take(self.count as usize) {
            for j in 0..3 { require!(p.reserved[j] <= p.resources[j] && p.resources[j] <= 200, GameError::Resource); }
        }
        Ok(())
    }
}

#[error_code]
pub enum GameError {
    #[msg("Wrong phase")] Phase,
    #[msg("Window expired")] Expired,
    #[msg("Roster or plans not ready")] NotReady,
    #[msg("Too early")] Early,
    #[msg("Invalid arguments")] Invalid,
    #[msg("Stale nonce, stage or epoch")] Stale,
    #[msg("Unauthorized owner or session")] Authority,
    #[msg("Duplicate action")] Duplicate,
    #[msg("No seat, recipe or pact capacity")] Full,
    #[msg("Insufficient free resources")] Resource,
    #[msg("Seal unavailable")] Seal,
    #[msg("Action already bound")] Bound,
    #[msg("Commitment mismatch")] Commitment,
    #[msg("Arithmetic overflow")] Overflow,
    #[msg("Reviewed configuration or terms changed")] Consent,
    #[msg("Mission or paid slot mismatch")] Mission,
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn bounded_layout() { assert!(8 + GameV3::INIT_SPACE <= 8192); println!("V2_MATCH_SERIALIZED_BYTES={}", 8 + GameV3::INIT_SPACE); }
}
