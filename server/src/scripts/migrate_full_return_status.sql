-- Migration: update sale status to 'refund' when fully returned
-- Re-creates the sync_transaction_return_totals trigger function to also
-- update sales_transactions.status when return_status becomes 'full'.

CREATE OR REPLACE FUNCTION sync_transaction_return_totals()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    v_returned NUMERIC;
BEGIN
    IF NEW.status IN ('refunded','approved') THEN
        SELECT COALESCE(SUM(r2.total_refunded), 0)
        INTO v_returned
        FROM returns r2
        WHERE r2.original_transaction_id = NEW.original_transaction_id
          AND r2.status IN ('approved','refunded');

        UPDATE sales_transactions st
        SET total_returned = v_returned,
            return_status  = CASE
                WHEN v_returned >= st.total_amount THEN 'full'
                WHEN v_returned > 0                THEN 'partial'
                ELSE 'none'
            END,
            status = CASE
                WHEN v_returned >= st.total_amount AND st.status = 'completed' THEN 'refund'
                WHEN v_returned <  st.total_amount AND st.status = 'refund'    THEN 'completed'
                ELSE st.status
            END,
            updated_at = now()
        WHERE st.transaction_id = NEW.original_transaction_id;
    END IF;
    RETURN NEW;
END;
$$;

-- Fix existing rows already fully returned but still marked completed
UPDATE sales_transactions
SET status     = 'refund',
    updated_at = now()
WHERE return_status = 'full'
  AND status        = 'completed';
