-- Up Migration

-- Challenges (defis): series of goals with tiers, each tier paying Pixels once. The series
-- themselves live in code (apps/server/src/quests/definitions.ts); only the player's
-- progress is stored.
CREATE TABLE quest_progress (
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  series     text NOT NULL,
  count      integer NOT NULL DEFAULT 0 CHECK (count >= 0),
  -- How many tiers were reached and paid: the next one to reach is tiers[tier].
  tier       smallint NOT NULL DEFAULT 0 CHECK (tier >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, series)
);

-- "Counts once per thing": the first placement of an object, the first visit to an apartment…
CREATE TABLE quest_marks (
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  event   text NOT NULL,
  ref     text NOT NULL,
  PRIMARY KEY (user_id, event, ref)
);

-- Down Migration

DROP TABLE quest_marks;
DROP TABLE quest_progress;
