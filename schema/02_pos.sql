-- =============================================================================
-- 02_pos.sql — POS sessions, split payments, and returns
-- Depends on: 01_core.sql
-- =============================================================================

-- =============================================================================
-- 1. POS Terminals
-- =============================================================================
CREATE TABLE IF NOT EXISTS pos_terminals (
    terminal_id   UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    branch_id     UUID            NOT NULL REFERENCES branches(branch_id),
    company_id    UUID            NOT NULL REFERENCES companies(company_id),
    terminal_name VARCHAR(100)    NOT NULL,
    terminal_code VARCHAR(20)     NOT NULL,
    description   TEXT,
    is_active     BOOLEAN         NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ     NOT NULL DEFAULT now(),
    CONSTRAINT uq_terminal_code_per_branch UNIQUE (branch_id, terminal_code)
);

CREATE INDEX idx_terminals_branch ON pos_terminals (branch_id, is_active);

-- =============================================================================
-- 2. POS Sessions (one session = one cashier shift on one terminal)
-- =============================================================================
CREATE TABLE IF NOT EXISTS pos_sessions (
    session_id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id              UUID            NOT NULL REFERENCES companies(company_id),
    branch_id               UUID            NOT NULL REFERENCES branches(branch_id),
    terminal_id             UUID            NOT NULL REFERENCES pos_terminals(terminal_id),
    cashier_user_id         UUID            NOT NULL REFERENCES users(user_id),
    session_start           TIMESTAMPTZ     NOT NULL DEFAULT now(),
    opening_cash_amount     NUMERIC(15,2)   NOT NULL DEFAULT 0,
    opening_notes           TEXT,
    opened_by_user_id       UUID            REFERENCES users(user_id),
    session_end             TIMESTAMPTZ,
    closing_cash_counted    NUMERIC(15,2),
    closing_notes           TEXT,
    closed_by_user_id       UUID            REFERENCES users(user_id),
    expected_cash_amount    NUMERIC(15,2),
    cash_variance           NUMERIC(15,2),
    reconciled_by_user_id   UUID            REFERENCES users(user_id),
    reconciled_at           TIMESTAMPTZ,
    reconciliation_notes    TEXT,
    status  VARCHAR(20) NOT NULL DEFAULT 'open'
            CHECK (status IN ('open','closed','reconciled','disputed')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only one open session per terminal at any time
CREATE UNIQUE INDEX uq_one_open_session_per_terminal
    ON pos_sessions (terminal_id) WHERE status = 'open';
CREATE INDEX idx_sessions_branch_date ON pos_sessions (branch_id, session_start DESC);
CREATE INDEX idx_sessions_cashier     ON pos_sessions (cashier_user_id, session_start DESC);
CREATE INDEX idx_sessions_status      ON pos_sessions (company_id, status);

-- =============================================================================
-- 3. Wire FK constraints from sales_transactions to pos_terminals / pos_sessions
-- =============================================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'sales_transactions_pos_session_id_fkey'
          AND table_name = 'sales_transactions'
    ) THEN
        ALTER TABLE sales_transactions
            ADD CONSTRAINT sales_transactions_pos_session_id_fkey
                FOREIGN KEY (pos_session_id) REFERENCES pos_sessions(session_id);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'sales_transactions_terminal_id_fkey'
          AND table_name = 'sales_transactions'
    ) THEN
        ALTER TABLE sales_transactions
            ADD CONSTRAINT sales_transactions_terminal_id_fkey
                FOREIGN KEY (terminal_id) REFERENCES pos_terminals(terminal_id);
    END IF;
END $$;

-- =============================================================================
-- 4. Session Cash Denominations
-- =============================================================================
CREATE TABLE IF NOT EXISTS session_cash_denominations (
    denomination_id    UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id         UUID            NOT NULL REFERENCES pos_sessions(session_id) ON DELETE CASCADE,
    count_type         VARCHAR(10)     NOT NULL CHECK (count_type IN ('opening','closing')),
    denomination_value NUMERIC(10,2)   NOT NULL,
    quantity           INTEGER         NOT NULL DEFAULT 0,
    subtotal           NUMERIC(12,2)   GENERATED ALWAYS AS (denomination_value * quantity) STORED
);

CREATE INDEX idx_denominations_session ON session_cash_denominations (session_id, count_type);

-- =============================================================================
-- 5. Session Pay-Mode Amounts (per-payment-method float per session)
-- =============================================================================
CREATE TABLE IF NOT EXISTS session_pay_mode_amounts (
    amount_id         UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id        UUID            NOT NULL REFERENCES pos_sessions(session_id) ON DELETE CASCADE,
    payment_method_id UUID            NOT NULL REFERENCES payment_methods(payment_method_id),
    count_type        VARCHAR(10)     NOT NULL CHECK (count_type IN ('opening','closing')),
    amount            NUMERIC(15,2)   NOT NULL DEFAULT 0,
    CONSTRAINT uq_session_paymode_type UNIQUE (session_id, payment_method_id, count_type)
);

CREATE INDEX IF NOT EXISTS idx_session_pay_mode ON session_pay_mode_amounts (session_id, count_type);

