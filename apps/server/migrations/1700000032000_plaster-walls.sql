-- Up Migration

-- New apartments start with grey plaster walls (packages/render DEFAULT_WALL), a quieter backdrop for the furniture.
-- The building's free apartments get them too; apartments that belong to someone keep the walls they have.
ALTER TABLE apartments ALTER COLUMN wall_style SET DEFAULT 'platre';
UPDATE apartments SET wall_style = 'platre' WHERE owner_id IS NULL AND wall_style = 'violet';

-- Down Migration

UPDATE apartments SET wall_style = 'violet' WHERE owner_id IS NULL AND wall_style = 'platre';
ALTER TABLE apartments ALTER COLUMN wall_style SET DEFAULT 'violet';
