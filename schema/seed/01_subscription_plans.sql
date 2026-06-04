-- =============================================================================
-- seed/01_subscription_plans.sql — Canonical subscription plan tiers
--
-- Run on EVERY environment including production after schema migration.
-- Uses ON CONFLICT so it is safe to re-run (idempotent).
--
-- NOT included in the schema migration runner (migrate.js).
-- Run separately:
--   psql $DATABASE_URL -f schema/seed/01_subscription_plans.sql
-- =============================================================================

INSERT INTO subscription_plans
    (plan_name, price, annual_price, billing_cycle,
     max_users, max_branches,
     has_finance, has_api_access,
     trial_days, sort_order, features_json)
VALUES
    ('Trial',      0,     0,      'monthly',  2,  1, FALSE, FALSE, 3, 0,
     '{"pos":true,"finance":false,"api":false}'),
    ('Basic',    999,   9990,   'monthly',  3,  1, FALSE, FALSE, 3, 1,
     '{"pos":true,"finance":false,"api":false}'),
    ('Premium',     2999,  29990,  'monthly', 15,  3, TRUE,  FALSE, 7, 2,
     '{"pos":true,"finance":true,"api":false}'),
    ('Enterprise', 7999,  79990,  'monthly', -1, -1, TRUE,  TRUE,  14, 3,
     '{"pos":true,"finance":true,"api":true,"custom":true}')
ON CONFLICT (plan_name) DO UPDATE
    SET price          = EXCLUDED.price,
        annual_price   = EXCLUDED.annual_price,
        max_users      = EXCLUDED.max_users,
        max_branches   = EXCLUDED.max_branches,
        has_finance    = EXCLUDED.has_finance,
        has_api_access = EXCLUDED.has_api_access,
        sort_order     = EXCLUDED.sort_order,
        features_json  = EXCLUDED.features_json;

-- Retire any legacy plan names not in the current tier structure
UPDATE subscription_plans
    SET is_active = FALSE
WHERE plan_name NOT IN ('Trial','Basic','Premium','Enterprise');
