-- Migration: add structured void audit columns to sales_transactions
-- Run once against any database created before this change.
-- Safe to re-run — uses IF NOT EXISTS / column-existence checks.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sales_transactions' AND column_name = 'voided_by_user_id'
  ) THEN
    ALTER TABLE sales_transactions
      ADD COLUMN voided_by_user_id UUID REFERENCES users(user_id),
      ADD COLUMN voided_at         TIMESTAMPTZ,
      ADD COLUMN void_reason       TEXT;
  END IF;
END $$;
