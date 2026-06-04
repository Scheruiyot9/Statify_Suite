-- Migration: add must_reset_password flag to users
-- Run once. Safe to re-run — uses IF NOT EXISTS guard.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'must_reset_password'
  ) THEN
    ALTER TABLE users ADD COLUMN must_reset_password BOOLEAN NOT NULL DEFAULT FALSE;
  END IF;
END $$;
