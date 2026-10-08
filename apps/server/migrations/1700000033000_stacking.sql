-- Up Migration

-- Small pieces may stand on a surface (a table, a desk, a chest of drawers): z is the height they stand at, in
-- recipe units (0 on the floor). A cell of a wall or of the floor may then hold a piece and what stands on it.
ALTER TABLE placements ADD COLUMN z real NOT NULL DEFAULT 0 CHECK (z >= 0 AND z <= 60);
ALTER TABLE placements DROP CONSTRAINT placements_cell_layer_key;
ALTER TABLE placements ADD CONSTRAINT placements_cell_layer_key UNIQUE (user_id, i, j, layer, z);

-- Down Migration

-- What stood on a surface goes back to the inventory.
DELETE FROM placements WHERE z > 0;
ALTER TABLE placements DROP CONSTRAINT placements_cell_layer_key;
ALTER TABLE placements ADD CONSTRAINT placements_cell_layer_key UNIQUE (user_id, i, j, layer);
ALTER TABLE placements DROP COLUMN z;
