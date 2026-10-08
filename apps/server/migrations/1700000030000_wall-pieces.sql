-- Up Migration

-- A piece may hang on a wall instead of standing on the floor. layer 0 is the floor, 1 the left wall behind the cell,
-- 2 the right wall behind it: a wall piece does not take the floor tile, and the two walls of a corner are two places.
ALTER TABLE placements ADD COLUMN layer smallint NOT NULL DEFAULT 0 CHECK (layer BETWEEN 0 AND 2);
ALTER TABLE placements DROP CONSTRAINT IF EXISTS placements_user_id_i_j_key;
ALTER TABLE placements ADD CONSTRAINT placements_cell_layer_key UNIQUE (user_id, i, j, layer);

-- Down Migration

DELETE FROM placements WHERE layer <> 0;
ALTER TABLE placements DROP CONSTRAINT placements_cell_layer_key;
ALTER TABLE placements ADD CONSTRAINT placements_user_id_i_j_key UNIQUE (user_id, i, j);
ALTER TABLE placements DROP COLUMN layer;
