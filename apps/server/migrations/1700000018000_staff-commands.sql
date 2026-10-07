-- Up Migration

-- What the staff did with commands typed in a room (":ha", ":kick", ":mute"…), for the managers to read.
CREATE TABLE staff_log (
  id         bigserial PRIMARY KEY,
  staff_id   uuid NOT NULL REFERENCES users (id),
  command    text NOT NULL CHECK (char_length(command) <= 30),
  args       text NOT NULL CHECK (char_length(args) <= 400),
  room       text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX staff_log_idx ON staff_log (id DESC);
CREATE INDEX staff_log_staff_idx ON staff_log (staff_id, id DESC);

-- Words the staff added to the chat filter, on top of the ones in the code.
CREATE TABLE banned_words (
  word       text PRIMARY KEY CHECK (word ~ '^[a-z0-9]{3,30}$'),
  added_by   uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Down Migration

DROP TABLE banned_words;
DROP TABLE staff_log;
