-- Up Migration

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL,
  password_hash text NOT NULL,
  nickname      text NOT NULL,
  birth_date    date NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email));
CREATE UNIQUE INDEX users_nickname_key ON users (lower(nickname));

-- Gapless item numbering. A single row, locked by UPDATE ... RETURNING inside
-- the creation transaction, so a rollback never burns a number (unlike a
-- PostgreSQL SEQUENCE) and concurrent creations are serialized.
CREATE TABLE item_serial (
  id         smallint PRIMARY KEY CHECK (id = 1),
  last_value integer NOT NULL CHECK (last_value >= 0)
);
INSERT INTO item_serial (id, last_value) VALUES (1, 0);

CREATE TABLE items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  serial         integer NOT NULL UNIQUE CHECK (serial > 0),
  name           text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  description    text NOT NULL CHECK (char_length(description) BETWEEN 3 AND 200),
  recipe         jsonb NOT NULL,
  creator_id     uuid NOT NULL REFERENCES users (id),
  owner_id       uuid NOT NULL REFERENCES users (id),
  edition_number smallint NOT NULL DEFAULT 1 CHECK (edition_number >= 1),
  edition_size   smallint NOT NULL DEFAULT 1 CHECK (edition_size >= edition_number),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX items_owner_idx ON items (owner_id);

-- An item is immutable once created: only its owner may change (transfers).
CREATE FUNCTION items_lock_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.serial IS DISTINCT FROM OLD.serial
     OR NEW.name IS DISTINCT FROM OLD.name
     OR NEW.description IS DISTINCT FROM OLD.description
     OR NEW.recipe IS DISTINCT FROM OLD.recipe
     OR NEW.creator_id IS DISTINCT FROM OLD.creator_id
     OR NEW.edition_number IS DISTINCT FROM OLD.edition_number
     OR NEW.edition_size IS DISTINCT FROM OLD.edition_size
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'items are immutable (only owner_id may change)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER items_immutable
  BEFORE UPDATE ON items
  FOR EACH ROW EXECUTE FUNCTION items_lock_immutable();

CREATE FUNCTION items_forbid_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'items cannot be deleted';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER items_no_delete
  BEFORE DELETE ON items
  FOR EACH ROW EXECUTE FUNCTION items_forbid_delete();

-- One placement per item, one item per cell (8 x 8 room, phase 1).
CREATE TABLE placements (
  item_id   uuid PRIMARY KEY REFERENCES items (id),
  user_id   uuid NOT NULL REFERENCES users (id),
  i         smallint NOT NULL CHECK (i BETWEEN 0 AND 7),
  j         smallint NOT NULL CHECK (j BETWEEN 0 AND 7),
  placed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, i, j)
);

-- Journal of creation charges: negative delta = spent, positive = refunded
-- or refilled. day is the Paris calendar day the entry counts for (daily
-- refill at Paris midnight). Balance = sum(delta) of the current day.
CREATE TABLE creation_charges (
  id         bigserial PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users (id),
  delta      smallint NOT NULL CHECK (delta <> 0),
  reason     text NOT NULL CHECK (reason IN ('spend', 'refund', 'refill')),
  day        date NOT NULL,
  item_id    uuid REFERENCES items (id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX creation_charges_user_day_idx ON creation_charges (user_id, day);

-- Down Migration

DROP TABLE creation_charges;
DROP TABLE placements;
DROP TRIGGER items_no_delete ON items;
DROP TRIGGER items_immutable ON items;
DROP FUNCTION items_forbid_delete();
DROP FUNCTION items_lock_immutable();
DROP TABLE items;
DROP TABLE item_serial;
DROP TABLE users;
