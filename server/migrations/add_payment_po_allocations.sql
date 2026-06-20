ALTER TABLE supplier_payments
  ADD COLUMN IF NOT EXISTS po_allocations JSONB;
