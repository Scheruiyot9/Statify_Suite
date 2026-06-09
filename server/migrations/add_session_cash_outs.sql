-- Migration: session cash-outs (petty cash disbursements during a POS shift)

CREATE TABLE IF NOT EXISTS session_cash_outs (
  cash_out_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  session_id          UUID NOT NULL REFERENCES pos_sessions(session_id) ON DELETE CASCADE,
  branch_id           UUID NOT NULL REFERENCES branches(branch_id),
  out_type            VARCHAR(20) NOT NULL CHECK (out_type IN ('withdrawal','expense','stock_payment')),
  amount              NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  notes               TEXT,
  -- Finance module fields (NULL when finance not enabled)
  account_id          UUID REFERENCES accounts(account_id),
  supplier_id         UUID REFERENCES suppliers(supplier_id),
  journal_entry_id    UUID REFERENCES journal_entries(journal_entry_id),
  created_by_user_id  UUID REFERENCES users(user_id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cash_outs_session ON session_cash_outs(session_id);
CREATE INDEX IF NOT EXISTS idx_cash_outs_company ON session_cash_outs(company_id);
