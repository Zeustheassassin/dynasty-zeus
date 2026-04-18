-- ============================================================
-- Migration 007e — Add was_open (SRVC separation success) to route_plays
-- ============================================================

ALTER TABLE route_plays ADD COLUMN IF NOT EXISTS was_open boolean NOT NULL DEFAULT false;
