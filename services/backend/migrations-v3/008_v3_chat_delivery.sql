-- Additive V2 only. Legacy messages and protocols are unchanged.
ALTER TABLE v3_chat_messages ADD COLUMN IF NOT EXISTS client_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS v3_chat_delivery_once
  ON v3_chat_messages(room_id,address,client_id);
