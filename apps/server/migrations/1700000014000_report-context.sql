-- Up Migration

-- What was said in the room around a reported message or player, as the report was made:
-- the staff reads a message with what came before it.
ALTER TABLE reports ADD COLUMN context text CHECK (context IS NULL OR char_length(context) <= 2000);

-- Down Migration

ALTER TABLE reports DROP COLUMN context;
