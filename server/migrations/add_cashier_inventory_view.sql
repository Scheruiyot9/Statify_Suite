-- Grant view_inventory to cashier role (read-only; adjust_stock is NOT included)
INSERT INTO role_permissions (role_permission_id, role_id, permission_id, can_read, can_create, can_update, can_delete, can_export)
SELECT gen_random_uuid(), r.role_id, p.permission_id, TRUE, FALSE, FALSE, FALSE, FALSE
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name = 'cashier'
  AND p.permission_code = 'view_inventory'
ON CONFLICT DO NOTHING;
