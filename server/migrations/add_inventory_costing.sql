-- Company-level costing method
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS costing_method VARCHAR(20) NOT NULL DEFAULT 'weighted_average';

-- FIFO cost layers — one row per GRN receipt batch per product per branch
CREATE TABLE IF NOT EXISTS inventory_cost_layers (
  layer_id      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID        NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  branch_id     UUID        NOT NULL REFERENCES branches(branch_id)  ON DELETE CASCADE,
  product_id    UUID        NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
  grn_id        UUID        REFERENCES grns(grn_id) ON DELETE SET NULL,
  unit_cost     NUMERIC(18,4) NOT NULL DEFAULT 0,
  qty_original  NUMERIC(18,4) NOT NULL,
  qty_remaining NUMERIC(18,4) NOT NULL,
  received_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index used by the FIFO dequeue (oldest-first per product per branch)
CREATE INDEX IF NOT EXISTS idx_cost_layers_lookup
  ON inventory_cost_layers (company_id, branch_id, product_id, received_at)
  WHERE qty_remaining > 0;
