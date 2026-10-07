-- Up Migration

-- Reports (phase 2, step 8): a player flags another player, a chat message, a creation,
-- an apartment's name or an apartment. The staff panel reads them (step 9).
CREATE TABLE reports (
  id             bigserial PRIMARY KEY,
  reporter_id    uuid NOT NULL REFERENCES users (id),
  kind           text NOT NULL CHECK (kind IN ('player', 'message', 'item', 'apartment_name', 'apartment')),
  -- What is reported: a user id, a chat_log id, an item id or an apartment owner's id, as text.
  target_key     text NOT NULL,
  -- The player who answers for it (the speaker, the creator, the owner): sanctions start from here.
  target_user_id uuid REFERENCES users (id),
  reason         text NOT NULL CHECK (reason IN ('insult', 'harassment', 'inappropriate', 'personal_info', 'spam', 'other')),
  details        text CHECK (details IS NULL OR char_length(details) <= 300),
  -- The thing as it was when reported (a message or a name can change or disappear).
  snapshot       text NOT NULL,
  status         text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'dismissed', 'confirmed')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  handled_by     uuid REFERENCES users (id),
  handled_at     timestamptz,
  note           text CHECK (note IS NULL OR char_length(note) <= 300),
  -- A player reports a given thing once: repeating it adds no weight.
  UNIQUE (reporter_id, kind, target_key)
);
CREATE INDEX reports_open_idx ON reports (status, kind, target_key);
CREATE INDEX reports_target_user_idx ON reports (target_user_id);

-- What the staff decided about a creation. 'hidden': masked for everybody but its owner, for good.
-- 'cleared': looked at and fine, never masked again whatever the reports. No row: the reports decide.
CREATE TABLE item_moderation (
  item_id    uuid PRIMARY KEY REFERENCES items (id),
  state      text NOT NULL CHECK (state IN ('hidden', 'cleared')),
  decided_by uuid NOT NULL REFERENCES users (id),
  decided_at timestamptz NOT NULL DEFAULT now()
);

-- Down Migration

DROP TABLE item_moderation;
DROP TABLE reports;
