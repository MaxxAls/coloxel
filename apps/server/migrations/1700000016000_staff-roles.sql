-- Up Migration

-- Several kinds of staff, from the host who organises events to the administrator. The roles and
-- what each may do live in code (apps/server/src/staff/roles.ts); the database only says who is what.
ALTER TABLE users DROP CONSTRAINT users_role_check;
-- Until now every staff member could do everything.
UPDATE users SET role = 'administrateur' WHERE role = 'staff';
ALTER TABLE users
  ADD CONSTRAINT users_role_check
  CHECK (role IN ('user', 'animateur', 'moderateur', 'super_moderateur', 'gerant', 'administrateur'));

-- Every change of role, and who made it. `changed_by` is null for the one made from the command line.
CREATE TABLE role_log (
  id         bigserial PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users (id),
  from_role  text NOT NULL,
  to_role    text NOT NULL,
  changed_by uuid REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX role_log_user_idx ON role_log (user_id, id DESC);

-- Events organised by the hosts (animateurs): announced on the website, counted when they took place.
CREATE TABLE events (
  id          bigserial PRIMARY KEY,
  title       text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 80),
  description text NOT NULL CHECK (char_length(description) BETWEEN 1 AND 1000),
  starts_at   timestamptz NOT NULL,
  place       text NOT NULL CHECK (char_length(place) BETWEEN 1 AND 60),
  host_id     uuid NOT NULL REFERENCES users (id),
  status      text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'done', 'cancelled')),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX events_listing_idx ON events (status, starts_at);

-- Down Migration

DROP TABLE events;
DROP TABLE role_log;
ALTER TABLE users DROP CONSTRAINT users_role_check;
UPDATE users SET role = 'staff' WHERE role <> 'user';
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('user', 'staff'));
