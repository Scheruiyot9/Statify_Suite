CREATE TABLE IF NOT EXISTS pos_holds (
  hold_id    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID        NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  branch_id  UUID        NOT NULL REFERENCES branches(branch_id),
  created_by UUID        NOT NULL REFERENCES users(user_id),
  label      VARCHAR(100),
  cart_data  JSONB       NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pos_holds_branch ON pos_holds(company_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_pos_holds_user   ON pos_holds(created_by);
