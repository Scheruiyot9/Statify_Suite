-- Migration: add bank_account_id FK to payment_methods
-- Links a payment method to a bank account for automatic balance tracking.
-- Safe to re-run — guarded by column-existence check.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payment_methods' AND column_name = 'bank_account_id'
  ) THEN
    ALTER TABLE payment_methods
      ADD COLUMN bank_account_id UUID REFERENCES bank_accounts(bank_account_id) ON DELETE SET NULL;
  END IF;
END $$;
