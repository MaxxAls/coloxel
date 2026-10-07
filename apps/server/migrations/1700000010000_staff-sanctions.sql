-- Up Migration

-- Staff panel (phase 2, step 9). The role is given by hand, in the database (see `npm run staff:grant`).
ALTER TABLE users
  ADD COLUMN role text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'staff'));

-- What the staff did to a player, and who did it. Rows are never deleted: lifting a sanction
-- stamps it (revoked_at, revoked_by), so the history of a player stays whole.
--   warning     a message the player must read; no other effect
--   mute        the player's chat messages are shown to nobody, until expires_at
--   suspension  the player cannot be signed in, until expires_at
--   ban         the player cannot be signed in, for good
CREATE TABLE sanctions (
  id         bigserial PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users (id),
  kind       text NOT NULL CHECK (kind IN ('warning', 'mute', 'suspension', 'ban')),
  reason     text NOT NULL CHECK (char_length(reason) BETWEEN 3 AND 300),
  issued_by  uuid NOT NULL REFERENCES users (id),
  -- The report this sanction answers, when it started from one.
  report_id  bigint REFERENCES reports (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid REFERENCES users (id),
  -- Warnings: when the player read it.
  seen_at    timestamptz,
  CHECK ((kind IN ('mute', 'suspension')) = (expires_at IS NOT NULL))
);
CREATE INDEX sanctions_user_idx ON sanctions (user_id, created_at DESC);
-- Looked up on every request of a signed-in player and every chat message: only the ones that can still apply.
CREATE INDEX sanctions_live_idx ON sanctions (user_id, kind) WHERE revoked_at IS NULL;

-- Down Migration

DROP TABLE sanctions;
ALTER TABLE users DROP COLUMN role;
