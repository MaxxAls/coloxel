-- Up Migration

-- A placed piece can face another way: quarter turns, 0 to 3. The state belongs to the placed piece.
ALTER TABLE placements ADD COLUMN rot smallint NOT NULL DEFAULT 0 CHECK (rot BETWEEN 0 AND 3);

-- Down Migration

ALTER TABLE placements DROP COLUMN rot;
