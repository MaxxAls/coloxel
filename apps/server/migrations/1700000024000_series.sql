-- Up Migration

-- The copies of a limited series (5 or 10) share a series id. Fixed at birth like the rest of the item.
ALTER TABLE items ADD COLUMN series_id uuid;
CREATE INDEX items_series_idx ON items (series_id) WHERE series_id IS NOT NULL;

-- A series has exactly one copy per number: no two copies with the same n/N.
CREATE UNIQUE INDEX items_series_number_idx ON items (series_id, edition_number) WHERE series_id IS NOT NULL;

CREATE OR REPLACE FUNCTION items_lock_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.serial IS DISTINCT FROM OLD.serial
     OR NEW.name IS DISTINCT FROM OLD.name
     OR NEW.description IS DISTINCT FROM OLD.description
     OR NEW.recipe IS DISTINCT FROM OLD.recipe
     OR NEW.creator_id IS DISTINCT FROM OLD.creator_id
     OR NEW.edition_number IS DISTINCT FROM OLD.edition_number
     OR NEW.edition_size IS DISTINCT FROM OLD.edition_size
     OR NEW.series_id IS DISTINCT FROM OLD.series_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'items are immutable (only owner_id may change)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Down Migration

CREATE OR REPLACE FUNCTION items_lock_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.serial IS DISTINCT FROM OLD.serial
     OR NEW.name IS DISTINCT FROM OLD.name
     OR NEW.description IS DISTINCT FROM OLD.description
     OR NEW.recipe IS DISTINCT FROM OLD.recipe
     OR NEW.creator_id IS DISTINCT FROM OLD.creator_id
     OR NEW.edition_number IS DISTINCT FROM OLD.edition_number
     OR NEW.edition_size IS DISTINCT FROM OLD.edition_size
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'items are immutable (only owner_id may change)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP INDEX items_series_number_idx;
DROP INDEX items_series_idx;
ALTER TABLE items DROP COLUMN series_id;
