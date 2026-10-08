-- Up Migration

-- What a placed piece says or wears: the text of a sign, the look on a mannequin. Short, and set only through the API.
ALTER TABLE placements ADD COLUMN data text CHECK (data IS NULL OR char_length(data) <= 800);

-- Down Migration

ALTER TABLE placements DROP COLUMN data;
