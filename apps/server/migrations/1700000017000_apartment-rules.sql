-- Up Migration

-- Mechanisms: the reactions the owner of an apartment sets up ("when somebody steps here, light that lamp").
-- A rule is plain data, checked by apps/server/src/rules/schema.ts when saved and again when read.
CREATE TABLE apartment_rules (
  owner_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  position smallint NOT NULL CHECK (position >= 0),
  rule     jsonb NOT NULL,
  PRIMARY KEY (owner_id, position)
);

-- Down Migration

DROP TABLE apartment_rules;
