-- Up Migration

-- A piece may cover several tiles. (i, j) stays the first tile (smallest i and j);
-- w and h are the footprint as placed, after the quarter turns: tiles along i and along j.
-- The server sets them from the recipe and the rotation; overlaps are refused in the
-- placement transaction (the UNIQUE (user_id, i, j) still guards the first tile).
ALTER TABLE placements ADD COLUMN w smallint NOT NULL DEFAULT 1 CHECK (w BETWEEN 1 AND 3);
ALTER TABLE placements ADD COLUMN h smallint NOT NULL DEFAULT 1 CHECK (h BETWEEN 1 AND 3);

-- Down Migration

ALTER TABLE placements DROP COLUMN h;
ALTER TABLE placements DROP COLUMN w;
