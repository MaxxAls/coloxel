-- Up Migration

-- The shape of an apartment: which cells have a floor, at what level, and where the door is.
-- 64 characters, row i then column j: x = no floor, 0 to 4 = level. Validated by the server (packages/world).
ALTER TABLE apartments ADD COLUMN layout jsonb NOT NULL
  DEFAULT '{"cells":"0000000000000000000000000000000000000000000000000000000000000000","door":{"i":7,"j":0}}';

-- Down Migration

ALTER TABLE apartments DROP COLUMN layout;
