-- =============================================================================
-- 04_subscriptions.sql — Subscription history ledger
-- subscription_plans is defined in 01_core.sql.
-- This file adds the per-company subscription history table.
-- Depends on: 01_core.sql
-- =============================================================================

CREATE TABLE IF NOT EXISTS company_subscriptions (
    subscription_id UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID          NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
    plan_id         UUID          NOT NULL REFERENCES subscription_plans(plan_id),
    start_date      DATE          NOT NULL,
    end_date        DATE          NOT NULL,
    period          VARCHAR(20)   NOT NULL DEFAULT 'monthly'
                    CHECK (period IN ('monthly','quarterly','semi_annual','annual','biennial','custom')),
    amount_paid     NUMERIC(12,2),
    recorded_by     UUID          REFERENCES users(user_id),
    notes           TEXT,
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CONSTRAINT chk_sub_dates CHECK (end_date > start_date)
);

CREATE INDEX IF NOT EXISTS idx_company_subs_company ON company_subscriptions (company_id, end_date DESC);
CREATE INDEX IF NOT EXISTS idx_company_subs_end     ON company_subscriptions (end_date);
