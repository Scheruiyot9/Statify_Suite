-- Migration: merge inventory_manager → accountant, remove sales_staff
-- Run once on production DB before or immediately after deploying the new code.
-- Safe to re-run (uses IF EXISTS / ON CONFLICT DO NOTHING).

BEGIN;

-- 1. Reassign all users currently holding inventory_manager role → accountant
--    (within the same company so the accountant role_id is the correct one)
UPDATE user_roles ur
SET role_id = r_new.role_id
FROM roles r_old
JOIN roles r_new
  ON r_new.company_id = r_old.company_id
  AND r_new.role_name = 'accountant'
WHERE ur.role_id = r_old.role_id
  AND r_old.role_name = 'inventory_manager';

-- 2. Reassign sales_staff users → cashier (lowest available role with POS access)
UPDATE user_roles ur
SET role_id = r_new.role_id
FROM roles r_old
JOIN roles r_new
  ON r_new.company_id = r_old.company_id
  AND r_new.role_name = 'cashier'
WHERE ur.role_id = r_old.role_id
  AND r_old.role_name = 'sales_staff';

-- 3. Remove role_permissions rows for the dropped roles
DELETE FROM role_permissions
WHERE role_id IN (
  SELECT role_id FROM roles WHERE role_name IN ('inventory_manager', 'sales_staff')
);

-- 4. Remove the role rows themselves
DELETE FROM roles WHERE role_name IN ('inventory_manager', 'sales_staff');

-- 5. Update accountant role_permissions to include the merged permissions
--    (manage_products, adjust_stock — add only if not already present)
INSERT INTO role_permissions (role_permission_id, role_id, permission_id, can_create, can_read, can_update, can_delete, can_export)
SELECT
  gen_random_uuid(),
  r.role_id,
  p.permission_id,
  TRUE, TRUE, TRUE, FALSE, TRUE
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name = 'accountant'
  AND p.permission_code IN ('manage_products', 'adjust_stock', 'transfer_stock')
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp
    WHERE rp.role_id = r.role_id AND rp.permission_id = p.permission_id
  );

-- 6. Remove view_reports from branch_manager role_permissions
--    (branch managers no longer see finance reports)
DELETE FROM role_permissions
WHERE role_id IN (SELECT role_id FROM roles WHERE role_name = 'branch_manager')
  AND permission_id IN (
    SELECT permission_id FROM permissions
    WHERE permission_code IN ('view_reports', 'export_reports', 'view_all_branches')
  );

COMMIT;
