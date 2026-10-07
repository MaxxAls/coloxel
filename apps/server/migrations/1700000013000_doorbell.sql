-- Up Migration

-- A fourth way to open an apartment: on the doorbell. Friends walk in; anybody else rings
-- and the owner decides. An accepted visitor may come in for a while (bell_grants).
ALTER TABLE users DROP CONSTRAINT users_apartment_access_check;
ALTER TABLE users
  ADD CONSTRAINT users_apartment_access_check CHECK (apartment_access IN ('closed', 'bell', 'friends', 'building'));

CREATE TABLE bell_grants (
  owner_id   uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  visitor_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (owner_id, visitor_id)
);

-- Someone the owner showed out cannot come back for a while, whatever the door says.
CREATE TABLE apartment_bans (
  owner_id   uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (owner_id, user_id)
);

-- Down Migration

DROP TABLE apartment_bans;
DROP TABLE bell_grants;
UPDATE users SET apartment_access = 'closed' WHERE apartment_access = 'bell';
ALTER TABLE users DROP CONSTRAINT users_apartment_access_check;
ALTER TABLE users
  ADD CONSTRAINT users_apartment_access_check CHECK (apartment_access IN ('closed', 'friends', 'building'));
