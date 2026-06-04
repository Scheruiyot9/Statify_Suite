-- Migration: link payment methods to bank accounts
ALTER TABLE payment_methods
  ADD COLUMN IF NOT EXISTS bank_account_id UUID
    REFERENCES bank_accounts(bank_account_id) ON DELETE SET NULL;
