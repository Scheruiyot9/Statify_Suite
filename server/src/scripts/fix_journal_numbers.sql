-- Fix journal entries that were saved with 'undefined' in their number.
-- Renumbers them per company in chronological order, then syncs journal_counter.

DO $$
DECLARE
  r RECORD;
  seq INT;
  new_number TEXT;
BEGIN
  -- Process each bad journal per company in created_at order
  FOR r IN
    SELECT j.journal_id, j.company_id, j.created_at,
           EXTRACT(YEAR FROM j.entry_date)::INT AS yr
    FROM journals j
    WHERE j.journal_number LIKE '%undefined%'
    ORDER BY j.company_id, j.created_at
  LOOP
    -- Get next counter for this company
    UPDATE companies
    SET journal_counter = journal_counter + 1
    WHERE company_id = r.company_id
    RETURNING journal_counter INTO seq;

    new_number := 'JNL-' || r.yr || '-' || LPAD(seq::TEXT, 5, '0');

    UPDATE journals
    SET journal_number = new_number
    WHERE journal_id = r.journal_id;

    RAISE NOTICE 'Fixed journal % → %', r.journal_id, new_number;
  END LOOP;
END $$;
