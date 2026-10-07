-- Up Migration

-- VIP Atelier. Until payment is open, the staff gives it by hand (npm run vip:grant); later the payment
-- provider's signed events will write the same two things: the end date and a journal line.
ALTER TABLE users ADD COLUMN vip_until timestamptz;

CREATE TABLE vip_log (
  id         bigserial PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- Days added (negative when taken back).
  days       integer NOT NULL CHECK (days <> 0),
  source     text NOT NULL CHECK (source IN ('staff', 'payment')),
  detail     text CHECK (char_length(detail) <= 80),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX vip_log_user_idx ON vip_log (user_id, created_at);

-- Extra daily charges for VIPs, as a line of their own so it can be given the day a player becomes VIP.
ALTER TABLE creation_charges DROP CONSTRAINT creation_charges_reason_check;
ALTER TABLE creation_charges ADD CONSTRAINT creation_charges_reason_check CHECK (reason IN ('spend', 'refund', 'refill', 'vip_bonus'));

-- Down Migration

DELETE FROM creation_charges WHERE reason = 'vip_bonus';
ALTER TABLE creation_charges DROP CONSTRAINT creation_charges_reason_check;
ALTER TABLE creation_charges ADD CONSTRAINT creation_charges_reason_check CHECK (reason IN ('spend', 'refund', 'refill'));
DROP TABLE vip_log;
ALTER TABLE users DROP COLUMN vip_until;
