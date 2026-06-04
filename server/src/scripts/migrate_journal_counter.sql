-- Migration: add journal_counter to companies for auto-numbered journal entries
-- Safe to re-run — uses IF NOT EXISTS check.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'companies' AND column_name = 'journal_counter'
  ) THEN
    ALTER TABLE companies ADD COLUMN journal_counter INTEGER NOT NULL DEFAULT 0;
  END IF;
END $$;
