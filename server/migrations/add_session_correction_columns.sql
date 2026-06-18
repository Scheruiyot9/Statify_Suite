ALTER TABLE pos_sessions
  ADD COLUMN IF NOT EXISTS corrected_by     UUID REFERENCES users(user_id),
  ADD COLUMN IF NOT EXISTS corrected_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS correction_reason TEXT;
