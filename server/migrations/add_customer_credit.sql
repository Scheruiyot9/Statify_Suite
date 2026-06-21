-- Credit sales support: opt-in per customer.
-- Existing customers unaffected (allow_credit defaults to FALSE).

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS allow_credit BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS credit_limit NUMERIC(12,2) NOT NULL DEFAULT 0;