-- =============================================================================
-- 6. Transaction Payments (split / multi-tender)
-- =============================================================================
CREATE TABLE IF NOT EXISTS transaction_payments (
    payment_id          UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id      UUID            NOT NULL REFERENCES sales_transactions(transaction_id),
    payment_method_id   UUID            NOT NULL REFERENCES payment_methods(payment_method_id),
    amount_tendered     NUMERIC(15,2)   NOT NULL CHECK (amount_tendered > 0),
    amount_applied      NUMERIC(15,2)   NOT NULL CHECK (amount_applied > 0),
    change_given        NUMERIC(15,2)   NOT NULL DEFAULT 0 CHECK (change_given >= 0),
    reference_number    VARCHAR(100),
    card_last_four      CHAR(4),
    card_type           VARCHAR(20),
    mobile_phone_masked VARCHAR(20),
    sequence_no         SMALLINT        NOT NULL DEFAULT 1,
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT now(),
    CONSTRAINT chk_change_only_on_cash CHECK (change_given = 0 OR card_last_four IS NULL)
);

CREATE INDEX idx_txn_payments_transaction ON transaction_payments (transaction_id);
CREATE INDEX idx_txn_payments_method      ON transaction_payments (payment_method_id);

-- Trigger: keep sales_transactions.amount_paid in sync after payment insert/update
CREATE OR REPLACE FUNCTION sync_transaction_amount_paid()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    UPDATE sales_transactions
    SET amount_paid  = (SELECT COALESCE(SUM(amount_applied), 0)
                        FROM transaction_payments WHERE transaction_id = NEW.transaction_id),
        change_total = (SELECT COALESCE(SUM(change_given),   0)
                        FROM transaction_payments WHERE transaction_id = NEW.transaction_id),
        updated_at   = now()
    WHERE transaction_id = NEW.transaction_id;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_amount_paid ON transaction_payments;
CREATE TRIGGER trg_sync_amount_paid
AFTER INSERT OR UPDATE ON transaction_payments
FOR EACH ROW EXECUTE FUNCTION sync_transaction_amount_paid();

-- View: payment breakdown per transaction
CREATE OR REPLACE VIEW v_transaction_payment_summary AS
SELECT
    t.transaction_id,
    t.transaction_number,
    t.total_amount,
    t.amount_paid,
    t.change_total,
    (t.total_amount - t.amount_paid) AS balance_due,
    json_agg(
        json_build_object(
            'method',         pm.method_name,
            'amount_applied', tp.amount_applied,
            'amount_tendered',tp.amount_tendered,
            'change_given',   tp.change_given,
            'reference',      tp.reference_number
        ) ORDER BY tp.sequence_no
    ) AS payment_legs
FROM sales_transactions t
JOIN transaction_payments tp ON tp.transaction_id = t.transaction_id
JOIN payment_methods      pm ON pm.payment_method_id = tp.payment_method_id
GROUP BY t.transaction_id, t.transaction_number, t.total_amount, t.amount_paid, t.change_total;

-- =============================================================================
-- 7. Return Reasons
-- =============================================================================
CREATE TABLE IF NOT EXISTS return_reasons (
    reason_id          UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id         UUID            NOT NULL REFERENCES companies(company_id),
    reason_code        VARCHAR(30)     NOT NULL,
    reason_name        VARCHAR(100)    NOT NULL,
    restock_by_default BOOLEAN         NOT NULL DEFAULT TRUE,
    is_system_reason   BOOLEAN         NOT NULL DEFAULT FALSE,
    is_active          BOOLEAN         NOT NULL DEFAULT TRUE,
    CONSTRAINT uq_return_reason_code UNIQUE (company_id, reason_code)
);

CREATE INDEX idx_return_reasons_company ON return_reasons (company_id, is_active);

