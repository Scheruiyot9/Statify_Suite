-- =============================================================================
-- 01_core.sql — Foundation schema
-- Covers: tenants, auth, products, customers, sales
-- Run this file first. 02_pos.sql depends on tables defined here.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================================================
-- 1. Subscription Plans
-- =============================================================================
CREATE TABLE IF NOT EXISTS subscription_plans (
    plan_id         UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_name       VARCHAR(50)     NOT NULL UNIQUE,
    price           NUMERIC(10,2)   NOT NULL,
    annual_price    NUMERIC(10,2),
    billing_cycle   VARCHAR(10)     NOT NULL CHECK (billing_cycle IN ('monthly','annual')),
    max_users       INTEGER         NOT NULL DEFAULT 5,
    max_branches    INTEGER         NOT NULL DEFAULT 1,
    features_json   JSONB           NOT NULL DEFAULT '{}',
    trial_days      SMALLINT        NOT NULL DEFAULT 14,
    has_finance     BOOLEAN         NOT NULL DEFAULT FALSE,
    has_api_access  BOOLEAN         NOT NULL DEFAULT FALSE,
    sort_order      SMALLINT        NOT NULL DEFAULT 0,
    is_active       BOOLEAN         NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT now()
);

-- =============================================================================
-- 2. Companies (tenants)
-- All per-company counters and config columns are defined here up front.
-- =============================================================================
CREATE TABLE IF NOT EXISTS companies (
    company_id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    company_name            VARCHAR(150)    NOT NULL,
    subscription_plan_id    UUID            REFERENCES subscription_plans(plan_id),
    subscription_status     VARCHAR(20)     NOT NULL DEFAULT 'active'
                            CHECK (subscription_status IN ('trial','active','suspended','cancelled')),
    subscription_start_date DATE,
    subscription_end_date   DATE,
    domain_name             VARCHAR(100)    UNIQUE,
    domain                  TEXT,
    contact_email           VARCHAR(150)    NOT NULL,
    contact_phone           VARCHAR(30),
    address                 TEXT,
    tax_id                  VARCHAR(50),
    currency                CHAR(3)         NOT NULL DEFAULT 'KES',
    timezone                VARCHAR(50)     NOT NULL DEFAULT 'Africa/Nairobi',
    logo_url                TEXT,
    country                 VARCHAR(60)     NOT NULL DEFAULT 'Kenya',
    language                VARCHAR(10)     NOT NULL DEFAULT 'en',
    is_active               BOOLEAN         NOT NULL DEFAULT TRUE,
    -- Atomic sequence counters (avoid COUNT race conditions)
    txn_counter             BIGINT          NOT NULL DEFAULT 0,
    rtn_counter             BIGINT          NOT NULL DEFAULT 0,
    po_counter              INTEGER         NOT NULL DEFAULT 0,
    grn_counter             INTEGER         NOT NULL DEFAULT 0,
    je_counter              INTEGER         NOT NULL DEFAULT 0,
    journal_counter         INTEGER         NOT NULL DEFAULT 0,
    -- Loyalty programme rates
    points_earn_rate        NUMERIC(10,4)   NOT NULL DEFAULT 10,
    points_redeem_rate      NUMERIC(10,4)   NOT NULL DEFAULT 0.10,
    created_at              TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ     NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_companies_status ON companies (subscription_status, is_active);

-- =============================================================================
-- 3. Branches
-- =============================================================================
CREATE TABLE IF NOT EXISTS branches (
    branch_id       UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID            NOT NULL REFERENCES companies(company_id),
    branch_name     VARCHAR(100)    NOT NULL,
    branch_code     VARCHAR(20)     NOT NULL,
    address         TEXT,
    phone           VARCHAR(30),
    email           VARCHAR(150),
    is_headquarters BOOLEAN         NOT NULL DEFAULT FALSE,
    operating_hours JSONB,
    is_active       BOOLEAN         NOT NULL DEFAULT TRUE,
    deleted_at      TIMESTAMPTZ,
    deleted_by      UUID,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),
    CONSTRAINT uq_branch_code UNIQUE (company_id, branch_code)
);

CREATE INDEX idx_branches_company ON branches (company_id, is_active);
CREATE INDEX IF NOT EXISTS idx_branches_active ON branches (company_id) WHERE deleted_at IS NULL;

