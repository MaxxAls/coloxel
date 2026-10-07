-- Up Migration

-- Base furniture: free, unlimited, NOT creations. One row per owned copy, pointing
-- at a key of the code-side catalogue (packages/render/src/catalog.ts). No
-- number, no creator, no edition, and the owner never changes: it cannot be traded.
-- `items` and `item_serial` are not touched when someone takes a piece.
CREATE TABLE furniture (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      uuid NOT NULL REFERENCES users (id),
  catalogue_key text NOT NULL CHECK (catalogue_key ~ '^[a-z]{1,30}$'),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX furniture_owner_idx ON furniture (owner_id);

CREATE FUNCTION furniture_lock() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'base furniture is never transferred nor changed';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER furniture_locked
  BEFORE UPDATE ON furniture
  FOR EACH ROW EXECUTE FUNCTION furniture_lock();

-- A placement now holds either a creation or a piece of base furniture, never
-- both, under the same rule: one object per cell of the apartment.
ALTER TABLE placements DROP CONSTRAINT placements_pkey;
ALTER TABLE placements ALTER COLUMN item_id DROP NOT NULL;
ALTER TABLE placements ADD COLUMN furniture_id uuid REFERENCES furniture (id) ON DELETE CASCADE;
ALTER TABLE placements ADD CONSTRAINT placements_one_object CHECK (num_nonnulls(item_id, furniture_id) = 1);
ALTER TABLE placements ADD CONSTRAINT placements_item_key UNIQUE (item_id);
ALTER TABLE placements ADD CONSTRAINT placements_furniture_key UNIQUE (furniture_id);

-- Floor and wallpaper are settings of the apartment, chosen among the catalogue's styles.
ALTER TABLE apartments
  ADD COLUMN floor_style text NOT NULL DEFAULT 'parquet' CHECK (char_length(floor_style) <= 30),
  ADD COLUMN wall_style  text NOT NULL DEFAULT 'violet'  CHECK (char_length(wall_style) <= 30);

-- Down Migration

ALTER TABLE apartments DROP COLUMN wall_style, DROP COLUMN floor_style;
DELETE FROM placements WHERE furniture_id IS NOT NULL;
ALTER TABLE placements DROP CONSTRAINT placements_furniture_key;
ALTER TABLE placements DROP CONSTRAINT placements_item_key;
ALTER TABLE placements DROP CONSTRAINT placements_one_object;
ALTER TABLE placements DROP COLUMN furniture_id;
ALTER TABLE placements ALTER COLUMN item_id SET NOT NULL;
ALTER TABLE placements ADD PRIMARY KEY (item_id);
DROP TRIGGER furniture_locked ON furniture;
DROP FUNCTION furniture_lock();
DROP TABLE furniture;
