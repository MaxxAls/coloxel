-- Up Migration

-- The name its owner gives an apartment (shown in the building and the navigator).
-- Null means "no name yet": the client falls back to the owner's nickname.
ALTER TABLE apartments
  ADD COLUMN name text CHECK (name IS NULL OR char_length(name) BETWEEN 1 AND 30);

-- Down Migration

ALTER TABLE apartments DROP COLUMN name;
