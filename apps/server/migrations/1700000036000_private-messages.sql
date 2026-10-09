-- Up Migration

-- Private messages between friends. Every message is kept: the staff reads what is reported. The text was filtered
-- before it was stored, like the chat. A player may close their messages (pm_closed).
CREATE TABLE private_messages (
  id         bigserial PRIMARY KEY,
  from_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  to_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  text       text NOT NULL CHECK (char_length(text) BETWEEN 1 AND 300),
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at    timestamptz,
  CHECK (from_id <> to_id)
);
CREATE INDEX private_messages_unread ON private_messages (to_id, read_at);
CREATE INDEX private_messages_pair ON private_messages (from_id, to_id, created_at);

ALTER TABLE users ADD COLUMN pm_closed boolean NOT NULL DEFAULT false;

-- A private message can be reported, by the one who received it.
ALTER TABLE reports DROP CONSTRAINT reports_kind_check;
ALTER TABLE reports ADD CONSTRAINT reports_kind_check CHECK (kind IN ('player', 'message', 'item', 'apartment_name', 'apartment', 'listing', 'trade', 'private'));

-- Down Migration

DELETE FROM reports WHERE kind = 'private';
ALTER TABLE reports DROP CONSTRAINT reports_kind_check;
ALTER TABLE reports ADD CONSTRAINT reports_kind_check CHECK (kind IN ('player', 'message', 'item', 'apartment_name', 'apartment', 'listing', 'trade'));
ALTER TABLE users DROP COLUMN pm_closed;
DROP TABLE private_messages;
