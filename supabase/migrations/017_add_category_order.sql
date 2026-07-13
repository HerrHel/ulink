-- Migration 017: Add order column to categories
-- Enables cross-device category order sync.
-- Existing categories get order = position in current default order (0-based).
-- New categories default to order = 0 (frontend sends proper value via toRemoteRow).

ALTER TABLE categories ADD COLUMN IF NOT EXISTS "order" INTEGER DEFAULT 0;

-- Backfill existing rows: assign order based on the row's position
-- (using ctid as a stable proxy for insertion order when no explicit order exists).
WITH ordered AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY ctid) - 1 AS rn
  FROM categories
)
UPDATE categories SET "order" = ordered.rn
FROM ordered
WHERE categories.id = ordered.id;

-- Index for efficient ordering queries
CREATE INDEX IF NOT EXISTS idx_categories_order ON categories(user_id, "order");
