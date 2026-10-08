-- Up Migration

-- A companion's care: when it last ate and played, and what it has learnt. Hunger and joy are worked out when read.
ALTER TABLE pets ADD COLUMN fed_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE pets ADD COLUMN played_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE pets ADD COLUMN xp integer NOT NULL DEFAULT 0 CHECK (xp >= 0);

-- Down Migration

ALTER TABLE pets DROP COLUMN xp;
ALTER TABLE pets DROP COLUMN played_at;
ALTER TABLE pets DROP COLUMN fed_at;
