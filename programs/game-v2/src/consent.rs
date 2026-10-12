//! Canonical reviewed consent; all amounts use little-endian, fixed-width fields.
use crate::{GameV2, GameError, Offer};
use anchor_lang::prelude::*;
use solana_sha256_hasher::hashv;

pub fn config_bytes(g: &GameV2, address: &Pubkey) -> Result<Vec<u8>> {
    require!((1..=6).contains(&g.count), GameError::Invalid);
    let mut b = Vec::with_capacity(360);
    b.extend_from_slice(b"DUSTPACT_CONFIG_V2");
    b.extend_from_slice(crate::ID.as_ref());
    b.extend_from_slice(address.as_ref());
    b.extend_from_slice(&g.rules_hash);
    b.extend_from_slice(&g.content_hash);
    b.extend_from_slice(&g.roster.to_le_bytes());
    b.extend_from_slice(&[g.count, g.npc_mask, g.eligible_mask]);
    b.extend_from_slice(g.mission.as_ref());
    b.extend_from_slice(&g.mission_roster.to_le_bytes());
    for p in g.seats.iter().take(g.count as usize) { b.extend_from_slice(p.owner.as_ref()); }
    Ok(b)
}

pub fn config_hash(g: &GameV2, address: &Pubkey) -> Result<[u8; 32]> {
    Ok(hashv(&[&config_bytes(g, address)?]).to_bytes())
}

pub fn terms_bytes(g: &GameV2, address: &Pubkey, p: &Offer) -> Result<Vec<u8>> {
    require!(p.maker < g.count && p.taker < g.count && p.provider < g.count, GameError::Invalid);
    let mut b = Vec::with_capacity(310);
    b.extend_from_slice(b"DUSTPACT_TERMS_V2");
    b.extend_from_slice(crate::ID.as_ref());
    b.extend_from_slice(address.as_ref());
    b.extend_from_slice(&g.rules_hash);
    b.extend_from_slice(&g.content_hash);
    b.extend_from_slice(&config_hash(g, address)?);
    b.extend_from_slice(&[p.stage, p.maker, p.taker, p.provider, p.kind, p.action, p.job_slot]);
    b.extend_from_slice(&p.delivery.to_le_bytes());
    b.extend_from_slice(&p.nonce.to_le_bytes());
    for i in [p.maker, p.taker, p.provider] { b.extend_from_slice(g.seats[i as usize].owner.as_ref()); }
    for side in p.gives { for amount in side { b.extend_from_slice(&amount.to_le_bytes()); } }
    for side in p.reserve { for amount in side { b.extend_from_slice(&amount.to_le_bytes()); } }
    Ok(b)
}

pub fn terms_hash(g: &GameV2, address: &Pubkey, p: &Offer) -> Result<[u8; 32]> {
    Ok(hashv(&[&terms_bytes(g, address, p)?]).to_bytes())
}

pub fn commitment(g: &GameV2, address: &Pubkey, seat: u8, action: u8, route: u8, delivery: u16, salt: &[u8; 32]) -> Result<[u8; 32]> {
    require!(seat < g.count, GameError::Invalid);
    Ok(hashv(&[
        b"DUSTPACT_MOVE_V2", crate::ID.as_ref(), address.as_ref(),
        &g.rules_hash, &g.content_hash, &config_hash(g, address)?,
        &[g.stage, seat], g.seats[seat as usize].owner.as_ref(),
        &[action, route], &delivery.to_le_bytes(), salt,
    ]).to_bytes())
}