-- =============================================================================
-- 8. Returns
-- =============================================================================
CREATE TABLE IF NOT EXISTS returns (
    return_id               UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id              UUID            NOT NULL REFERENCES companies(company_id),
    branch_id               UUID            NOT NULL REFERENCES branches(branch_id),
    return_number           VARCHAR(50)     NOT NULL,
    original_transaction_id UUID            NOT NULL REFERENCES sales_transactions(transaction_id),
    processed_by_user_id    UUID            NOT NULL REFERENCES users(user_id),
    return_date             TIMESTAMPTZ     NOT NULL DEFAULT now(),
    requires_approval       BOOLEAN         NOT NULL DEFAULT FALSE,
    approved_by_user_id     UUID            REFERENCES users(user_id),
    approved_at             TIMESTAMPTZ,
    approval_notes          TEXT,
    pos_session_id          UUID            REFERENCES pos_sessions(session_id),
    return_reason_id        UUID            REFERENCES return_reasons(reason_id),
    customer_notes          TEXT,
    internal_notes          TEXT,
    subtotal_refunded       NUMERIC(15,2)   NOT NULL DEFAULT 0,
    tax_refunded            NUMERIC(15,2)   NOT NULL DEFAULT 0,
    discount_adjusted       NUMERIC(15,2)   NOT NULL DEFAULT 0,
    total_refunded          NUMERIC(15,2)   NOT NULL DEFAULT 0,
    refunded_by_user_id     UUID            REFERENCES users(user_id),
    refunded_at             TIMESTAMPTZ,
    refund_notes            TEXT,
    status  VARCHAR(20) NOT NULL DEFAULT 'pending'
            CHECK (status IN ('pending','approved','refunded','rejected','partial')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_return_number_per_company UNIQUE (company_id, return_number)
);

CREATE INDEX idx_returns_company_date ON returns (company_id, return_date DESC);
CREATE INDEX idx_returns_branch       ON returns (branch_id, return_date DESC);
CREATE INDEX idx_returns_original_txn ON returns (original_transaction_id);
CREATE INDEX idx_returns_status       ON returns (company_id, status);

-- =============================================================================
-- 9. Return Items
-- =============================================================================
CREATE TABLE IF NOT EXISTS return_items (
    return_item_id        UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    return_id             UUID            NOT NULL REFERENCES returns(return_id) ON DELETE CASCADE,
    original_item_id      UUID            NOT NULL REFERENCES sales_transaction_items(item_id),
    product_id            UUID            NOT NULL REFERENCES products(product_id),
    quantity_returned     NUMERIC(12,4)   NOT NULL CHECK (quantity_returned > 0),
    unit_price_at_sale    NUMERIC(15,4)   NOT NULL,
    unit_tax_at_sale      NUMERIC(15,4)   NOT NULL DEFAULT 0,
    unit_discount_at_sale NUMERIC(15,4)   NOT NULL DEFAULT 0,
    line_refund_amount    NUMERIC(15,2)   NOT NULL,
    return_to_inventory   BOOLEAN         NOT NULL DEFAULT TRUE,
    item_condition        VARCHAR(20)     CHECK (item_condition IN ('resellable','damaged','expired','other')),
    return_reason_id      UUID            REFERENCES return_reasons(reason_id),
    line_notes            TEXT
);

CREATE INDEX idx_return_items_return  ON return_items (return_id);
CREATE INDEX idx_return_items_product ON return_items (product_id);

-- =============================================================================
-- 10. Return Refunds
-- =============================================================================
CREATE TABLE IF NOT EXISTS return_refunds (
    refund_id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    return_id              UUID            NOT NULL REFERENCES returns(return_id) ON DELETE CASCADE,
    payment_method_id      UUID            NOT NULL REFERENCES payment_methods(payment_method_id),
    amount_refunded        NUMERIC(15,2)   NOT NULL CHECK (amount_refunded > 0),
    reference_number       VARCHAR(100),
    issued_as_store_credit BOOLEAN         NOT NULL DEFAULT FALSE,
    created_at             TIMESTAMPTZ     NOT NULL DEFAULT now()
);

CREATE INDEX idx_return_refunds_return ON return_refunds (return_id);

-- Trigger: restock inventory when a return is approved or refunded
CREATE OR REPLACE FUNCTION restock_returned_items()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF (OLD.status NOT IN ('approved','refunded'))
       AND (NEW.status IN ('approved','refunded')) THEN
        UPDATE product_branch_inventory pbi
        SET quantity_available = pbi.quantity_available + ri.quantity_returned,
            last_updated       = now()
        FROM return_items ri
        WHERE ri.return_id           = NEW.return_id
          AND ri.return_to_inventory = TRUE
          AND pbi.product_id         = ri.product_id
          AND pbi.branch_id          = NEW.branch_id;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_restock_on_return_approval ON returns;
CREATE TRIGGER trg_restock_on_return_approval
AFTER UPDATE OF status ON returns
FOR EACH ROW EXECUTE FUNCTION restock_returned_items();

-- Trigger: keep sales_transactions.total_returned / return_status in sync
CREATE OR REPLACE FUNCTION sync_transaction_return_totals()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.status IN ('refunded','approved') THEN
        UPDATE sales_transactions st
        SET total_returned = (
                SELECT COALESCE(SUM(r2.total_refunded), 0)
                FROM returns r2
                WHERE r2.original_transaction_id = NEW.original_transaction_id
                  AND r2.status IN ('approved','refunded')
            ),
            return_status = CASE
                WHEN (SELECT COALESCE(SUM(r2.total_refunded), 0)
                      FROM returns r2
                      WHERE r2.original_transaction_id = NEW.original_transaction_id
                        AND r2.status IN ('approved','refunded'))
                     >= st.total_amount THEN 'full'
                WHEN (SELECT COALESCE(SUM(r2.total_refunded), 0)
                      FROM returns r2
                      WHERE r2.original_transaction_id = NEW.original_transaction_id
                        AND r2.status IN ('approved','refunded'))
                     > 0 THEN 'partial'
                ELSE 'none'
            END,
            updated_at = now()
        WHERE st.transaction_id = NEW.original_transaction_id;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_return_totals ON returns;
CREATE TRIGGER trg_sync_return_totals
AFTER UPDATE OF status ON returns
FOR EACH ROW EXECUTE FUNCTION sync_transaction_return_totals();