-- =============================================================================
-- 4. Roles
-- =============================================================================
CREATE TABLE IF NOT EXISTS roles (
    role_id         UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID            REFERENCES companies(company_id), -- NULL = system-wide
    role_name       VARCHAR(50)     NOT NULL,
    description     TEXT,
    is_system_role  BOOLEAN         NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),
    CONSTRAINT uq_role_name UNIQUE (company_id, role_name)
);

CREATE INDEX idx_roles_company ON roles (company_id);

-- =============================================================================
-- 5. Users
-- =============================================================================
CREATE TABLE IF NOT EXISTS users (
    user_id             UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id          UUID            REFERENCES companies(company_id), -- NULL = super admin
    username            VARCHAR(60)     NOT NULL,
    email               VARCHAR(150)    NOT NULL UNIQUE,
    password_hash       TEXT            NOT NULL,
    first_name          VARCHAR(60)     NOT NULL,
    last_name           VARCHAR(60)     NOT NULL,
    phone               VARCHAR(30),
    profile_image_url   TEXT,
    is_active           BOOLEAN         NOT NULL DEFAULT TRUE,
    last_login          TIMESTAMPTZ,
    deleted_at          TIMESTAMPTZ,
    deleted_by          UUID,
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT now()
);

CREATE INDEX idx_users_company ON users (company_id, is_active);
CREATE INDEX idx_users_email   ON users (email);
CREATE INDEX IF NOT EXISTS idx_users_active ON users (company_id) WHERE deleted_at IS NULL;

