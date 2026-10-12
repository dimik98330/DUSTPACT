-- Additive identity realm; existing chat sessions retain their exact default scope.
ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS auth_scope text NOT NULL DEFAULT 'chat';
CREATE TABLE IF NOT EXISTS v2_fee_quotes (
 id uuid PRIMARY KEY,
 genesis text NOT NULL,
 fee_payer text NOT NULL,
 owner_address text NOT NULL,
 actor_address text NOT NULL,
 match_address text NOT NULL,
 origin text NOT NULL,
 blockhash text NOT NULL,
 last_valid_height numeric(20,0) NOT NULL CHECK(last_valid_height>=0),
 created_at timestamptz NOT NULL DEFAULT now(),
 quote_until timestamptz NOT NULL,
 issued_at timestamptz,
 message_hash text,
 fee_signature text,
 fee_lamports bigint CHECK(fee_lamports>0 AND fee_lamports<=20000),
 status text NOT NULL DEFAULT 'quoted' CHECK(status IN ('quoted','issued','consumed','expired')),
 CHECK((status='quoted' AND message_hash IS NULL AND fee_signature IS NULL AND fee_lamports IS NULL) OR
       (status<>'quoted' AND message_hash ~ '^[0-9a-f]{64}$' AND fee_signature IS NOT NULL AND fee_lamports IS NOT NULL AND issued_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS v2_fee_day ON v2_fee_quotes(genesis,created_at,status);
CREATE INDEX IF NOT EXISTS v2_fee_owner_day ON v2_fee_quotes(genesis,owner_address,created_at);
CREATE INDEX IF NOT EXISTS v2_fee_match_day ON v2_fee_quotes(genesis,match_address,created_at);
