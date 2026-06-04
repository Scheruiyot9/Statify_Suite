-- =============================================================================
-- 06_procurement.sql — Suppliers, purchase orders, GRNs, AP payments
-- Depends on: 01_core.sql, 05_finance.sql (accounts, bank_accounts)
-- =============================================================================

-- =============================================================================
-- 1. Suppliers
-- =============================================================================
CREATE TABLE IF NOT EXISTS suppliers (
    supplier_id     UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID          NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
    supplier_name   VARCHAR(100)  NOT NULL,
    contact_person  VARCHAR(100),
    email           VARCHAR(150),
    phone           VARCHAR(30),
    address         TEXT,
    tax_pin         VARCHAR(50),
    payment_terms   INTEGER       NOT NULL DEFAULT 30,
    credit_limit    NUMERIC(15,2),
    current_balance NUMERIC(15,2) NOT NULL DEFAULT 0,
    account_id      UUID          REFERENCES accounts(account_id),
    currency        VARCHAR(3)    NOT NULL DEFAULT 'KES',
    is_active       BOOLEAN       NOT NULL DEFAULT TRUE,
    notes           TEXT,
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_suppliers_company ON suppliers (company_id);
CREATE INDEX IF NOT EXISTS idx_suppliers_name    ON suppliers (company_id, supplier_name);

-- =============================================================================
-- 2. Purchase Orders
-- =============================================================================
CREATE TABLE IF NOT EXISTS purchase_orders (
    po_id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id          UUID          NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
    branch_id           UUID          NOT NULL REFERENCES branches(branch_id),
    supplier_id         UUID          NOT NULL REFERENCES suppliers(supplier_id),
    po_number           VARCHAR(30)   NOT NULL,
    order_date          DATE          NOT NULL DEFAULT CURRENT_DATE,
    expected_date       DATE,
    status              VARCHAR(25)   NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','pending_approval','approved',
                                          'partially_received','received','cancelled')),
    subtotal            NUMERIC(15,2) NOT NULL DEFAULT 0,
    tax_amount          NUMERIC(15,2) NOT NULL DEFAULT 0,
    total_amount        NUMERIC(15,2) NOT NULL DEFAULT 0,
    notes               TEXT,
    created_by_user_id  UUID          REFERENCES users(user_id),
    approved_by_user_id UUID          REFERENCES users(user_id),
    approved_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
    UNIQUE (company_id, po_number)
);

CREATE TABLE IF NOT EXISTS purchase_order_items (
    poi_id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    po_id             UUID          NOT NULL REFERENCES purchase_orders(po_id) ON DELETE CASCADE,
    product_id        UUID          NOT NULL REFERENCES products(product_id),
    description       TEXT,
    quantity_ordered  NUMERIC(12,3) NOT NULL,
    quantity_received NUMERIC(12,3) NOT NULL DEFAULT 0,
    unit_cost         NUMERIC(15,4) NOT NULL,
    tax_rate          NUMERIC(5,2)  NOT NULL DEFAULT 0,
    line_total        NUMERIC(15,2) NOT NULL,
    created_at        TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_po_company ON purchase_orders (company_id, status);
CREATE INDEX IF NOT EXISTS idx_poi_po     ON purchase_order_items (po_id);

-- =============================================================================
-- 3. Goods Received Notes (GRNs)
-- =============================================================================
CREATE TABLE IF NOT EXISTS grns (
    grn_id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id          UUID          NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
    branch_id           UUID          NOT NULL REFERENCES branches(branch_id),
    po_id               UUID          NOT NULL REFERENCES purchase_orders(po_id),
    supplier_id         UUID          NOT NULL REFERENCES suppliers(supplier_id),
    grn_number          VARCHAR(30)   NOT NULL,
    received_date       DATE          NOT NULL DEFAULT CURRENT_DATE,
    status              VARCHAR(10)   NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','posted')),
    subtotal            NUMERIC(15,2) NOT NULL DEFAULT 0,
    total_amount        NUMERIC(15,2) NOT NULL DEFAULT 0,
    notes               TEXT,
    received_by_user_id UUID          REFERENCES users(user_id),
    posted_at           TIMESTAMPTZ,
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
    UNIQUE (company_id, grn_number)
);

CREATE TABLE IF NOT EXISTS grn_items (
    grni_id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    grn_id            UUID          NOT NULL REFERENCES grns(grn_id) ON DELETE CASCADE,
    poi_id            UUID          NOT NULL REFERENCES purchase_order_items(poi_id),
    product_id        UUID          NOT NULL REFERENCES products(product_id),
    quantity_received NUMERIC(12,3) NOT NULL,
    unit_cost         NUMERIC(15,4) NOT NULL,
    line_total        NUMERIC(15,2) NOT NULL,
    created_at        TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_grn_company ON grns (company_id, status);
CREATE INDEX IF NOT EXISTS idx_grni_grn    ON grn_items (grn_id);
CREATE INDEX IF NOT EXISTS idx_grni_poi    ON grn_items (poi_id);

-- =============================================================================
-- 4. Supplier (AP) Payments
-- =============================================================================
CREATE TABLE IF NOT EXISTS supplier_payments (
    payment_id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id          UUID          NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
    branch_id           UUID          NOT NULL REFERENCES branches(branch_id),
    supplier_id         UUID          NOT NULL REFERENCES suppliers(supplier_id),
    bank_account_id     UUID          REFERENCES bank_accounts(bank_account_id),
    po_id               UUID          REFERENCES purchase_orders(po_id),
    payment_date        DATE          NOT NULL DEFAULT CURRENT_DATE,
    amount              NUMERIC(15,2) NOT NULL CHECK (amount > 0),
    payment_method      VARCHAR(20)   NOT NULL DEFAULT 'bank_transfer'
                        CHECK (payment_method IN ('bank_transfer','cash','cheque','mpesa','other')),
    reference_number    VARCHAR(100),
    notes               TEXT,
    is_void             BOOLEAN       NOT NULL DEFAULT FALSE,
    voided_at           TIMESTAMPTZ,
    voided_by_user_id   UUID          REFERENCES users(user_id),
    created_by_user_id  UUID          REFERENCES users(user_id),
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_spay_company_supplier ON supplier_payments (company_id, supplier_id);
CREATE INDEX IF NOT EXISTS idx_spay_company_date     ON supplier_payments (company_id, payment_date DESC);
