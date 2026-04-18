-- ============================================================
-- Migration 007d — Add coverage and contested to route_plays
-- ============================================================

ALTER TABLE route_plays ADD COLUMN IF NOT EXISTS coverage  text    NOT NULL DEFAULT '';
ALTER TABLE route_plays ADD COLUMN IF NOT EXISTS contested boolean NOT NULL DEFAULT false;
