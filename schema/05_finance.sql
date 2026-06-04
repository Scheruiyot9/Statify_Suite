-- =============================================================================
-- 05_finance.sql — Chart of accounts, double-entry ledger, bank accounts, journals
-- ledger_entry_lines is created here directly (final name, no rename migration needed).
-- Depends on: 01_core.sql
-- =============================================================================

-- =============================================================================
-- 1. Chart of Accounts
-- =============================================================================
CREATE TABLE IF NOT EXISTS accounts (
    account_id        UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id        UUID         NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
    account_code      VARCHAR(20)  NOT NULL,
    account_name      VARCHAR(100) NOT NULL,
    account_type      VARCHAR(20)  NOT NULL
                      CHECK (account_type IN ('asset','liability','equity','revenue','expense')),
    account_subtype   VARCHAR(50),
    parent_account_id UUID         REFERENCES accounts(account_id),
    description       TEXT,
    is_active         BOOLEAN      NOT NULL DEFAULT TRUE,
    is_system         BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
    UNIQUE (company_id, account_code)
);

CREATE INDEX IF NOT EXISTS idx_accounts_company ON accounts (company_id);
CREATE INDEX IF NOT EXISTS idx_accounts_type    ON accounts (company_id, account_type);

-- =============================================================================
-- 2. Bank Accounts
-- =============================================================================
CREATE TABLE IF NOT EXISTS bank_accounts (
    bank_account_id UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID          NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
    branch_id       UUID          REFERENCES branches(branch_id),
    account_id      UUID          REFERENCES accounts(account_id),
    account_name    VARCHAR(100)  NOT NULL,
    bank_name       VARCHAR(100)  NOT NULL,
    account_number  VARCHAR(50),
    bank_branch     VARCHAR(100),
    currency        VARCHAR(3)    NOT NULL DEFAULT 'KES',
    opening_balance NUMERIC(15,2) NOT NULL DEFAULT 0,
    current_balance NUMERIC(15,2) NOT NULL DEFAULT 0,
    is_active       BOOLEAN       NOT NULL DEFAULT TRUE,
    is_default      BOOLEAN       NOT NULL DEFAULT FALSE,
    notes           TEXT,
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bank_accounts_company ON bank_accounts (company_id);

-- =============================================================================
-- 3. Journal Entries (double-entry ledger header)
-- =============================================================================
CREATE TABLE IF NOT EXISTS journal_entries (
    journal_entry_id   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id         UUID         NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
    entry_number       VARCHAR(30)  NOT NULL,
    entry_date         DATE         NOT NULL,
    description        TEXT,
    -- Source types: SALE | GRN | PAYMENT | PAYMENT_VOID | RETURN | OPENING | MANUAL | VOID
    source_type        VARCHAR(30)  NOT NULL DEFAULT 'MANUAL',
    source_id          UUID,
    status             VARCHAR(20)  NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','void')),
    created_by_user_id UUID,
    voided_by_user_id  UUID,
    voided_at          TIMESTAMPTZ,
    void_reason        TEXT,
    created_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_je_company ON journal_entries (company_id);
CREATE INDEX IF NOT EXISTS idx_je_date    ON journal_entries (company_id, entry_date);
CREATE INDEX IF NOT EXISTS idx_je_source  ON journal_entries (company_id, source_type, source_id);

-- =============================================================================
-- 4. Ledger Entry Lines (Dr/Cr pairs)
-- Includes reconciliation columns and entity sub-ledger linkage.
-- =============================================================================
CREATE TABLE IF NOT EXISTS ledger_entry_lines (
    line_id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    journal_entry_id       UUID          NOT NULL REFERENCES journal_entries(journal_entry_id) ON DELETE CASCADE,
    account_id             UUID          NOT NULL REFERENCES accounts(account_id),
    description            TEXT,
    debit                  NUMERIC(15,4) NOT NULL DEFAULT 0,
    credit                 NUMERIC(15,4) NOT NULL DEFAULT 0,
    line_order             INTEGER       NOT NULL DEFAULT 0,
    is_reconciled          BOOLEAN       NOT NULL DEFAULT FALSE,
    reconciled_at          TIMESTAMPTZ,
    reconciled_by_user_id  UUID          REFERENCES users(user_id),
    entity_type            VARCHAR(30)
                           CHECK (entity_type IN ('customer','supplier','bank_account','employee','product')
                                  OR entity_type IS NULL),
    entity_id              UUID,
    created_at             TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CONSTRAINT chk_dr_cr CHECK (debit >= 0 AND credit >= 0 AND NOT (debit > 0 AND credit > 0))
);

CREATE INDEX IF NOT EXISTS idx_lel_entry        ON ledger_entry_lines (journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_lel_account      ON ledger_entry_lines (account_id);
CREATE INDEX IF NOT EXISTS idx_lel_acct_date    ON ledger_entry_lines (account_id, journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_lel_unreconciled ON ledger_entry_lines (account_id, is_reconciled)
    WHERE NOT is_reconciled;
CREATE INDEX IF NOT EXISTS idx_lel_entity       ON ledger_entry_lines (entity_type, entity_id)
    WHERE entity_id IS NOT NULL;

-- =============================================================================
-- 5. Journals (operational document; posts to ledger on confirmation)
-- =============================================================================
CREATE TABLE IF NOT EXISTS journals (
    journal_id         UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id         UUID            NOT NULL REFERENCES companies(company_id),
    branch_id          UUID            REFERENCES branches(branch_id),
    journal_number     VARCHAR(30)     NOT NULL,
    entry_date         DATE            NOT NULL,
    description        TEXT,
    reference          VARCHAR(100),
    status             VARCHAR(10)     NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft','posted','void')),
    ledger_entry_id    UUID            REFERENCES journal_entries(journal_entry_id),
    created_by_user_id UUID            REFERENCES users(user_id),
    posted_by_user_id  UUID            REFERENCES users(user_id),
    posted_at          TIMESTAMPTZ,
    voided_by_user_id  UUID            REFERENCES users(user_id),
    voided_at          TIMESTAMPTZ,
    void_reason        TEXT,
    created_at         TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ     NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_journals_company ON journals (company_id, entry_date DESC);

-- =============================================================================
-- 6. Journal Lines (draft lines before posting to ledger)
-- =============================================================================
CREATE TABLE IF NOT EXISTS journal_lines (
    journal_line_id UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    journal_id      UUID          NOT NULL REFERENCES journals(journal_id) ON DELETE CASCADE,
    account_id      UUID          NOT NULL REFERENCES accounts(account_id),
    description     TEXT,
    debit           NUMERIC(15,4) NOT NULL DEFAULT 0,
    credit          NUMERIC(15,4) NOT NULL DEFAULT 0,
    entity_type     VARCHAR(30)
                    CHECK (entity_type IN ('customer','supplier','bank_account','employee','product')
                           OR entity_type IS NULL),
    entity_id       UUID,
    line_order      INTEGER       NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_journal_lines_jrnl ON journal_lines (journal_id);