-- =============================================================================
-- 6. User Sessions (server-side refresh token tracking for revocation)
-- =============================================================================
CREATE TABLE IF NOT EXISTS user_sessions (
    session_id      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID        NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    token_hash      TEXT        NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at      TIMESTAMPTZ NOT NULL,
    revoked_at      TIMESTAMPTZ,
    revoked_reason  VARCHAR(50),
    CONSTRAINT uq_user_session_token UNIQUE (token_hash)
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user    ON user_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_hash    ON user_sessions (token_hash) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires ON user_sessions (expires_at)  WHERE revoked_at IS NULL;

-- =============================================================================
-- 7. User ↔ Branch Assignments
-- =============================================================================
CREATE TABLE IF NOT EXISTS user_branch_assignments (
    assignment_id       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID        NOT NULL REFERENCES users(user_id),
    branch_id           UUID        NOT NULL REFERENCES branches(branch_id),
    is_default_branch   BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_user_branch UNIQUE (user_id, branch_id)
);

CREATE INDEX idx_uba_user   ON user_branch_assignments (user_id);
CREATE INDEX idx_uba_branch ON user_branch_assignments (branch_id);

-- =============================================================================
-- 8. Permissions (global list — seeded once at deploy)
-- =============================================================================
CREATE TABLE IF NOT EXISTS permissions (
    permission_id   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    module_name     VARCHAR(40) NOT NULL,
    permission_name VARCHAR(80) NOT NULL,
    permission_code VARCHAR(80) NOT NULL UNIQUE,
    description     TEXT
);

-- =============================================================================
-- 9. Role Permissions
-- =============================================================================
CREATE TABLE IF NOT EXISTS role_permissions (
    role_permission_id      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    role_id                 UUID        NOT NULL REFERENCES roles(role_id),
    permission_id           UUID        NOT NULL REFERENCES permissions(permission_id),
    can_create              BOOLEAN     NOT NULL DEFAULT FALSE,
    can_read                BOOLEAN     NOT NULL DEFAULT TRUE,
    can_update              BOOLEAN     NOT NULL DEFAULT FALSE,
    can_delete              BOOLEAN     NOT NULL DEFAULT FALSE,
    can_export              BOOLEAN     NOT NULL DEFAULT FALSE,
    additional_constraints  JSONB,
    CONSTRAINT uq_role_permission UNIQUE (role_id, permission_id)
);

CREATE INDEX idx_rp_role ON role_permissions (role_id);

-- =============================================================================
-- 10. User Roles (role assigned to user, optionally scoped to a branch)
-- =============================================================================
CREATE TABLE IF NOT EXISTS user_roles (
    user_role_id    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID        NOT NULL REFERENCES users(user_id),
    role_id         UUID        NOT NULL REFERENCES roles(role_id),
    branch_id       UUID        REFERENCES branches(branch_id), -- NULL = all branches
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_user_role_branch UNIQUE (user_id, role_id, branch_id)
);

CREATE INDEX idx_ur_user ON user_roles (user_id);

-- =============================================================================
-- 11. Categories
-- =============================================================================
CREATE TABLE IF NOT EXISTS categories (
    category_id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id          UUID        NOT NULL REFERENCES companies(company_id),
    category_name       VARCHAR(80) NOT NULL,
    parent_category_id  UUID        REFERENCES categories(category_id),
    is_active           BOOLEAN     NOT NULL DEFAULT TRUE,
    CONSTRAINT uq_category UNIQUE (company_id, category_name)
);

-- =============================================================================
-- 12. Tax Templates
-- =============================================================================
CREATE TABLE IF NOT EXISTS tax_templates (
    tax_template_id       UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id            UUID            NOT NULL REFERENCES companies(company_id),
    template_name         VARCHAR(60)     NOT NULL,
    tax_type              VARCHAR(20)     NOT NULL DEFAULT 'VAT',
    tax_rate              NUMERIC(6,4)    NOT NULL DEFAULT 0,
    is_inclusive          BOOLEAN         NOT NULL DEFAULT FALSE,
    is_default            BOOLEAN         NOT NULL DEFAULT FALSE,
    applicable_categories JSONB,
    CONSTRAINT uq_tax_template UNIQUE (company_id, template_name)
);

-- =============================================================================
-- 13. Products
-- =============================================================================
CREATE TABLE IF NOT EXISTS products (
    product_id      UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID            NOT NULL REFERENCES companies(company_id),
    sku             VARCHAR(60),
    barcode         VARCHAR(60),
    product_name    VARCHAR(150)    NOT NULL,
    description     TEXT,
    category_id     UUID            REFERENCES categories(category_id),
    tax_template_id UUID            REFERENCES tax_templates(tax_template_id) ON DELETE SET NULL,
    base_price      NUMERIC(15,4)   NOT NULL DEFAULT 0,
    cost_price      NUMERIC(15,4)   NOT NULL DEFAULT 0,
    unit_of_measure VARCHAR(20)     NOT NULL DEFAULT 'unit',
    track_inventory BOOLEAN         NOT NULL DEFAULT TRUE,
    is_service_item BOOLEAN         NOT NULL DEFAULT FALSE,
    image_url       TEXT,
    is_active       BOOLEAN         NOT NULL DEFAULT TRUE,
    deleted_at      TIMESTAMPTZ,
    deleted_by      UUID,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),
    CONSTRAINT uq_sku UNIQUE (company_id, sku)
);

CREATE INDEX idx_products_company  ON products (company_id, is_active);
CREATE INDEX idx_products_category ON products (category_id);
CREATE INDEX idx_products_barcode  ON products (company_id, barcode);
CREATE INDEX IF NOT EXISTS idx_products_active ON products (company_id) WHERE deleted_at IS NULL;

-- =============================================================================
-- 14. Product Branch Pricing
-- =============================================================================
CREATE TABLE IF NOT EXISTS product_branch_pricing (
    pricing_id          UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id          UUID            NOT NULL REFERENCES products(product_id),
    branch_id           UUID            NOT NULL REFERENCES branches(branch_id),
    selling_price       NUMERIC(15,4)   NOT NULL,
    special_price       NUMERIC(15,4),
    special_price_start TIMESTAMPTZ,
    special_price_end   TIMESTAMPTZ,
    is_active           BOOLEAN         NOT NULL DEFAULT TRUE,
    CONSTRAINT uq_product_branch_pricing UNIQUE (product_id, branch_id)
);

