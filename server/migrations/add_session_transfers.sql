CREATE TABLE IF NOT EXISTS session_transfers (
  transfer_id        UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         UUID          NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  session_id         UUID          NOT NULL REFERENCES pos_sessions(session_id) ON DELETE CASCADE,
  branch_id          UUID          NOT NULL REFERENCES branches(branch_id),
  transfer_type      TEXT          NOT NULL CHECK (transfer_type IN ('sweep','float_topup','correction')),
  from_method_id     UUID          NOT NULL REFERENCES payment_methods(payment_method_id),
  to_method_id       UUID          NOT NULL REFERENCES payment_methods(payment_method_id),
  amount             NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  reference_txn_id   UUID          REFERENCES sales_transactions(transaction_id),
  notes              TEXT,
  created_by_user_id UUID          REFERENCES users(user_id),
  created_at         TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_session_transfers_session ON session_transfers(session_id);
CREATE INDEX IF NOT EXISTS idx_session_transfers_company ON session_transfers(company_id);
