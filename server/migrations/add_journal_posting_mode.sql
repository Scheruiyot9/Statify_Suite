ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS journal_posting_mode VARCHAR(20) NOT NULL DEFAULT 'per_transaction';
