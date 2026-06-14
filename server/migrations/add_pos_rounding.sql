ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS pos_rounding_mode TEXT          NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS pos_rounding_unit NUMERIC(10,4) NOT NULL DEFAULT 1;

-- If column already existed as INTEGER, widen it to NUMERIC
ALTER TABLE companies
  ALTER COLUMN pos_rounding_unit TYPE NUMERIC(10,4) USING pos_rounding_unit::NUMERIC;
