-- Up Migration

-- Trades between two players standing in the same room. One open trade per player at a time.
-- Any change of an offer bumps `version` and clears every acceptance and confirmation, so what a
-- player agreed to is always what is on the table.
CREATE TABLE trades (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  a_id         uuid NOT NULL REFERENCES users (id),
  b_id         uuid NOT NULL REFERENCES users (id),
  status       text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'cancelled', 'expired')),
  version      integer NOT NULL DEFAULT 1,
  a_accepted   boolean NOT NULL DEFAULT false,
  b_accepted   boolean NOT NULL DEFAULT false,
  a_confirmed  boolean NOT NULL DEFAULT false,
  b_confirmed  boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  closed_at    timestamptz,
  CHECK (a_id <> b_id),
  CHECK ((status = 'open') = (closed_at IS NULL))
);
-- A player is in at most one open trade, on either side.
CREATE UNIQUE INDEX trades_one_open_a_idx ON trades (a_id) WHERE status = 'open';
CREATE UNIQUE INDEX trades_one_open_b_idx ON trades (b_id) WHERE status = 'open';

-- What each side puts on the table. `live` goes false when the trade ends; while it is true the item
-- belongs to this one trade only.
CREATE TABLE trade_offers (
  trade_id uuid NOT NULL REFERENCES trades (id),
  item_id  uuid NOT NULL REFERENCES items (id),
  giver_id uuid NOT NULL REFERENCES users (id),
  live     boolean NOT NULL DEFAULT true,
  PRIMARY KEY (trade_id, item_id)
);
CREATE UNIQUE INDEX trade_offers_one_live_idx ON trade_offers (item_id) WHERE live;

-- Down Migration

DROP TABLE trade_offers;
DROP TABLE trades;
