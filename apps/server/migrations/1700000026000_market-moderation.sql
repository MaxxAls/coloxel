-- Up Migration

-- Offers and trades can be reported like everything else.
ALTER TABLE reports DROP CONSTRAINT reports_kind_check;
ALTER TABLE reports ADD CONSTRAINT reports_kind_check CHECK (kind IN ('player', 'message', 'item', 'apartment_name', 'apartment', 'listing', 'trade'));

-- Things the market noticed and the staff should look at. They never block anything by themselves.
CREATE TABLE fraud_flags (
  id            bigserial PRIMARY KEY,
  kind          text NOT NULL CHECK (kind IN ('back_and_forth', 'new_account_spree', 'price_outlier', 'one_sided_trade')),
  user_id       uuid NOT NULL REFERENCES users (id),
  other_user_id uuid REFERENCES users (id),
  item_id       uuid REFERENCES items (id),
  detail        text NOT NULL CHECK (char_length(detail) <= 300),
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'handled')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  handled_by    uuid REFERENCES users (id),
  handled_at    timestamptz
);
CREATE INDEX fraud_flags_open_idx ON fraud_flags (status, id DESC);
CREATE INDEX fraud_flags_user_idx ON fraud_flags (user_id);

-- A player the staff shut out of the market: no buying, selling, trading or withdrawing, so the
-- balance is frozen in practice (Coloxs can only be spent there). Until `expires_at`, or until lifted.
CREATE TABLE market_blocks (
  user_id    uuid PRIMARY KEY REFERENCES users (id),
  reason     text NOT NULL CHECK (char_length(reason) BETWEEN 3 AND 300),
  blocked_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz
);

-- A sale the staff undid. The sale line stays; it is stamped, never deleted.
ALTER TABLE market_sales
  ADD COLUMN reversed_at   timestamptz,
  ADD COLUMN reversed_by   uuid REFERENCES users (id),
  ADD COLUMN reversal_note text CHECK (char_length(reversal_note) <= 300);

ALTER TABLE item_owners DROP CONSTRAINT item_owners_kind_check;
ALTER TABLE item_owners ADD CONSTRAINT item_owners_kind_check CHECK (kind IN ('creation', 'sale', 'trade', 'reversal'));

-- Down Migration

DELETE FROM item_owners WHERE kind = 'reversal';
ALTER TABLE item_owners DROP CONSTRAINT item_owners_kind_check;
ALTER TABLE item_owners ADD CONSTRAINT item_owners_kind_check CHECK (kind IN ('creation', 'sale', 'trade'));
ALTER TABLE market_sales DROP COLUMN reversal_note, DROP COLUMN reversed_by, DROP COLUMN reversed_at;
DROP TABLE market_blocks;
DROP TABLE fraud_flags;
DELETE FROM reports WHERE kind IN ('listing', 'trade');
ALTER TABLE reports DROP CONSTRAINT reports_kind_check;
ALTER TABLE reports ADD CONSTRAINT reports_kind_check CHECK (kind IN ('player', 'message', 'item', 'apartment_name', 'apartment'));
