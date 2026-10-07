-- Up Migration

-- Every chat message ever sent, blocked or not (phase 2, step 6): who said what, where, when.
-- `room` is 'hall' or 'apartment:<owner id>'. A blocked message was shown to nobody but its author;
-- `reason` then holds what the filter (or the rate limiter) found.
CREATE TABLE chat_log (
  id         bigserial PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users (id),
  room       text NOT NULL,
  text       text NOT NULL,
  blocked    boolean NOT NULL DEFAULT false,
  reason     text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX chat_log_user_idx ON chat_log (user_id, id DESC);
CREATE INDEX chat_log_room_idx ON chat_log (room, id DESC);

-- Down Migration

DROP TABLE chat_log;
