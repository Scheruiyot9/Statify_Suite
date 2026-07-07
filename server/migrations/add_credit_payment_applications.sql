-- Migration: track which invoices a credit payment applied to, and how much,
-- so a later void can restore payment_status precisely rather than guessing —
-- a single credit payment can FIFO-cover several invoices at once, and nothing
-- previously recorded which ones.

CREATE TABLE IF NOT EXISTS credit_payment_applications (
  application_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       UUID NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  journal_entry_id UUID NOT NULL REFERENCES journal_entries(journal_entry_id) ON DELETE CASCADE,
  customer_id      UUID NOT NULL REFERENCES customers(customer_id),
  transaction_id   UUID NOT NULL REFERENCES sales_transactions(transaction_id),
  amount_applied   NUMERIC(15,2) NOT NULL,
  previous_status  VARCHAR(20) NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_credit_payment_applications_je ON credit_payment_applications(journal_entry_id);

-- Link customer_topups (used for POS session cash reconciliation) back to the
-- journal entry that created them, so voiding the payment can remove the topup
-- row too — otherwise a voided payment would still count as "cash received"
-- when a session closes (same class of bug fixed for cash-outs/transfers).
ALTER TABLE customer_topups
  ADD COLUMN IF NOT EXISTS journal_entry_id UUID REFERENCES journal_entries(journal_entry_id) ON DELETE SET NULL;
