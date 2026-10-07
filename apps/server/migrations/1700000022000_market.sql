-- Up Migration

-- Who owned each creation, and how it changed hands. The first line of every item is its creation.
CREATE TABLE item_owners (
  id         bigserial PRIMARY KEY,
  item_id    uuid NOT NULL REFERENCES items (id),
  from_user  uuid REFERENCES users (id),
  to_user    uuid NOT NULL REFERENCES users (id),
  kind       text NOT NULL CHECK (kind IN ('creation', 'sale', 'trade')),
  -- Coloxs paid, for a sale.
  price      integer CHECK (price IS NULL OR price > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX item_owners_item_idx ON item_owners (item_id, id);

INSERT INTO item_owners (item_id, from_user, to_user, kind, created_at)
  SELECT id, NULL, creator_id, 'creation', created_at FROM items;

CREATE FUNCTION items_record_creation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO item_owners (item_id, from_user, to_user, kind, created_at) VALUES (NEW.id, NULL, NEW.creator_id, 'creation', NEW.created_at);
  RETURN NEW;
END $$;
CREATE TRIGGER items_record_creation AFTER INSERT ON items FOR EACH ROW EXECUTE FUNCTION items_record_creation();

-- Offers on the market. While 'active' the item is in escrow: not placed, not tradable, not listed twice.
CREATE TABLE listings (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id    uuid NOT NULL REFERENCES items (id),
  seller_id  uuid NOT NULL REFERENCES users (id),
  price      integer NOT NULL CHECK (price > 0),
  status     text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'sold', 'cancelled', 'expired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  closed_at  timestamptz,
  CHECK ((status = 'active') = (closed_at IS NULL))
);
-- One live offer per item: this index arbitrates two requests listing the same item.
CREATE UNIQUE INDEX listings_one_active_idx ON listings (item_id) WHERE status = 'active';
CREATE INDEX listings_active_idx ON listings (price) WHERE status = 'active';
CREATE INDEX listings_seller_idx ON listings (seller_id, status);

-- A creation on sale cannot be placed. The share lock waits for a listing being made at the same moment,
-- then the check sees it: listing and placing can never both succeed.
CREATE FUNCTION placements_not_listed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.item_id IS NOT NULL THEN
    PERFORM 1 FROM items WHERE id = NEW.item_id FOR SHARE;
    IF EXISTS (SELECT 1 FROM listings WHERE item_id = NEW.item_id AND status = 'active') THEN
      RAISE EXCEPTION 'item is on the market' USING ERRCODE = 'P0409';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER placements_not_listed BEFORE INSERT OR UPDATE ON placements FOR EACH ROW EXECUTE FUNCTION placements_not_listed();

-- What every sale paid and where it went. The commission leaves the economy for good.
CREATE TABLE market_sales (
  id         bigserial PRIMARY KEY,
  listing_id uuid NOT NULL UNIQUE REFERENCES listings (id),
  item_id    uuid NOT NULL REFERENCES items (id),
  seller_id  uuid NOT NULL REFERENCES users (id),
  buyer_id   uuid NOT NULL REFERENCES users (id),
  creator_id uuid NOT NULL REFERENCES users (id),
  price      integer NOT NULL CHECK (price > 0),
  commission integer NOT NULL CHECK (commission >= 0),
  royalty    integer NOT NULL CHECK (royalty >= 0),
  seller_net integer NOT NULL CHECK (seller_net > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (price = commission + royalty + seller_net)
);
CREATE INDEX market_sales_item_idx ON market_sales (item_id);

-- Down Migration

DROP TABLE market_sales;
DROP TRIGGER placements_not_listed ON placements;
DROP FUNCTION placements_not_listed();
DROP TABLE listings;
DROP TRIGGER items_record_creation ON items;
DROP FUNCTION items_record_creation();
DROP TABLE item_owners;
