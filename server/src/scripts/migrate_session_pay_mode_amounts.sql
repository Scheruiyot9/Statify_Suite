-- Adds session_pay_mode_amounts table for per-payment-method opening/closing counts on POS shifts.
-- Safe to run on existing databases (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS session_pay_mode_amounts (
  spa_id             BIGSERIAL PRIMARY KEY,
  session_id         BIGINT      NOT NULL REFERENCES pos_sessions(session_id) ON DELETE CASCADE,
  payment_method_id  INT         NOT NULL REFERENCES payment_methods(payment_method_id),
  count_type         VARCHAR(10) NOT NULL CHECK (count_type IN ('opening','closing')),
  amount             NUMERIC(12,2) NOT NULL DEFAULT 0,
  UNIQUE (session_id, payment_method_id, count_type)
);

CREATE INDEX IF NOT EXISTS idx_session_pay_mode ON session_pay_mode_amounts (session_id, count_type);
