-- Up Migration

-- The building: a fixed set of apartments stacked on floors, one per player.
-- Floors count upwards from the first floor above the hall; slot is the
-- position on the floor, left to right. An apartment is assigned at sign-up.
CREATE TABLE apartments (
  id       smallint PRIMARY KEY,
  floor    smallint NOT NULL CHECK (floor >= 1),
  slot     smallint NOT NULL CHECK (slot >= 0),
  owner_id uuid UNIQUE REFERENCES users (id) ON DELETE SET NULL,
  UNIQUE (floor, slot)
);

-- First building: 30 apartments, 5 per floor, 6 floors.
INSERT INTO apartments (id, floor, slot)
SELECT n, (n - 1) / 5 + 1, (n - 1) % 5 FROM generate_series(1, 30) AS n;

-- Players who signed up before the building existed move in, oldest first.
UPDATE apartments a
   SET owner_id = u.id
  FROM (SELECT id, row_number() OVER (ORDER BY created_at, id) AS rn FROM users) u
 WHERE a.id = u.rn;

-- Down Migration

DROP TABLE apartments;
