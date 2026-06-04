/**
 * Dev/staging seed script — populates the database with demo data.
 * Run AFTER migrate.js and 01_subscription_plans.sql.
 *
 * Usage:  node src/scripts/seed.js
 *
 * NOT for production use.
 *
 * Login credentials created (all use Password@123):
 * ┌─────────────────────────────┬──────────────┬─────────────────┐
 * │ Email                       │ Password     │ Role            │
 * ├─────────────────────────────┼──────────────┼─────────────────┤
 * │ super@statify.com           │ Password@123 │ super_admin     │
 * │ admin@freshmart.com         │ Password@123 │ company_admin   │
 * │ manager@freshmart.com       │ Password@123 │ branch_manager  │
 * │ cashier@freshmart.com       │ Password@123 │ cashier         │
 * │ inventory@freshmart.com     │ Password@123 │ inventory_mgr   │
 * │ admin@techzone.com          │ Password@123 │ company_admin   │
 * └─────────────────────────────┴──────────────┴─────────────────┘
 */

require('dotenv').config();
const bcrypt   = require('bcryptjs');
const { pool } = require('../config/database');

const COST = 10;
const PWD  = 'Password@123';

const hash = (p) => bcrypt.hash(p, COST);

async function seed() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    console.log('🌱 Seeding database…');

    // ── 1. Resolve canonical plan IDs ───────────────────────────────────────
    // Expects 01_subscription_plans.sql to have been run already.
    const plans = await client.query(
      `SELECT plan_id, plan_name FROM subscription_plans WHERE plan_name IN ('Premium','Basic') AND is_active = TRUE`
    );

    const planMap = Object.fromEntries(plans.rows.map(r => [r.plan_name, r.plan_id]));

    if (!planMap['Premium'] || !planMap['Basic']) {
      throw new Error(
        'Required subscription plans not found. Run schema/seed/01_subscription_plans.sql first.'
      );
    }
    console.log('  ✓ Subscription plans resolved');

    // ── 2. Companies ────────────────────────────────────────────────────────
    const companies = await client.query(`
      INSERT INTO companies
        (company_id, company_name, subscription_plan_id, subscription_status,
         subscription_start_date, contact_email, contact_phone, address, currency, country)
      VALUES
        (gen_random_uuid(), 'FreshMart Supermarket', $1, 'active',
         CURRENT_DATE, 'admin@freshmart.com', '+254700111222',
         'Westlands, Nairobi', 'KES', 'Kenya'),
        (gen_random_uuid(), 'TechZone Electronics', $2, 'active',
         CURRENT_DATE, 'admin@techzone.com', '+254700333444',
         'CBD, Nairobi', 'KES', 'Kenya')
      ON CONFLICT DO NOTHING
      RETURNING company_id, company_name
    `, [planMap['Premium'], planMap['Basic']]);

    const [freshmart, techzone] = companies.rows;
    console.log('  ✓ Companies');

    // ── 3. Branches ─────────────────────────────────────────────────────────
    const branches = await client.query(`
      INSERT INTO branches
        (branch_id, company_id, branch_name, branch_code, address, phone, is_headquarters)
      VALUES
        (gen_random_uuid(), $1, 'Westlands HQ',      'FM-WL', 'Westlands, Nairobi',  '+254700111222', TRUE),
        (gen_random_uuid(), $1, 'Kilimani Branch',   'FM-KL', 'Kilimani, Nairobi',   '+254700111223', FALSE),
        (gen_random_uuid(), $1, 'Thika Road Branch', 'FM-TR', 'Thika Rd, Nairobi',   '+254700111224', FALSE),
        (gen_random_uuid(), $2, 'CBD Store',         'TZ-CB', 'CBD, Nairobi',         '+254700333444', TRUE)
      RETURNING branch_id, branch_name, company_id
    `, [freshmart.company_id, techzone.company_id]);

    const fmBranches = branches.rows.filter(b => b.company_id === freshmart.company_id);
    const tzBranches = branches.rows.filter(b => b.company_id === techzone.company_id);
    const [fmHQ, fmKilimani] = fmBranches;
    const [tzCBD] = tzBranches;
    console.log('  ✓ Branches');

    // ── 4. System Roles ─────────────────────────────────────────────────────
    const roles = await client.query(`
      INSERT INTO roles (role_id, company_id, role_name, is_system_role)
      VALUES
        (gen_random_uuid(), NULL, 'super_admin',       TRUE),
        (gen_random_uuid(), $1,  'company_admin',      TRUE),
        (gen_random_uuid(), $1,  'branch_manager',     TRUE),
        (gen_random_uuid(), $1,  'cashier',            TRUE),
        (gen_random_uuid(), $1,  'inventory_manager',  TRUE),
        (gen_random_uuid(), $1,  'accountant',         TRUE),
        (gen_random_uuid(), $1,  'sales_staff',        TRUE),
        (gen_random_uuid(), $2,  'company_admin',      TRUE),
        (gen_random_uuid(), $2,  'cashier',            TRUE)
      ON CONFLICT (company_id, role_name) DO NOTHING
      RETURNING role_id, role_name, company_id
    `, [freshmart.company_id, techzone.company_id]);

    const roleByName = (name, companyId = null) =>
      roles.rows.find(r => r.role_name === name && r.company_id === companyId)?.role_id
      ?? roles.rows.find(r => r.role_name === name)?.role_id;

    console.log('  ✓ Roles');

    // ── 5. Permissions ──────────────────────────────────────────────────────
    const perms = await client.query(`
      INSERT INTO permissions (permission_id, module_name, permission_name, permission_code)
      VALUES
        (gen_random_uuid(), 'sales',     'View Sales',         'view_sales'),
        (gen_random_uuid(), 'sales',     'Create Transaction', 'create_transaction'),
        (gen_random_uuid(), 'sales',     'Void Transaction',   'void_transaction'),
        (gen_random_uuid(), 'sales',     'Process Refund',     'process_refund'),
        (gen_random_uuid(), 'sales',     'Apply Discount',     'apply_discount'),
        (gen_random_uuid(), 'inventory', 'View Inventory',     'view_inventory'),
        (gen_random_uuid(), 'inventory', 'Adjust Stock',       'adjust_stock'),
        (gen_random_uuid(), 'inventory', 'Transfer Stock',     'transfer_stock'),
        (gen_random_uuid(), 'products',  'View Products',      'view_products'),
        (gen_random_uuid(), 'products',  'Manage Products',    'manage_products'),
        (gen_random_uuid(), 'customers', 'View Customers',     'view_customers'),
        (gen_random_uuid(), 'customers', 'Manage Customers',   'manage_customers'),
        (gen_random_uuid(), 'reports',   'View Reports',       'view_reports'),
        (gen_random_uuid(), 'reports',   'View All Branches',  'view_all_branches'),
        (gen_random_uuid(), 'reports',   'Export Reports',     'export_reports'),
        (gen_random_uuid(), 'users',     'Manage Users',       'manage_users'),
        (gen_random_uuid(), 'settings',  'Manage Settings',    'manage_settings'),
        (gen_random_uuid(), 'pos',       'Open POS Session',   'open_pos_session')
      ON CONFLICT (permission_code) DO NOTHING
      RETURNING permission_id, permission_code
    `);

    const permMap = Object.fromEntries(perms.rows.map(r => [r.permission_code, r.permission_id]));
    console.log('  ✓ Permissions');

    // ── 6. Role Permissions ─────────────────────────────────────────────────
    const cashierPerms = ['view_sales','create_transaction','void_transaction','apply_discount',
                          'view_products','view_customers','view_inventory','open_pos_session'];
    const managerPerms = [...cashierPerms, 'process_refund','adjust_stock','transfer_stock',
                          'view_reports','manage_customers'];
    const adminPerms   = [...managerPerms, 'manage_products','manage_users','manage_settings',
                          'view_all_branches','export_reports'];
    const invMgrPerms  = ['view_inventory','adjust_stock','transfer_stock','view_products','view_reports'];

    const insertRolePerms = async (roleId, codes) => {
      for (const code of codes) {
        if (!permMap[code]) continue;
        await client.query(`
          INSERT INTO role_permissions
            (role_permission_id, role_id, permission_id, can_create, can_read, can_update, can_delete, can_export)
          VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT DO NOTHING
        `, [roleId, permMap[code], true, true, true, false, true]);
      }
    };

    const fmCashierId  = roleByName('cashier',           freshmart.company_id);
    const fmManagerId  = roleByName('branch_manager',    freshmart.company_id);
    const fmAdminId    = roleByName('company_admin',     freshmart.company_id);
    const fmInvMgrId   = roleByName('inventory_manager', freshmart.company_id);
    const superAdminId = roleByName('super_admin');
    const tzAdminId    = roleByName('company_admin',     techzone.company_id);
    const tzCashierId  = roleByName('cashier',           techzone.company_id);

    await insertRolePerms(fmCashierId,  cashierPerms);
    await insertRolePerms(fmManagerId,  managerPerms);
    await insertRolePerms(fmAdminId,    adminPerms);
    await insertRolePerms(fmInvMgrId,   invMgrPerms);
    await insertRolePerms(superAdminId, adminPerms);
    await insertRolePerms(tzAdminId,    adminPerms);
    await insertRolePerms(tzCashierId,  cashierPerms);
    console.log('  ✓ Role permissions');

    // ── 7. Users ────────────────────────────────────────────────────────────
    const pwdHash = await hash(PWD);

    const users = await client.query(`
      INSERT INTO users
        (user_id, company_id, username, email, password_hash, first_name, last_name, phone)
      VALUES
        (gen_random_uuid(), NULL,  'superadmin',  'super@statify.com',       $1, 'System',  'Admin',   NULL),
        (gen_random_uuid(), $2,   'fmadmin',     'admin@freshmart.com',      $1, 'Jane',    'Kamau',   '+254711000001'),
        (gen_random_uuid(), $2,   'fmmanager',   'manager@freshmart.com',    $1, 'David',   'Mwangi',  '+254711000002'),
        (gen_random_uuid(), $2,   'fmcashier',   'cashier@freshmart.com',    $1, 'Grace',   'Atieno',  '+254711000003'),
        (gen_random_uuid(), $2,   'fminventory', 'inventory@freshmart.com',  $1, 'Peter',   'Ochieng', '+254711000004'),
        (gen_random_uuid(), $3,   'tzadmin',     'admin@techzone.com',       $1, 'Ali',     'Hassan',  '+254711000005'),
        (gen_random_uuid(), $3,   'tzcashier',   'cashier@techzone.com',     $1, 'Fatuma',  'Omar',    '+254711000006')
      ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
      RETURNING user_id, email, company_id
    `, [pwdHash, freshmart.company_id, techzone.company_id]);

    const userMap = Object.fromEntries(users.rows.map(r => [r.email, r.user_id]));
    console.log('  ✓ Users');

    // ── 8. User Roles ───────────────────────────────────────────────────────
    await client.query(`
      INSERT INTO user_roles (user_role_id, user_id, role_id, branch_id)
      VALUES
        (gen_random_uuid(), $1,  $2,  NULL),
        (gen_random_uuid(), $3,  $4,  NULL),
        (gen_random_uuid(), $5,  $6,  $7),
        (gen_random_uuid(), $8,  $9,  $7),
        (gen_random_uuid(), $10, $11, $7),
        (gen_random_uuid(), $12, $13, NULL),
        (gen_random_uuid(), $14, $15, $16)
      ON CONFLICT DO NOTHING
    `, [
      userMap['super@statify.com'],       superAdminId,
      userMap['admin@freshmart.com'],     fmAdminId,
      userMap['manager@freshmart.com'],   fmManagerId,   fmHQ.branch_id,
      userMap['cashier@freshmart.com'],   fmCashierId,
      userMap['inventory@freshmart.com'], fmInvMgrId,
      userMap['admin@techzone.com'],      tzAdminId,
      userMap['cashier@techzone.com'],    tzCashierId,   tzCBD.branch_id,
    ]);
    console.log('  ✓ User roles');

    // ── 9. User Branch Assignments ──────────────────────────────────────────
    await client.query(`
      INSERT INTO user_branch_assignments (assignment_id, user_id, branch_id, is_default_branch)
      VALUES
        (gen_random_uuid(), $1, $2, TRUE),
        (gen_random_uuid(), $3, $2, TRUE),
        (gen_random_uuid(), $3, $4, FALSE),
        (gen_random_uuid(), $5, $2, TRUE),
        (gen_random_uuid(), $6, $2, TRUE),
        (gen_random_uuid(), $7, $8, TRUE)
      ON CONFLICT DO NOTHING
    `, [
      userMap['manager@freshmart.com'],    fmHQ.branch_id,
      userMap['cashier@freshmart.com'],    fmKilimani.branch_id,
      userMap['inventory@freshmart.com'],
      userMap['admin@freshmart.com'],
      userMap['cashier@techzone.com'],     tzCBD.branch_id,
    ]);
    console.log('  ✓ User branch assignments');

    // ── 10. Payment Methods ─────────────────────────────────────────────────
    await client.query(`
      INSERT INTO payment_methods (payment_method_id, company_id, method_name, requires_reference)
      VALUES
        (gen_random_uuid(), $1, 'Cash',   FALSE),
        (gen_random_uuid(), $1, 'Card',   TRUE),
        (gen_random_uuid(), $1, 'Mobile', TRUE),
        (gen_random_uuid(), $2, 'Cash',   FALSE),
        (gen_random_uuid(), $2, 'Card',   TRUE),
        (gen_random_uuid(), $2, 'Mobile', TRUE)
      ON CONFLICT DO NOTHING
    `, [freshmart.company_id, techzone.company_id]);
    console.log('  ✓ Payment methods');

    // ── 11. Chart of Accounts ───────────────────────────────────────────────
    const COA = [
      { code: '1000', name: 'Cash on Hand',            type: 'asset',     subtype: 'current_asset',     system: true  },
      { code: '1010', name: 'Bank - Main Account',     type: 'asset',     subtype: 'current_asset',     system: false },
      { code: '1100', name: 'Accounts Receivable',     type: 'asset',     subtype: 'current_asset',     system: true  },
      { code: '1200', name: 'Inventory',               type: 'asset',     subtype: 'current_asset',     system: true  },
      { code: '1300', name: 'Prepaid Expenses',        type: 'asset',     subtype: 'current_asset',     system: false },
      { code: '1500', name: 'Fixed Assets',            type: 'asset',     subtype: 'fixed_asset',       system: false },
      { code: '1510', name: 'Accumulated Depreciation',type: 'asset',     subtype: 'fixed_asset',       system: false },
      { code: '2000', name: 'Accounts Payable',        type: 'liability', subtype: 'current_liability', system: true  },
      { code: '2100', name: 'VAT Payable',             type: 'liability', subtype: 'current_liability', system: false },
      { code: '2200', name: 'PAYE Payable',            type: 'liability', subtype: 'current_liability', system: false },
      { code: '2300', name: 'Short-term Loans',        type: 'liability', subtype: 'current_liability', system: false },
      { code: '3000', name: "Owner's Capital",         type: 'equity',    subtype: null,                system: false },
      { code: '3100', name: 'Retained Earnings',       type: 'equity',    subtype: null,                system: false },
      { code: '4000', name: 'Sales Revenue',           type: 'revenue',   subtype: null,                system: true  },
      { code: '4100', name: 'Service Revenue',         type: 'revenue',   subtype: null,                system: false },
      { code: '4200', name: 'Other Income',            type: 'revenue',   subtype: null,                system: false },
      { code: '5000', name: 'Cost of Goods Sold',      type: 'expense',   subtype: null,                system: true  },
      { code: '5100', name: 'Salaries & Wages',        type: 'expense',   subtype: null,                system: false },
      { code: '5200', name: 'Rent',                    type: 'expense',   subtype: null,                system: false },
      { code: '5300', name: 'Utilities',               type: 'expense',   subtype: null,                system: false },
      { code: '5400', name: 'Marketing & Advertising', type: 'expense',   subtype: null,                system: false },
      { code: '5500', name: 'Office Supplies',         type: 'expense',   subtype: null,                system: false },
      { code: '5600', name: 'Depreciation',            type: 'expense',   subtype: null,                system: false },
      { code: '5700', name: 'Bank Charges',            type: 'expense',   subtype: null,                system: false },
      { code: '5800', name: 'Other Expenses',          type: 'expense',   subtype: null,                system: false },
    ];
    for (const cid of [freshmart.company_id, techzone.company_id]) {
      for (const a of COA) {
        await client.query(`
          INSERT INTO accounts (company_id, account_code, account_name, account_type, account_subtype, is_system)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (company_id, account_code) DO NOTHING
        `, [cid, a.code, a.name, a.type, a.subtype, a.system]);
      }
    }
    console.log('  ✓ Chart of accounts');

    // ── 12. Categories + Products ───────────────────────────────────────────
    const cats = await client.query(`
      INSERT INTO categories (category_id, company_id, category_name)
      VALUES
        (gen_random_uuid(), $1, 'Fresh Produce'),
        (gen_random_uuid(), $1, 'Dairy & Eggs'),
        (gen_random_uuid(), $1, 'Beverages'),
        (gen_random_uuid(), $1, 'Household'),
        (gen_random_uuid(), $2, 'Smartphones'),
        (gen_random_uuid(), $2, 'Accessories')
      ON CONFLICT DO NOTHING
      RETURNING category_id, category_name, company_id
    `, [freshmart.company_id, techzone.company_id]);

    const catMap = Object.fromEntries(cats.rows.map(r => [r.category_name, r.category_id]));

    const prods = await client.query(`
      INSERT INTO products
        (product_id, company_id, sku, product_name, category_id, base_price, cost_price, unit_of_measure)
      VALUES
        (gen_random_uuid(),$1,'FM-001','Tomatoes (1kg)',      $3,  120,    60, 'kg'),
        (gen_random_uuid(),$1,'FM-002','Milk 500ml',          $4,   75,    45, 'unit'),
        (gen_random_uuid(),$1,'FM-003','Coca-Cola 500ml',     $5,   65,    40, 'unit'),
        (gen_random_uuid(),$1,'FM-004','Bread (White)',       $4,  110,    70, 'unit'),
        (gen_random_uuid(),$1,'FM-005','Eggs (Tray of 30)',  $4,  450,   330, 'tray'),
        (gen_random_uuid(),$1,'FM-006','Sugar (2kg)',         $6,  230,   180, 'unit'),
        (gen_random_uuid(),$1,'FM-007','Cooking Oil 1L',     $6,  280,   210, 'unit'),
        (gen_random_uuid(),$1,'FM-008','Spinach (Bunch)',     $3,   30,    15, 'bunch'),
        (gen_random_uuid(),$2,'TZ-001','iPhone 15 (128GB)',   $7, 145000, 110000, 'unit'),
        (gen_random_uuid(),$2,'TZ-002','Samsung Galaxy A55', $7,  62000,  48000, 'unit'),
        (gen_random_uuid(),$2,'TZ-003','USB-C Cable',        $8,   1200,    600, 'unit'),
        (gen_random_uuid(),$2,'TZ-004','Screen Protector',   $8,    800,    300, 'unit')
      ON CONFLICT (company_id, sku) DO NOTHING
      RETURNING product_id, sku, company_id
    `, [
      freshmart.company_id, techzone.company_id,
      catMap['Fresh Produce'], catMap['Dairy & Eggs'], catMap['Beverages'], catMap['Household'],
      catMap['Smartphones'],   catMap['Accessories'],
    ]);

    const fmProds = prods.rows.filter(p => p.company_id === freshmart.company_id);
    const tzProds = prods.rows.filter(p => p.company_id === techzone.company_id);

    for (const prod of fmProds) {
      for (const branch of fmBranches) {
        await client.query(`
          INSERT INTO product_branch_inventory
            (inventory_id, product_id, branch_id, quantity_available, reorder_level)
          VALUES (gen_random_uuid(), $1, $2, $3, 5) ON CONFLICT DO NOTHING
        `, [prod.product_id, branch.branch_id, Math.floor(Math.random() * 100) + 10]);

        await client.query(`
          INSERT INTO product_branch_pricing (pricing_id, product_id, branch_id, selling_price)
          VALUES (gen_random_uuid(), $1, $2, (SELECT base_price FROM products WHERE product_id = $1))
          ON CONFLICT DO NOTHING
        `, [prod.product_id, branch.branch_id]);
      }
    }

    for (const prod of tzProds) {
      await client.query(`
        INSERT INTO product_branch_inventory
          (inventory_id, product_id, branch_id, quantity_available, reorder_level)
        VALUES (gen_random_uuid(), $1, $2, $3, 2) ON CONFLICT DO NOTHING
      `, [prod.product_id, tzCBD.branch_id, Math.floor(Math.random() * 20) + 2]);

      await client.query(`
        INSERT INTO product_branch_pricing (pricing_id, product_id, branch_id, selling_price)
        VALUES (gen_random_uuid(), $1, $2, (SELECT base_price FROM products WHERE product_id = $1))
        ON CONFLICT DO NOTHING
      `, [prod.product_id, tzCBD.branch_id]);
    }

    console.log('  ✓ Categories, products, inventory, pricing');

    // ── 12. Sample Transactions (30 days history) ───────────────────────────
    const cashierUserId = userMap['cashier@freshmart.com'];
    const pmResult = await client.query(
      `SELECT payment_method_id FROM payment_methods WHERE company_id = $1 AND method_name = 'Cash' LIMIT 1`,
      [freshmart.company_id]
    );
    const cashPmId  = pmResult.rows[0]?.payment_method_id;
    const fmProdIds = fmProds.map(p => p.product_id);

    for (let d = 30; d >= 0; d--) {
      const txDate  = new Date();
      txDate.setDate(txDate.getDate() - d);
      const numTxn  = d === 0 ? 8 : Math.floor(Math.random() * 15) + 5;

      for (let t = 0; t < numTxn; t++) {
        const txnNum  = `FM-${String(Date.now()).slice(-8)}-${t}`;
        const prodId  = fmProdIds[Math.floor(Math.random() * fmProdIds.length)];
        const qty     = Math.floor(Math.random() * 5) + 1;

        const priceRes = await client.query(
          `SELECT base_price FROM products WHERE product_id = $1`, [prodId]
        );
        const price     = parseFloat(priceRes.rows[0]?.base_price || 100);
        const lineTotal = price * qty;

        const txnRes = await client.query(`
          INSERT INTO sales_transactions
            (transaction_id, company_id, branch_id, transaction_number, transaction_date,
             cashier_user_id, subtotal, tax_amount, discount_amount, total_amount,
             amount_paid, change_total, status)
          VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, 0, 0, $6, $6, 0, 'completed')
          RETURNING transaction_id
        `, [freshmart.company_id, fmHQ.branch_id, txnNum, txDate, cashierUserId, lineTotal]);

        const txnId = txnRes.rows[0].transaction_id;

        await client.query(`
          INSERT INTO sales_transaction_items
            (item_id, transaction_id, product_id, quantity, unit_price, line_total)
          VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)
        `, [txnId, prodId, qty, price, lineTotal]);

        if (cashPmId) {
          await client.query(`
            INSERT INTO transaction_payments
              (payment_id, transaction_id, payment_method_id, amount_tendered, amount_applied, change_given, sequence_no)
            VALUES (gen_random_uuid(), $1, $2, $3, $3, 0, 1)
          `, [txnId, cashPmId, lineTotal]);
        }
      }
    }

    console.log('  ✓ Sample transactions (31 days)');

    await client.query('COMMIT');
    console.log('\n✅ Seed complete!\n');
    console.log('Login credentials (all use Password@123):');
    console.log('  super@statify.com        → super_admin');
    console.log('  admin@freshmart.com      → company_admin  (FreshMart / Premium plan)');
    console.log('  manager@freshmart.com    → branch_manager (FreshMart HQ)');
    console.log('  cashier@freshmart.com    → cashier        (FreshMart HQ)');
    console.log('  inventory@freshmart.com  → inventory_mgr  (FreshMart HQ)');
    console.log('  admin@techzone.com       → company_admin  (TechZone / Starter plan)');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('✗ Seed failed:', err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
