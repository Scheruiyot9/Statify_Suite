ALTER TABLE sales_transactions
  ADD COLUMN IF NOT EXISTS last_edited_by UUID REFERENCES users(user_id),
  ADD COLUMN IF NOT EXISTS last_edited_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS edit_reason    TEXT;
