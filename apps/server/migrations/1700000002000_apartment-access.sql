-- Up Migration

-- Who may see into a player's apartment (and the sprites of what is placed in
-- it). Closed by default: the owner always has access, nobody else.
-- 'friends' has no effect until the friends list exists (phase 2, step 5).
ALTER TABLE users
  ADD COLUMN apartment_access text NOT NULL DEFAULT 'closed'
  CHECK (apartment_access IN ('closed', 'friends', 'building'));

-- Down Migration

ALTER TABLE users DROP COLUMN apartment_access;
