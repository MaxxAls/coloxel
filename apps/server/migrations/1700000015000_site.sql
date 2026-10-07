-- Up Migration

-- The website of the game (news, rankings, profiles) and its switches.
CREATE TABLE announcements (
  id         bigserial PRIMARY KEY,
  title      text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 80),
  body       text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  -- Pinned announcements stay at the top.
  pinned     boolean NOT NULL DEFAULT false,
  -- A draft is only seen by the staff.
  published  boolean NOT NULL DEFAULT true,
  author_id  uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX announcements_listing_idx ON announcements (published, pinned DESC, id DESC);

-- Switches the staff can flip without restarting the server (maintenance mode).
CREATE TABLE site_settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_by uuid REFERENCES users (id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO site_settings (key, value) VALUES ('maintenance', 'false');

-- Down Migration

DROP TABLE site_settings;
DROP TABLE announcements;
