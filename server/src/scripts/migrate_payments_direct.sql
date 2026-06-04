-- Migration: payment numbering + direct expense payments
-- Safe to re-run.

DO $$
BEGIN
  -- payment_counter on companies (for auto-numbering)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'companies' AND column_name = 'payment_counter'
  ) THEN
    ALTER TABLE companies ADD COLUMN payment_counter INTEGER NOT NULL DEFAULT 0;
  END IF;

  -- payment_number on supplier_payments
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'supplier_payments' AND column_name = 'payment_number'
  ) THEN
    ALTER TABLE supplier_payments ADD COLUMN payment_number VARCHAR(30);
  END IF;

  -- payment_type: 'supplier' or 'direct'
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'supplier_payments' AND column_name = 'payment_type'
  ) THEN
    ALTER TABLE supplier_payments
      ADD COLUMN payment_type VARCHAR(20) NOT NULL DEFAULT 'supplier';
  END IF;

  -- expense_account_id for direct expense payments
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'supplier_payments' AND column_name = 'expense_account_id'
  ) THEN
    ALTER TABLE supplier_payments
      ADD COLUMN expense_account_id UUID REFERENCES accounts(account_id);
  END IF;

  -- payee_name for direct expense payments (who was paid)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'supplier_payments' AND column_name = 'payee_name'
  ) THEN
    ALTER TABLE supplier_payments ADD COLUMN payee_name VARCHAR(200);
  END IF;

  -- make supplier_id nullable for direct payments
  ALTER TABLE supplier_payments ALTER COLUMN supplier_id DROP NOT NULL;
END $$;
