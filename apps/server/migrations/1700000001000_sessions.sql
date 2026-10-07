-- Up Migration

-- Server-side sessions: the cookie holds a random token, only its SHA-256 is
-- stored, so a database leak does not leak usable sessions and logout is real.
CREATE TABLE sessions (
  token_hash bytea PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

-- Down Migration

DROP TABLE sessions;
