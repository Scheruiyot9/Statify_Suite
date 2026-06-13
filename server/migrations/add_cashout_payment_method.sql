-- Migration: add payment_method_id to session_cash_outs
-- This column was referenced in service code but missing from the original table DDL,
-- causing close-shift, cashout POST, and session summary to all fail with a SQL error.

ALTER TABLE session_cash_outs
  ADD COLUMN IF NOT EXISTS payment_method_id UUID REFERENCES payment_methods(payment_method_id);

CREATE INDEX IF NOT EXISTS idx_cash_outs_payment_method ON session_cash_outs(payment_method_id);
