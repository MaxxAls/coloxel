-- Up Migration

-- The grid of a room grows from 8 x 8 to 16 x 16 cells (packages/world N). An apartment keeps its shape where it was:
-- its old 8 x 8 cells become the back corner of the new grid (rows 0 to 7, columns 0 to 7), the rest has no floor.
-- Placements keep their cells, so nothing moves. The owner may then grow the room with the shape editor.
UPDATE apartments
SET layout = jsonb_build_object(
  'cells',
  (SELECT string_agg(substr(layout->>'cells', r * 8 + 1, 8) || 'xxxxxxxx', '' ORDER BY r) FROM generate_series(0, 7) AS r)
    || repeat('x', 128),
  'door', layout->'door'
)
WHERE length(layout->>'cells') = 64;

-- New apartments: a 10 x 10 room in the back corner, the door on the front left edge.
ALTER TABLE apartments ALTER COLUMN layout SET DEFAULT
  '{"cells":"0000000000xxxxxx0000000000xxxxxx0000000000xxxxxx0000000000xxxxxx0000000000xxxxxx0000000000xxxxxx0000000000xxxxxx0000000000xxxxxx0000000000xxxxxx0000000000xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx","door":{"i":9,"j":0}}';

-- The building's free apartments (made in advance, nobody lives there yet) get the new room too.
UPDATE apartments SET layout = DEFAULT WHERE owner_id IS NULL;

-- Pieces may now stand anywhere on the 16 x 16 grid.
ALTER TABLE placements DROP CONSTRAINT placements_i_check, DROP CONSTRAINT placements_j_check;
ALTER TABLE placements ADD CONSTRAINT placements_i_check CHECK (i BETWEEN 0 AND 15), ADD CONSTRAINT placements_j_check CHECK (j BETWEEN 0 AND 15);

-- Down Migration

-- Pieces outside the old grid go back to the inventory (a piece without a placement is in the inventory).
DELETE FROM placements WHERE i > 7 OR j > 7 OR i + w - 1 > 7 OR j + h - 1 > 7;
ALTER TABLE placements DROP CONSTRAINT placements_i_check, DROP CONSTRAINT placements_j_check;
ALTER TABLE placements ADD CONSTRAINT placements_i_check CHECK (i BETWEEN 0 AND 7), ADD CONSTRAINT placements_j_check CHECK (j BETWEEN 0 AND 7);

-- Back to 8 x 8: only the back corner is kept. A door outside it goes back to the front left corner.
UPDATE apartments
SET layout = jsonb_build_object(
  'cells',
  (SELECT string_agg(substr(layout->>'cells', r * 16 + 1, 8), '' ORDER BY r) FROM generate_series(0, 7) AS r),
  'door',
  CASE WHEN (layout->'door'->>'i')::int < 8 AND (layout->'door'->>'j')::int < 8 THEN layout->'door' ELSE '{"i":7,"j":0}'::jsonb END
)
WHERE length(layout->>'cells') = 256;

ALTER TABLE apartments ALTER COLUMN layout SET DEFAULT
  '{"cells":"0000000000000000000000000000000000000000000000000000000000000000","door":{"i":7,"j":0}}';
