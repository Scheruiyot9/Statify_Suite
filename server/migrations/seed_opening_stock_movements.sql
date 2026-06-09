-- One-time script: seed opening balance entries in inventory_movements
-- for every active product/branch that has stock recorded.
-- Safe to run ONCE after add_inventory_movements.sql has been applied.
-- Running it again will create duplicate opening entries — guard with the EXISTS check below.

INSERT INTO inventory_movements (
  company_id,
  branch_id,
  product_id,
  movement_type,
  qty_in,
  qty_out,
  qty_before,
  qty_after,
  reference_type,
  reference_no,
  notes,
  created_at
)
SELECT
  p.company_id,
  pbi.branch_id,
  pbi.product_id,
  'opening_stock',
  pbi.quantity_available,   -- qty_in
  0,                        -- qty_out
  0,                        -- qty_before (nothing before opening)
  pbi.quantity_available,   -- qty_after
  'OPENING',
  'OPENING-BALANCE',
  'Opening stock balance recorded at system go-live',
  now()
FROM product_branch_inventory pbi
JOIN products  p ON p.product_id = pbi.product_id
JOIN branches  b ON b.branch_id  = pbi.branch_id AND b.is_active = TRUE
WHERE p.is_active = TRUE
  AND pbi.quantity_available > 0
  -- Guard: skip if any opening_stock entry already exists for this product/branch
  AND NOT EXISTS (
    SELECT 1 FROM inventory_movements im
    WHERE im.product_id    = pbi.product_id
      AND im.branch_id     = pbi.branch_id
      AND im.movement_type = 'opening_stock'
  );
