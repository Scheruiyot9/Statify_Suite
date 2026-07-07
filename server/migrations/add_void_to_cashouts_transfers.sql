-- Migration: void support for POS cash-outs and pay-mode transfers.
-- Mirrors the void columns journal_entries already has, so these can be voided
-- from the Journal page's Cash Outs / Transfers tabs with a visible audit trail.

ALTER TABLE session_cash_outs
  ADD COLUMN IF NOT EXISTS status             VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','void')),
  ADD COLUMN IF NOT EXISTS voided_by_user_id   UUID REFERENCES users(user_id),
  ADD COLUMN IF NOT EXISTS voided_at           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS void_reason         TEXT;

ALTER TABLE session_transfers
  ADD COLUMN IF NOT EXISTS status             VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','void')),
  ADD COLUMN IF NOT EXISTS voided_by_user_id   UUID REFERENCES users(user_id),
  ADD COLUMN IF NOT EXISTS voided_at           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS void_reason         TEXT;
