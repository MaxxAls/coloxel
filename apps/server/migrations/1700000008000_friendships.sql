-- Up Migration

-- Friends (phase 2, step 7). A row is a request from requester to addressee; it becomes
-- a friendship when the addressee accepts. One row per pair, whoever asked first.
CREATE TABLE friendships (
  requester_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  addressee_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  accepted_at  timestamptz,
  PRIMARY KEY (requester_id, addressee_id),
  CHECK (requester_id <> addressee_id)
);
-- A and B cannot hold two rows, one each way.
CREATE UNIQUE INDEX friendships_pair_key ON friendships (LEAST(requester_id, addressee_id), GREATEST(requester_id, addressee_id));
CREATE INDEX friendships_addressee_idx ON friendships (addressee_id);

-- Down Migration

DROP TABLE friendships;
