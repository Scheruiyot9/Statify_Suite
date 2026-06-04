-- =============================================================================
-- 03_mpesa.sql — M-Pesa / Daraja API integration
-- Depends on: 01_core.sql
-- =============================================================================

-- =============================================================================
-- 1. M-Pesa Config
-- Per-company (branch_id IS NULL) or per-branch override.
-- =============================================================================
CREATE TABLE IF NOT EXISTS mpesa_config (
    config_id       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID        NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
    branch_id       UUID        REFERENCES branches(branch_id) ON DELETE CASCADE,
    consumer_key    TEXT        NOT NULL,
    consumer_secret TEXT        NOT NULL,
    shortcode       TEXT        NOT NULL,
    shortcode_type  TEXT        NOT NULL DEFAULT 'paybill', -- 'paybill' | 'till'
    passkey         TEXT        NOT NULL,
    callback_url    TEXT,
    environment     TEXT        NOT NULL DEFAULT 'sandbox', -- 'sandbox' | 'production'
    is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One company-wide fallback config per company
CREATE UNIQUE INDEX IF NOT EXISTS idx_mpesa_config_company_default
    ON mpesa_config (company_id) WHERE branch_id IS NULL;

-- One config per branch per company
CREATE UNIQUE INDEX IF NOT EXISTS idx_mpesa_config_branch_specific
    ON mpesa_config (company_id, branch_id) WHERE branch_id IS NOT NULL;

-- =============================================================================
-- 2. M-Pesa Transactions
-- =============================================================================
CREATE TABLE IF NOT EXISTS mpesa_transactions (
    mpesa_txn_id         UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id           UUID          NOT NULL REFERENCES companies(company_id),
    branch_id            UUID          REFERENCES branches(branch_id),
    checkout_request_id  TEXT,
    merchant_request_id  TEXT,
    mpesa_receipt_number TEXT,
    payment_mode         TEXT          NOT NULL DEFAULT 'stk_push'
                         CHECK (payment_mode IN ('stk_push','manual','c2b')),
    phone_number         TEXT,
    amount               NUMERIC(12,2) NOT NULL,
    account_reference    TEXT,
    description          TEXT,
    status               TEXT          NOT NULL DEFAULT 'pending',
    failure_reason       TEXT,
    result_code          TEXT,
    sales_transaction_id UUID          REFERENCES sales_transactions(transaction_id) ON DELETE SET NULL,
    stk_response         JSONB,
    callback_payload     JSONB,
    initiated_at         TIMESTAMPTZ   NOT NULL DEFAULT now(),
    completed_at         TIMESTAMPTZ,
    created_at           TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mpesa_txn_company   ON mpesa_transactions (company_id);
CREATE INDEX IF NOT EXISTS idx_mpesa_txn_branch    ON mpesa_transactions (branch_id);
CREATE INDEX IF NOT EXISTS idx_mpesa_txn_status    ON mpesa_transactions (status);
CREATE INDEX IF NOT EXISTS idx_mpesa_txn_initiated ON mpesa_transactions (company_id, initiated_at DESC);
CREATE INDEX IF NOT EXISTS idx_mpesa_txn_sales
    ON mpesa_transactions (sales_transaction_id) WHERE sales_transaction_id IS NOT NULL;

-- Dedup: one row per STK push request
CREATE UNIQUE INDEX IF NOT EXISTS idx_mpesa_txns_checkout_unique
    ON mpesa_transactions (checkout_request_id) WHERE checkout_request_id IS NOT NULL;

-- Dedup: one row per M-Pesa receipt (C2B callbacks may retry)
CREATE UNIQUE INDEX IF NOT EXISTS idx_mpesa_txn_receipt
    ON mpesa_transactions (mpesa_receipt_number) WHERE mpesa_receipt_number IS NOT NULL;

-- =============================================================================
-- 3. STK Sessions (persisted so callbacks survive server restarts)
-- =============================================================================
CREATE TABLE IF NOT EXISTS stk_sessions (
    checkout_request_id TEXT          PRIMARY KEY,
    company_id          UUID          NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
    branch_id           UUID          REFERENCES branches(branch_id) ON DELETE SET NULL,
    phone               TEXT,
    amount              NUMERIC(12,2) NOT NULL,
    account_reference   TEXT,
    description         TEXT,
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stk_sessions_created ON stk_sessions (created_at);