-- =============================================================================
-- 15. Product Branch Inventory
-- =============================================================================
CREATE TABLE IF NOT EXISTS product_branch_inventory (
    inventory_id        UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id          UUID            NOT NULL REFERENCES products(product_id),
    branch_id           UUID            NOT NULL REFERENCES branches(branch_id),
    quantity_available  NUMERIC(12,4)   NOT NULL DEFAULT 0,
    quantity_reserved   NUMERIC(12,4)   NOT NULL DEFAULT 0,
    quantity_on_order   NUMERIC(12,4)   NOT NULL DEFAULT 0,
    reorder_level       NUMERIC(12,4)   NOT NULL DEFAULT 0,
    max_stock_level     NUMERIC(12,4),
    last_updated        TIMESTAMPTZ     NOT NULL DEFAULT now(),
    CONSTRAINT uq_product_branch_inv UNIQUE (product_id, branch_id)
);

CREATE INDEX idx_inv_branch_product ON product_branch_inventory (branch_id, product_id);

-- =============================================================================
-- 16. Customer Groups
-- Defined before customers so the FK can be declared inline.
-- =============================================================================
CREATE TABLE IF NOT EXISTS customer_groups (
    group_id                UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id              UUID            NOT NULL REFERENCES companies(company_id),
    group_name              VARCHAR(100)    NOT NULL,
    description             TEXT,
    default_discount_type   VARCHAR(10)     DEFAULT 'none'
                            CHECK (default_discount_type IN ('percentage','fixed','none')),
    default_discount_value  NUMERIC(10,4)   NOT NULL DEFAULT 0,
    is_tax_exempt           BOOLEAN         NOT NULL DEFAULT FALSE,
    tax_exemption_ref       VARCHAR(100),
    allows_credit           BOOLEAN         NOT NULL DEFAULT FALSE,
    credit_limit            NUMERIC(15,2)   NOT NULL DEFAULT 0,
    payment_terms_days      SMALLINT        NOT NULL DEFAULT 0,
    points_multiplier       NUMERIC(5,2)    NOT NULL DEFAULT 1.00,
    is_system_group         BOOLEAN         NOT NULL DEFAULT FALSE,
    is_active               BOOLEAN         NOT NULL DEFAULT TRUE,
    created_at              TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ     NOT NULL DEFAULT now(),
    CONSTRAINT uq_group_name_per_company UNIQUE (company_id, group_name)
);

CREATE INDEX idx_customer_groups_company ON customer_groups (company_id, is_active);

-- =============================================================================
-- 17. Customers
-- =============================================================================
CREATE TABLE IF NOT EXISTS customers (
    customer_id            UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id             UUID            NOT NULL REFERENCES companies(company_id),
    customer_code          VARCHAR(30),
    customer_name          VARCHAR(120)    NOT NULL,
    email                  VARCHAR(150),
    phone                  VARCHAR(30),
    address                TEXT,
    customer_group_id      UUID            REFERENCES customer_groups(group_id),
    date_of_birth          DATE,
    gender                 VARCHAR(10),
    kra_pin                VARCHAR(20),
    id_number              VARCHAR(30),
    loyalty_points_balance INTEGER         NOT NULL DEFAULT 0,
    credit_balance         NUMERIC(15,2)   NOT NULL DEFAULT 0,
    notes                  TEXT,
    deleted_at             TIMESTAMPTZ,
    deleted_by             UUID,
    created_at             TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ     NOT NULL DEFAULT now()
);

