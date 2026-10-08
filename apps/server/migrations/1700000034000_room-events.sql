-- Up Migration

-- An event a player announces in their apartment ("karaoke night!"): listed in the navigator until it ends.
-- One at a time per apartment; the title is filtered like the chat.
CREATE TABLE room_events (
  owner_id   uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  title      text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 60),
  started_at timestamptz NOT NULL DEFAULT now(),
  ends_at    timestamptz NOT NULL
);
CREATE INDEX room_events_ends_at ON room_events (ends_at);

-- Down Migration

DROP TABLE room_events;
