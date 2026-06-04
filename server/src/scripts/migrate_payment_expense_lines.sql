-- Migration: add expense_lines JSONB to supplier_payments for multi-line direct expenses
-- Safe to re-run.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'supplier_payments' AND column_name = 'expense_lines'
  ) THEN
    ALTER TABLE supplier_payments
      ADD COLUMN expense_lines JSONB NOT NULL DEFAULT '[]';
  END IF;
END $$;
