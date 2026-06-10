-- POS behaviour toggles (company-level)
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS pos_allow_price_edit  BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS pos_allow_partial_qty BOOLEAN NOT NULL DEFAULT FALSE;
