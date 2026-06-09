-- Migration: inventory_movements table (stock ledger)
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS inventory_movements (
  movement_id    UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     UUID            NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  branch_id      UUID            NOT NULL REFERENCES branches(branch_id),
  product_id     UUID            NOT NULL REFERENCES products(product_id),
  movement_type  VARCHAR(30)     NOT NULL,  -- sale, return, grn, adjustment, opening_stock, transfer_in, transfer_out
  qty_in         NUMERIC(12,4)   NOT NULL DEFAULT 0,
  qty_out        NUMERIC(12,4)   NOT NULL DEFAULT 0,
  qty_before     NUMERIC(12,4)   NOT NULL,
  qty_after      NUMERIC(12,4)   NOT NULL,
  reference_type VARCHAR(30),               -- SALE, GRN, RETURN, ADJUSTMENT, etc.
  reference_id   UUID,                      -- FK to the source document
  reference_no   VARCHAR(50),               -- human-readable e.g. TXN-2026-000012
  notes          TEXT,
  created_by     UUID            REFERENCES users(user_id),
  created_at     TIMESTAMPTZ     NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inv_mov_company   ON inventory_movements (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inv_mov_product   ON inventory_movements (product_id, branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inv_mov_branch    ON inventory_movements (branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inv_mov_reference ON inventory_movements (reference_id);
