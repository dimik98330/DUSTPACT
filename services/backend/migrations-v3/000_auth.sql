-- Shared identity services used by the V2 API and fee service.
CREATE TABLE IF NOT EXISTS wallet_profiles(address text PRIMARY KEY,display_name text,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS auth_nonces(id uuid PRIMARY KEY,address text NOT NULL,origin text NOT NULL,cluster text NOT NULL,message text NOT NULL,expires_at timestamptz NOT NULL,used_at timestamptz);
CREATE INDEX IF NOT EXISTS auth_nonces_expiry ON auth_nonces(expires_at);
CREATE TABLE IF NOT EXISTS auth_sessions(token_hash text PRIMARY KEY,address text NOT NULL,origin text NOT NULL,csrf_token text NOT NULL,expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