CREATE INDEX idx_customers_company ON customers (company_id);
CREATE INDEX idx_customers_phone   ON customers (company_id, phone);
CREATE INDEX IF NOT EXISTS idx_customers_active        ON customers (company_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_customers_company_email ON customers (company_id, email);
CREATE INDEX IF NOT EXISTS idx_customers_company_code  ON customers (company_id, customer_code);
CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_kra_pin
    ON customers (company_id, kra_pin)
    WHERE kra_pin IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_id_number
    ON customers (company_id, id_number)
    WHERE id_number IS NOT NULL AND deleted_at IS NULL;

-- =============================================================================
-- 18. Payment Methods
-- =============================================================================
CREATE TABLE IF NOT EXISTS payment_methods (
    payment_method_id  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id         UUID        NOT NULL REFERENCES companies(company_id),
    method_name        VARCHAR(40) NOT NULL,
    is_active          BOOLEAN     NOT NULL DEFAULT TRUE,
    requires_reference BOOLEAN     NOT NULL DEFAULT FALSE,
    gl_account_id      VARCHAR(40),
    CONSTRAINT uq_payment_method UNIQUE (company_id, method_name)
);

-- =============================================================================
-- 19. Sales Transactions
-- pos_session_id / terminal_id FKs are wired up in 02_pos.sql after those
-- tables exist.
-- =============================================================================
CREATE TABLE IF NOT EXISTS sales_transactions (
    transaction_id     UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id         UUID            NOT NULL REFERENCES companies(company_id),
    branch_id          UUID            NOT NULL REFERENCES branches(branch_id),
    transaction_number VARCHAR(50)     NOT NULL,
    transaction_date   TIMESTAMPTZ     NOT NULL DEFAULT now(),
    customer_id        UUID            REFERENCES customers(customer_id),
    cashier_user_id    UUID            NOT NULL REFERENCES users(user_id),
    pos_session_id     UUID,           -- FK added in 02_pos.sql
    terminal_id        UUID,           -- FK added in 02_pos.sql
    subtotal           NUMERIC(15,2)   NOT NULL DEFAULT 0,
    tax_amount         NUMERIC(15,2)   NOT NULL DEFAULT 0,
    discount_amount    NUMERIC(15,2)   NOT NULL DEFAULT 0,
    total_amount       NUMERIC(15,2)   NOT NULL DEFAULT 0,
    amount_paid        NUMERIC(15,2)   NOT NULL DEFAULT 0,
    change_total       NUMERIC(15,2)   NOT NULL DEFAULT 0,
    payment_method     VARCHAR(40),    -- deprecated; use transaction_payments
    payment_status     VARCHAR(50)     NOT NULL DEFAULT 'paid'
                       CHECK (payment_status IN ('pending','paid','partial','refunded')),
    total_returned     NUMERIC(15,2)   NOT NULL DEFAULT 0,
    return_status      VARCHAR(10)     DEFAULT 'none'
                       CHECK (return_status IN ('none','partial','full')),
    status             VARCHAR(20)     NOT NULL DEFAULT 'completed'
                       CHECK (status IN ('completed','void','refund','held')),
    idempotency_key    TEXT,
    notes              TEXT,
    voided_by_user_id  UUID            REFERENCES users(user_id),
    voided_at          TIMESTAMPTZ,
    void_reason        TEXT,
    receipt_printed    BOOLEAN         NOT NULL DEFAULT FALSE,
    created_at         TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ     NOT NULL DEFAULT now(),
    CONSTRAINT uq_txn_number UNIQUE (company_id, transaction_number)
);

CREATE INDEX idx_txn_branch_date ON sales_transactions (branch_id, transaction_date DESC);
CREATE INDEX idx_txn_cashier     ON sales_transactions (cashier_user_id, transaction_date DESC);
CREATE INDEX idx_txn_company     ON sales_transactions (company_id, transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_txn_payment_status ON sales_transactions (company_id, payment_status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_txn_idempotency
    ON sales_transactions (company_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

-- =============================================================================
-- 20. Password Reset Tokens
-- =============================================================================
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    token_id    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID        NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    token_hash  TEXT        NOT NULL UNIQUE,
    expires_at  TIMESTAMPTZ NOT NULL,
    used_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prt_user    ON password_reset_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_prt_expires ON password_reset_tokens (expires_at) WHERE used_at IS NULL;

-- =============================================================================
-- 21. Subscription Interest Leads
-- =============================================================================
CREATE TABLE IF NOT EXISTS subscription_interests (
    interest_id   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name     VARCHAR(150) NOT NULL,
    email         VARCHAR(255) NOT NULL,
    phone         VARCHAR(30),
    business_name VARCHAR(150) NOT NULL,
    message       TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================================
-- 22. Sales Transaction Items
-- =============================================================================
CREATE TABLE IF NOT EXISTS sales_transaction_items (
    item_id        UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id UUID            NOT NULL REFERENCES sales_transactions(transaction_id),
    product_id     UUID            NOT NULL REFERENCES products(product_id),
    quantity       NUMERIC(12,4)   NOT NULL,
    unit_price     NUMERIC(15,4)   NOT NULL,
    discount       NUMERIC(15,4)   NOT NULL DEFAULT 0,
    tax_amount     NUMERIC(15,4)   NOT NULL DEFAULT 0,
    line_total     NUMERIC(15,2)   NOT NULL
);

CREATE INDEX idx_txn_items_txn ON sales_transaction_items (transaction_id);
