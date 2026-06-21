-- Add je_counter to companies for auto-numbered GL journal entries (JE-YYYY-NNNNNN).
-- Safe to re-run — uses IF NOT EXISTS check.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'companies' AND column_name = 'je_counter'
  ) THEN
    ALTER TABLE companies ADD COLUMN je_counter INTEGER NOT NULL DEFAULT 0;
  END IF;
END $$;
