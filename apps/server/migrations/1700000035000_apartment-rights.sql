-- Up Migration

-- An owner lets a friend arrange their apartment: move and turn the pieces already placed. Nothing else: the pieces
-- stay the owner's, only the owner places from the inventory or puts away. Checked again at each use (still friends).
CREATE TABLE apartment_rights (
  owner_id   uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, user_id),
  CHECK (owner_id <> user_id)
);

-- Down Migration

DROP TABLE apartment_rights;
