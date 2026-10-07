-- Up Migration

-- Lamps, the fireplace, the TV and the other pieces that give light can be switched off.
-- The state belongs to the placed piece: taking it back and placing it again lights it again.
ALTER TABLE placements ADD COLUMN lit boolean NOT NULL DEFAULT true;

-- Down Migration

ALTER TABLE placements DROP COLUMN lit;
