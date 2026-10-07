-- Up Migration

-- The avatar of a player is a look (plain numbers, validated by packages/render/src/look.ts).
-- Null means "never customised": the server derives the starting look from the player's id.
-- Pixels are the free currency: a welcome grant, a daily reward, codes. Every change goes
-- through the ledger, in the same transaction as what it pays for.
ALTER TABLE users
  ADD COLUMN look          jsonb,
  ADD COLUMN pixels        integer NOT NULL DEFAULT 100 CHECK (pixels >= 0),
  ADD COLUMN last_daily    date,
  ADD COLUMN active_pet_id uuid;

-- Pieces of clothing bought in the shop. The free basics are not stored: everybody owns them.
CREATE TABLE wardrobe (
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  slot        text NOT NULL CHECK (slot IN ('hair', 'top', 'bottom', 'shoes', 'hat', 'glasses', 'extra')),
  piece       smallint NOT NULL CHECK (piece >= 0),
  acquired_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, slot, piece)
);

CREATE TABLE pixel_ledger (
  id         bigserial PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  delta      integer NOT NULL CHECK (delta <> 0),
  reason     text NOT NULL CHECK (char_length(reason) <= 80),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pixel_ledger_user_idx ON pixel_ledger (user_id, created_at);

-- Companions. Species and colour are indexes into packages/render/src/pets.ts.
CREATE TABLE pets (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id   uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  species    text NOT NULL CHECK (species ~ '^[a-z]{1,20}$'),
  color      smallint NOT NULL CHECK (color BETWEEN 0 AND 15),
  name       text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 20),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pets_owner_idx ON pets (owner_id);
ALTER TABLE users
  ADD CONSTRAINT users_active_pet_fk FOREIGN KEY (active_pet_id) REFERENCES pets (id) ON DELETE SET NULL;

-- Codes to redeem for Pixels, once per player.
CREATE TABLE redeem_codes (
  code       text PRIMARY KEY CHECK (code ~ '^[A-Z0-9]{3,24}$'),
  pixels     integer NOT NULL CHECK (pixels > 0),
  expires_at timestamptz
);
CREATE TABLE redeem_uses (
  code    text NOT NULL REFERENCES redeem_codes (code) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  used_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (code, user_id)
);
INSERT INTO redeem_codes (code, pixels) VALUES ('BIENVENUE', 100);

-- Down Migration

DROP TABLE redeem_uses;
DROP TABLE redeem_codes;
ALTER TABLE users DROP CONSTRAINT users_active_pet_fk;
DROP TABLE pets;
DROP TABLE pixel_ledger;
DROP TABLE wardrobe;
ALTER TABLE users DROP COLUMN active_pet_id, DROP COLUMN last_daily, DROP COLUMN pixels, DROP COLUMN look;
