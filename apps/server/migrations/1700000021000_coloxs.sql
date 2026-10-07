-- Up Migration

-- Coloxs are the premium currency. The balance on users is only ever moved by the ledger:
-- inserting a ledger row applies its delta (trigger), and nothing else may touch the column.
-- So the sum of the ledger equals the balance by construction, and a balance cannot go below zero.
ALTER TABLE users ADD COLUMN coloxs integer NOT NULL DEFAULT 0 CHECK (coloxs >= 0);

CREATE TABLE colox_ledger (
  id         bigserial PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  delta      integer NOT NULL CHECK (delta <> 0),
  kind       text NOT NULL CHECK (kind IN ('pack', 'purchase', 'sale', 'royalty', 'refund', 'chargeback', 'staff')),
  detail     text CHECK (char_length(detail) <= 80),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX colox_ledger_user_idx ON colox_ledger (user_id, created_at);

CREATE FUNCTION colox_ledger_apply() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE users SET coloxs = coloxs + NEW.delta WHERE id = NEW.user_id;
  RETURN NEW;
END $$;
CREATE TRIGGER colox_ledger_apply AFTER INSERT ON colox_ledger
  FOR EACH ROW EXECUTE FUNCTION colox_ledger_apply();

-- A ledger line is never rewritten: a mistake is fixed by a reversing line.
CREATE FUNCTION colox_ledger_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'colox_ledger lines cannot be modified';
END $$;
CREATE TRIGGER colox_ledger_frozen BEFORE UPDATE ON colox_ledger
  FOR EACH ROW EXECUTE FUNCTION colox_ledger_frozen();

-- Only the ledger trigger (nesting depth 2) may change a balance.
CREATE FUNCTION users_coloxs_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'users.coloxs can only change through colox_ledger';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER users_coloxs_guard BEFORE UPDATE OF coloxs ON users
  FOR EACH ROW WHEN (OLD.coloxs IS DISTINCT FROM NEW.coloxs) EXECUTE FUNCTION users_coloxs_guard();

-- Down Migration

DROP TRIGGER users_coloxs_guard ON users;
DROP FUNCTION users_coloxs_guard();
DROP TABLE colox_ledger;
DROP FUNCTION colox_ledger_frozen();
DROP FUNCTION colox_ledger_apply();
ALTER TABLE users DROP COLUMN coloxs;
