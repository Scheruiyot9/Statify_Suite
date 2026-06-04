const { query, transaction } = require('../../config/database');
const QueryBuilder = require('../../shared/qb');
const AppError = require('../../shared/AppError');
const mpesaSvc = require('../mpesa/mpesa.service');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const env    = require('../../config/env');

const generateTempPassword = () => crypto.randomBytes(9).toString('base64url');

// ── Shared helpers ─────────────────────────────────────────────────────────────

function paginate(page, limit) {
  const pg = Math.max(1, parseInt(page, 10) || 1);
  const lm = Math.min(200, Math.max(1, parseInt(limit, 10) || 25));
  return { pg, lm, offset: (pg - 1) * lm };
}

function shape(rows, pg, lm, key = 'rows') {
  const total = rows.length ? parseInt(rows[0].total_count, 10) : 0;
  return { [key]: rows.map(({ total_count: _, ...r }) => r), total, page: pg, limit: lm, pages: Math.ceil(total / lm) };
}

// ── Companies summary (with live counts) ──────────────────────────────────────

async function listAllCompanies({ search, status, page, limit } = {}) {
  const qb    = new QueryBuilder();
  const conds = [];

  if (search) {
    const p = qb.add(`%${search}%`);
    conds.push(`(c.company_name ILIKE $${p} OR c.domain ILIKE $${p})`);
  }
  if (status) conds.push(`c.subscription_status = $${qb.add(status)}`);

  const { pg, lm, offset } = paginate(page, limit);
  const limIdx = qb.add(lm);
  const offIdx = qb.add(offset);

  const { rows } = await query(`
    SELECT
      c.company_id, c.company_name, c.domain, c.subscription_status,
      c.is_active, c.timezone, c.currency, c.created_at,
      sp.plan_name, sp.max_users, sp.max_branches,
      COALESCE(sp.has_finance,    FALSE) AS has_finance,
      COALESCE(sp.has_api_access, FALSE) AS has_api_access,
      (SELECT COUNT(*) FROM branches b WHERE b.company_id = c.company_id AND b.is_active = TRUE) AS branch_count,
      (SELECT COUNT(*) FROM users   u WHERE u.company_id = c.company_id AND u.is_active = TRUE) AS user_count,
      COUNT(*) OVER() AS total_count
    FROM companies c
    LEFT JOIN subscription_plans sp ON sp.plan_id = c.subscription_plan_id
    ${conds.length ? 'WHERE ' + conds.join(' AND ') : ''}
    ORDER BY c.created_at DESC
    LIMIT $${limIdx} OFFSET $${offIdx}
  `, qb.params);
  return shape(rows, pg, lm, 'companies');
}

// ── Users ─────────────────────────────────────────────────────────────────────

async function listAllUsers({ search, companyId, role, page, limit } = {}) {
  const qb    = new QueryBuilder();
  const conds = ['u.is_active = TRUE'];

  if (companyId) conds.push(`u.company_id = $${qb.add(companyId)}`);
  if (search) {
    const p = qb.add(`%${search}%`);
    conds.push(`(u.first_name ILIKE $${p} OR u.last_name ILIKE $${p} OR u.email ILIKE $${p})`);
  }
  if (role) conds.push(`r.role_name = $${qb.add(role)}`);

  const { pg, lm, offset } = paginate(page, limit);
  const limIdx = qb.add(lm);
  const offIdx = qb.add(offset);

  const { rows } = await query(`
    SELECT
      u.user_id, u.first_name, u.last_name, u.email,
      u.is_active, u.last_login, u.created_at,
      c.company_name, c.company_id,
      r.role_id, r.role_name,
      b.branch_name,
      COUNT(*) OVER() AS total_count
    FROM users u
    LEFT JOIN companies c ON c.company_id = u.company_id
    LEFT JOIN user_roles ur ON ur.user_id = u.user_id
    LEFT JOIN roles r ON r.role_id = ur.role_id
    LEFT JOIN user_branch_assignments uba ON uba.user_id = u.user_id AND uba.is_default_branch = TRUE
    LEFT JOIN branches b ON b.branch_id = uba.branch_id
    WHERE ${conds.join(' AND ')}
    ORDER BY c.company_name NULLS LAST, u.first_name
    LIMIT $${limIdx} OFFSET $${offIdx}
  `, qb.params);
  return shape(rows, pg, lm, 'users');
}

// ── Branches ──────────────────────────────────────────────────────────────────

async function listAllBranches({ search, companyId, page, limit } = {}) {
  const qb    = new QueryBuilder();
  const conds = ['b.deleted_at IS NULL'];

  if (companyId) conds.push(`b.company_id = $${qb.add(companyId)}`);
  if (search) {
    const p = qb.add(`%${search}%`);
    conds.push(`(b.branch_name ILIKE $${p} OR b.branch_code ILIKE $${p})`);
  }

  const { pg, lm, offset } = paginate(page, limit);
  const limIdx = qb.add(lm);
  const offIdx = qb.add(offset);

  const { rows } = await query(`
    SELECT
      b.branch_id, b.branch_name, b.branch_code, b.phone, b.address,
      b.is_headquarters, b.is_active, b.created_at,
      c.company_name, c.company_id,
      COUNT(*) OVER() AS total_count
    FROM branches b
    JOIN companies c ON c.company_id = b.company_id
    WHERE ${conds.join(' AND ')}
    ORDER BY c.company_name, b.branch_name
    LIMIT $${limIdx} OFFSET $${offIdx}
  `, qb.params);
  return shape(rows, pg, lm, 'branches');
}

// ── Terminals ─────────────────────────────────────────────────────────────────

async function listAllTerminals({ search, companyId, page, limit } = {}) {
  const qb    = new QueryBuilder();
  const conds = [];

  if (companyId) conds.push(`t.company_id = $${qb.add(companyId)}`);
  if (search) {
    const p = qb.add(`%${search}%`);
    conds.push(`(t.terminal_name ILIKE $${p} OR t.terminal_code ILIKE $${p})`);
  }

  const { pg, lm, offset } = paginate(page, limit);
  const limIdx = qb.add(lm);
  const offIdx = qb.add(offset);

  const { rows } = await query(`
    SELECT
      t.terminal_id, t.terminal_name, t.terminal_code, t.description, t.is_active, t.created_at,
      b.branch_name, b.branch_id,
      c.company_name, c.company_id,
      (SELECT COUNT(*) FROM pos_sessions ps WHERE ps.terminal_id = t.terminal_id AND ps.status = 'open') AS open_sessions,
      COUNT(*) OVER() AS total_count
    FROM pos_terminals t
    JOIN branches b ON b.branch_id = t.branch_id
    JOIN companies c ON c.company_id = t.company_id
    ${conds.length ? 'WHERE ' + conds.join(' AND ') : ''}
    ORDER BY c.company_name, b.branch_name, t.terminal_name
    LIMIT $${limIdx} OFFSET $${offIdx}
  `, qb.params);
  return shape(rows, pg, lm, 'terminals');
}

// ── POS Sessions ──────────────────────────────────────────────────────────────

async function listAllSessions({ companyId, status, page, limit } = {}) {
  const qb    = new QueryBuilder();
  const conds = [];

  if (companyId) conds.push(`s.company_id = $${qb.add(companyId)}`);
  if (status)    conds.push(`s.status = $${qb.add(status)}`);

  const { pg, lm, offset } = paginate(page, limit);
  const limIdx = qb.add(lm);
  const offIdx = qb.add(offset);

  const { rows } = await query(`
    SELECT
      s.session_id, s.status, s.opening_cash_amount,
      s.closing_cash_counted, s.expected_cash_amount, s.cash_variance,
      s.session_start, s.session_end,
      t.terminal_name, t.terminal_code,
      b.branch_name,
      c.company_name, c.company_id,
      cashier.first_name  || ' ' || cashier.last_name  AS cashier_name,
      opener.first_name   || ' ' || opener.last_name   AS opened_by_name,
      COUNT(*) OVER() AS total_count
    FROM pos_sessions s
    JOIN pos_terminals t ON t.terminal_id = s.terminal_id
    JOIN branches b      ON b.branch_id   = s.branch_id
    JOIN companies c     ON c.company_id  = s.company_id
    JOIN users cashier   ON cashier.user_id = s.cashier_user_id
    LEFT JOIN users opener ON opener.user_id = s.opened_by_user_id
    ${conds.length ? 'WHERE ' + conds.join(' AND ') : ''}
    ORDER BY s.session_start DESC
    LIMIT $${limIdx} OFFSET $${offIdx}
  `, qb.params);
  return shape(rows, pg, lm, 'sessions');
}

// ── Sales Transactions ────────────────────────────────────────────────────────

async function listAllSales({ companyId, status, dateFrom, dateTo, page, limit } = {}) {
  const qb    = new QueryBuilder();
  const conds = [];

  if (companyId) conds.push(`st.company_id = $${qb.add(companyId)}`);
  if (status)    conds.push(`st.status = $${qb.add(status)}`);
  if (dateFrom)  conds.push(`st.transaction_date >= $${qb.add(dateFrom)}`);
  if (dateTo)    conds.push(`st.transaction_date <= $${qb.add(dateTo)}`);

  const { pg, lm, offset } = paginate(page, limit);
  const limIdx = qb.add(lm);
  const offIdx = qb.add(offset);

  const { rows } = await query(`
    SELECT
      st.transaction_id, st.transaction_number,
      st.total_amount::numeric, st.status, st.transaction_date,
      st.payment_status,
      b.branch_name, c.company_name, c.company_id,
      cashier.first_name || ' ' || cashier.last_name AS cashier_name,
      COUNT(*) OVER() AS total_count
    FROM sales_transactions st
    JOIN branches b    ON b.branch_id  = st.branch_id
    JOIN companies c   ON c.company_id = st.company_id
    JOIN users cashier ON cashier.user_id = st.cashier_user_id
    ${conds.length ? 'WHERE ' + conds.join(' AND ') : ''}
    ORDER BY st.transaction_date DESC
    LIMIT $${limIdx} OFFSET $${offIdx}
  `, qb.params);
  return shape(rows, pg, lm, 'sales');
}

// ── Products ──────────────────────────────────────────────────────────────────

async function listAllProducts({ search, companyId, page, limit } = {}) {
  const qb    = new QueryBuilder();
  const conds = ['p.is_active = TRUE'];

  if (companyId) conds.push(`p.company_id = $${qb.add(companyId)}`);
  if (search) {
    const p = qb.add(`%${search}%`);
    conds.push(`(p.product_name ILIKE $${p} OR p.sku ILIKE $${p})`);
  }

  const { pg, lm, offset } = paginate(page, limit);
  const limIdx = qb.add(lm);
  const offIdx = qb.add(offset);

  const { rows } = await query(`
    SELECT
      p.product_id, p.product_name, p.sku, p.barcode,
      p.base_price::numeric, p.cost_price::numeric,
      p.unit_of_measure, p.is_active,
      c.company_name, c.company_id,
      cat.category_name,
      COUNT(*) OVER() AS total_count
    FROM products p
    JOIN companies c ON c.company_id = p.company_id
    LEFT JOIN categories cat ON cat.category_id = p.category_id
    WHERE ${conds.join(' AND ')}
    ORDER BY c.company_name, p.product_name
    LIMIT $${limIdx} OFFSET $${offIdx}
  `, qb.params);
  return shape(rows, pg, lm, 'products');
}

// ── Inventory ─────────────────────────────────────────────────────────────────

async function listAllInventory({ companyId, lowStockOnly, page, limit } = {}) {
  const qb    = new QueryBuilder();
  const conds = ['p.is_active = TRUE', 'b.is_active = TRUE'];

  if (companyId)   conds.push(`b.company_id = $${qb.add(companyId)}`);
  if (lowStockOnly) conds.push('(pbi.quantity_available <= pbi.reorder_level OR pbi.quantity_available <= 0)');

  const { pg, lm, offset } = paginate(page, limit);
  const limIdx = qb.add(lm);
  const offIdx = qb.add(offset);

  const { rows } = await query(`
    SELECT
      pbi.inventory_id,
      p.product_name, p.sku,
      pbi.quantity_available::numeric, pbi.reorder_level::numeric,
      pbi.quantity_reserved::numeric, pbi.quantity_on_order::numeric,
      b.branch_name, c.company_name, c.company_id,
      COUNT(*) OVER() AS total_count
    FROM product_branch_inventory pbi
    JOIN products  p ON p.product_id  = pbi.product_id
    JOIN branches  b ON b.branch_id   = pbi.branch_id
    JOIN companies c ON c.company_id  = b.company_id
    WHERE ${conds.join(' AND ')}
    ORDER BY c.company_name, b.branch_name, p.product_name
    LIMIT $${limIdx} OFFSET $${offIdx}
  `, qb.params);
  return shape(rows, pg, lm, 'inventory');
}

// ── Customers ─────────────────────────────────────────────────────────────────

async function listAllCustomers({ search, companyId, page, limit } = {}) {
  const qb    = new QueryBuilder();
  const conds = [];

  if (companyId) conds.push(`cu.company_id = $${qb.add(companyId)}`);
  if (search) {
    const p = qb.add(`%${search}%`);
    conds.push(`(cu.customer_name ILIKE $${p} OR cu.phone ILIKE $${p} OR cu.email ILIKE $${p})`);
  }

  const { pg, lm, offset } = paginate(page, limit);
  const limIdx = qb.add(lm);
  const offIdx = qb.add(offset);

  const { rows } = await query(`
    SELECT
      cu.customer_id, cu.customer_name, cu.customer_code,
      cu.phone, cu.email, cu.loyalty_points_balance, cu.created_at,
      c.company_name, c.company_id,
      cg.group_name,
      COUNT(*) OVER() AS total_count
    FROM customers cu
    JOIN companies c ON c.company_id = cu.company_id
    LEFT JOIN customer_groups cg ON cg.group_id = cu.customer_group_id
    ${conds.length ? 'WHERE ' + conds.join(' AND ') : ''}
    ORDER BY c.company_name, cu.customer_name
    LIMIT $${limIdx} OFFSET $${offIdx}
  `, qb.params);
  return shape(rows, pg, lm, 'customers');
}

// ── Payment Methods ───────────────────────────────────────────────────────────

async function listAllPaymentMethods({ companyId, page, limit } = {}) {
  const qb    = new QueryBuilder();
  const conds = [];

  if (companyId) conds.push(`pm.company_id = $${qb.add(companyId)}`);

  const { pg, lm, offset } = paginate(page, limit);
  const limIdx = qb.add(lm);
  const offIdx = qb.add(offset);

  const { rows } = await query(`
    SELECT
      pm.payment_method_id, pm.method_name, pm.is_active, pm.requires_reference,
      c.company_name, c.company_id,
      COUNT(*) OVER() AS total_count
    FROM payment_methods pm
    JOIN companies c ON c.company_id = pm.company_id
    ${conds.length ? 'WHERE ' + conds.join(' AND ') : ''}
    ORDER BY c.company_name, pm.method_name
    LIMIT $${limIdx} OFFSET $${offIdx}
  `, qb.params);
  return shape(rows, pg, lm, 'paymentMethods');
}

// ── Platform stats ────────────────────────────────────────────────────────────

async function platformStats() {
  const { rows } = await query(`
    SELECT
      (SELECT COUNT(*) FROM companies)                    AS total_companies,
      (SELECT COUNT(*) FROM companies WHERE subscription_status = 'active')    AS active_companies,
      (SELECT COUNT(*) FROM companies WHERE subscription_status = 'trial')     AS trial_companies,
      (SELECT COUNT(*) FROM companies WHERE subscription_status = 'suspended') AS suspended_companies,
      (SELECT COUNT(*) FROM users    WHERE is_active = TRUE AND company_id IS NOT NULL) AS total_users,
      (SELECT COUNT(*) FROM branches WHERE is_active = TRUE) AS total_branches,
      (SELECT COUNT(*) FROM products WHERE is_active = TRUE) AS total_products,
      (SELECT COUNT(*) FROM customers)                       AS total_customers,
      (SELECT COUNT(*) FROM pos_sessions WHERE status = 'open') AS open_sessions,
      (SELECT COALESCE(SUM(total_amount), 0)::numeric
       FROM sales_transactions
       WHERE transaction_date >= CURRENT_DATE AND status = 'completed') AS today_sales
  `);
  const r = rows[0];
  return {
    total_companies:     parseInt(r.total_companies),
    active_companies:    parseInt(r.active_companies),
    trial_companies:     parseInt(r.trial_companies),
    suspended_companies: parseInt(r.suspended_companies),
    total_users:         parseInt(r.total_users),
    total_branches:      parseInt(r.total_branches),
    total_products:      parseInt(r.total_products),
    total_customers:     parseInt(r.total_customers),
    open_sessions:       parseInt(r.open_sessions),
    today_sales:         parseFloat(r.today_sales),
  };
}

// ── Subscription Plans CRUD ───────────────────────────────────────────────────

async function listPlans() {
  const { rows } = await query(`
    SELECT plan_id, plan_name, price::numeric, annual_price::numeric,
           billing_cycle, max_users, max_branches, trial_days,
           has_finance, has_api_access, sort_order,
           features_json, is_active, created_at
    FROM subscription_plans
    ORDER BY sort_order, plan_name
  `);
  return rows;
}

async function createPlan(data) {
  const {
    plan_name, price, annual_price, billing_cycle = 'monthly',
    max_users = 5, max_branches = 1, trial_days = 14,
    has_finance = false, has_api_access = false, sort_order = 0,
    features_json = {},
  } = data;

  if (!plan_name) throw AppError.badRequest('plan_name is required');
  if (price == null) throw AppError.badRequest('price is required');

  const { rows } = await query(`
    INSERT INTO subscription_plans
      (plan_name, price, annual_price, billing_cycle, max_users, max_branches,
       trial_days, has_finance, has_api_access, sort_order, features_json)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    RETURNING plan_id, plan_name, price::numeric, has_finance, has_api_access
  `, [
    plan_name, price, annual_price ?? null, billing_cycle,
    max_users, max_branches, trial_days,
    has_finance, has_api_access, sort_order,
    JSON.stringify(features_json),
  ]);
  return rows[0];
}

async function updatePlan(planId, data) {
  const allowed = [
    'plan_name','price','annual_price','billing_cycle','max_users','max_branches',
    'trial_days','has_finance','has_api_access','sort_order','features_json','is_active',
  ];
  const sets  = [];
  const params = [planId];
  for (const key of allowed) {
    if (data[key] !== undefined) {
      params.push(key === 'features_json' ? JSON.stringify(data[key]) : data[key]);
      sets.push(`${key} = $${params.length}`);
    }
  }
  if (!sets.length) throw AppError.badRequest('No fields to update');

  const { rows } = await query(`
    UPDATE subscription_plans SET ${sets.join(', ')}
    WHERE plan_id = $1
    RETURNING plan_id, plan_name, price::numeric, has_finance, has_api_access, is_active
  `, params);
  if (!rows.length) throw AppError.notFound('Subscription plan');
  return rows[0];
}

async function deletePlan(planId) {
  const { rows: inUse } = await query(
    `SELECT COUNT(*) AS cnt FROM companies WHERE subscription_plan_id = $1`, [planId]
  );
  if (parseInt(inUse[0].cnt) > 0)
    throw AppError.conflict('Cannot delete a plan assigned to companies. Reassign those companies to another plan first.');

  const { rows } = await query(
    `DELETE FROM subscription_plans WHERE plan_id = $1 RETURNING plan_id`,
    [planId]
  );
  if (!rows.length) throw AppError.notFound('Subscription plan');
  return { deleted: true, plan_id: planId };
}

// ── Company Management ────────────────────────────────────────────────────────

async function changeCompanyPlan(companyId, planId) {
  const { rows: plan } = await query(
    `SELECT plan_id, plan_name FROM subscription_plans WHERE plan_id = $1 AND is_active = TRUE`, [planId]
  );
  if (!plan.length) throw AppError.notFound('Subscription plan');

  const { rows } = await query(`
    UPDATE companies
    SET subscription_plan_id = $2, updated_at = now()
    WHERE company_id = $1
    RETURNING company_id, company_name
  `, [companyId, planId]);
  if (!rows.length) throw AppError.notFound('Company');
  return { company_id: companyId, plan_name: plan[0].plan_name };
}

async function changeCompanyStatus(companyId, status) {
  const valid = ['trial','active','suspended','cancelled'];
  if (!valid.includes(status)) throw AppError.badRequest(`status must be one of: ${valid.join(', ')}`);

  const { rows } = await query(`
    UPDATE companies
    SET subscription_status = $2, updated_at = now()
    WHERE company_id = $1
    RETURNING company_id, company_name, subscription_status
  `, [companyId, status]);
  if (!rows.length) throw AppError.notFound('Company');
  return rows[0];
}

// ── Finance: Suppliers ────────────────────────────────────────────────────────

async function listAllSuppliers({ search, companyId, page, limit } = {}) {
  const qb    = new QueryBuilder();
  const conds = [];

  if (companyId) conds.push(`s.company_id = $${qb.add(companyId)}`);
  if (search) {
    const p = qb.add(`%${search}%`);
    conds.push(`(s.supplier_name ILIKE $${p} OR s.email ILIKE $${p} OR s.phone ILIKE $${p})`);
  }

  const { pg, lm, offset } = paginate(page, limit);
  const limIdx = qb.add(lm);
  const offIdx = qb.add(offset);

  const { rows } = await query(`
    SELECT
      s.supplier_id, s.supplier_name, s.contact_person, s.email, s.phone,
      s.payment_terms, s.credit_limit::numeric, s.currency, s.is_active, s.created_at,
      c.company_name, c.company_id,
      COUNT(*) OVER() AS total_count
    FROM suppliers s
    JOIN companies c ON c.company_id = s.company_id
    ${conds.length ? 'WHERE ' + conds.join(' AND ') : ''}
    ORDER BY c.company_name, s.supplier_name
    LIMIT $${limIdx} OFFSET $${offIdx}
  `, qb.params);
  return shape(rows, pg, lm, 'suppliers');
}

// ── Finance: Purchases ────────────────────────────────────────────────────────

async function listAllPurchases({ search, companyId, status, page, limit } = {}) {
  const qb    = new QueryBuilder();
  const conds = [];

  if (companyId) conds.push(`po.company_id = $${qb.add(companyId)}`);
  if (status)    conds.push(`po.status = $${qb.add(status)}`);
  if (search) {
    const p = qb.add(`%${search}%`);
    conds.push(`(po.po_number ILIKE $${p} OR s.supplier_name ILIKE $${p})`);
  }

  const { pg, lm, offset } = paginate(page, limit);
  const limIdx = qb.add(lm);
  const offIdx = qb.add(offset);

  const { rows } = await query(`
    SELECT
      po.po_id, po.po_number, po.status, po.order_date, po.expected_date,
      po.total_amount::numeric, po.created_at,
      s.supplier_name,
      b.branch_name,
      c.company_name, c.company_id,
      COUNT(*) OVER() AS total_count
    FROM purchase_orders po
    JOIN suppliers s ON s.supplier_id = po.supplier_id
    JOIN branches  b ON b.branch_id   = po.branch_id
    JOIN companies c ON c.company_id  = po.company_id
    ${conds.length ? 'WHERE ' + conds.join(' AND ') : ''}
    ORDER BY po.created_at DESC
    LIMIT $${limIdx} OFFSET $${offIdx}
  `, qb.params);
  return shape(rows, pg, lm, 'purchases');
}

// ── Finance: AP Payments ──────────────────────────────────────────────────────

async function listAllApPayments({ search, companyId, page, limit } = {}) {
  const qb    = new QueryBuilder();
  const conds = ['sp.is_void = FALSE'];

  if (companyId) conds.push(`sp.company_id = $${qb.add(companyId)}`);
  if (search) {
    const p = qb.add(`%${search}%`);
    conds.push(`(s.supplier_name ILIKE $${p} OR sp.reference_number ILIKE $${p})`);
  }

  const { pg, lm, offset } = paginate(page, limit);
  const limIdx = qb.add(lm);
  const offIdx = qb.add(offset);

  const { rows } = await query(`
    SELECT
      sp.payment_id, sp.payment_date, sp.amount::numeric,
      sp.payment_method, sp.reference_number, sp.is_void, sp.created_at,
      s.supplier_name,
      b.branch_name,
      ba.account_name AS bank_account_name,
      po.po_number,
      c.company_name, c.company_id,
      COUNT(*) OVER() AS total_count
    FROM supplier_payments sp
    JOIN suppliers    s  ON s.supplier_id       = sp.supplier_id
    JOIN branches     b  ON b.branch_id         = sp.branch_id
    JOIN companies    c  ON c.company_id        = sp.company_id
    LEFT JOIN bank_accounts  ba ON ba.bank_account_id = sp.bank_account_id
    LEFT JOIN purchase_orders po ON po.po_id    = sp.po_id
    WHERE ${conds.join(' AND ')}
    ORDER BY sp.payment_date DESC
    LIMIT $${limIdx} OFFSET $${offIdx}
  `, qb.params);
  return shape(rows, pg, lm, 'payments');
}

// ── Finance: Chart of Accounts ────────────────────────────────────────────────

async function listAllAccounts({ search, companyId, accountType, page, limit } = {}) {
  const qb    = new QueryBuilder();
  const conds = ['a.is_active = TRUE'];

  if (companyId)   conds.push(`a.company_id = $${qb.add(companyId)}`);
  if (accountType) conds.push(`a.account_type = $${qb.add(accountType)}`);
  if (search) {
    const p = qb.add(`%${search}%`);
    conds.push(`(a.account_name ILIKE $${p} OR a.account_code ILIKE $${p})`);
  }

  const { pg, lm, offset } = paginate(page, limit);
  const limIdx = qb.add(lm);
  const offIdx = qb.add(offset);

  const { rows } = await query(`
    SELECT
      a.account_id, a.account_code, a.account_name, a.account_type,
      a.account_subtype, a.is_system, a.is_active, a.created_at,
      c.company_name, c.company_id,
      COUNT(*) OVER() AS total_count
    FROM accounts a
    JOIN companies c ON c.company_id = a.company_id
    WHERE ${conds.join(' AND ')}
    ORDER BY c.company_name, a.account_type, a.account_code
    LIMIT $${limIdx} OFFSET $${offIdx}
  `, qb.params);
  return shape(rows, pg, lm, 'accounts');
}

// ── Finance: Bank Accounts ────────────────────────────────────────────────────

async function listAllBankAccounts({ search, companyId, page, limit } = {}) {
  const qb    = new QueryBuilder();
  const conds = [];

  if (companyId) conds.push(`ba.company_id = $${qb.add(companyId)}`);
  if (search) {
    const p = qb.add(`%${search}%`);
    conds.push(`(ba.account_name ILIKE $${p} OR ba.bank_name ILIKE $${p} OR ba.account_number ILIKE $${p})`);
  }

  const { pg, lm, offset } = paginate(page, limit);
  const limIdx = qb.add(lm);
  const offIdx = qb.add(offset);

  const { rows } = await query(`
    SELECT
      ba.bank_account_id, ba.account_name, ba.bank_name, ba.account_number,
      ba.currency, ba.current_balance::numeric, ba.is_default, ba.is_active, ba.created_at,
      c.company_name, c.company_id,
      COUNT(*) OVER() AS total_count
    FROM bank_accounts ba
    JOIN companies c ON c.company_id = ba.company_id
    ${conds.length ? 'WHERE ' + conds.join(' AND ') : ''}
    ORDER BY c.company_name, ba.is_default DESC, ba.account_name
    LIMIT $${limIdx} OFFSET $${offIdx}
  `, qb.params);
  return shape(rows, pg, lm, 'bankAccounts');
}

// ── Finance: Journals ─────────────────────────────────────────────────────────

async function listAllJournals({ search, companyId, status, page, limit } = {}) {
  const qb    = new QueryBuilder();
  const conds = [];

  if (companyId) conds.push(`j.company_id = $${qb.add(companyId)}`);
  if (status)    conds.push(`j.status = $${qb.add(status)}`);
  if (search) {
    const p = qb.add(`%${search}%`);
    conds.push(`(j.journal_number ILIKE $${p} OR j.description ILIKE $${p})`);
  }

  const { pg, lm, offset } = paginate(page, limit);
  const limIdx = qb.add(lm);
  const offIdx = qb.add(offset);

  const { rows } = await query(`
    SELECT
      j.journal_id, j.journal_number, j.entry_date, j.description,
      j.reference, j.status, j.created_at,
      u.first_name || ' ' || u.last_name AS created_by,
      COALESCE(SUM(jl.debit), 0)::numeric AS total_debit,
      c.company_name, c.company_id,
      COUNT(*) OVER() AS total_count
    FROM journals j
    JOIN companies c ON c.company_id = j.company_id
    LEFT JOIN users u ON u.user_id = j.created_by_user_id
    LEFT JOIN journal_lines jl ON jl.journal_id = j.journal_id
    ${conds.length ? 'WHERE ' + conds.join(' AND ') : ''}
    GROUP BY j.journal_id, u.first_name, u.last_name, c.company_name, c.company_id
    ORDER BY j.entry_date DESC, j.journal_number DESC
    LIMIT $${limIdx} OFFSET $${offIdx}
  `, qb.params);
  return shape(rows, pg, lm, 'journals');
}

async function listAllMpesaConfigs({ companyId, page, limit } = {}) {
  const qb    = new QueryBuilder();
  const conds = ['1=1'];

  if (companyId) conds.push(`mc.company_id = $${qb.add(companyId)}`);

  const { pg, lm, offset } = paginate(page, limit);
  const limIdx = qb.add(lm);
  const offIdx = qb.add(offset);

  const { rows } = await query(`
    SELECT
      mc.config_id, mc.company_id, mc.branch_id,
      mc.shortcode, mc.shortcode_type, mc.environment,
      mc.callback_url, mc.is_active, mc.created_at, mc.updated_at,
      c.company_name, b.branch_name,
      left(mc.consumer_key, 6) || '***' AS consumer_key_hint,
      left(mc.passkey,       6) || '***' AS passkey_hint,
      COUNT(*) OVER() AS total_count
    FROM mpesa_config mc
    JOIN companies c ON c.company_id = mc.company_id
    LEFT JOIN branches b ON b.branch_id = mc.branch_id
    WHERE ${conds.join(' AND ')}
    ORDER BY c.company_name, b.branch_name NULLS FIRST
    LIMIT $${limIdx} OFFSET $${offIdx}
  `, qb.params);
  return shape(rows, pg, lm, 'configs');
}

async function saveMpesaConfig(companyId, data) {
  const { branchId, consumerKey, consumerSecret, shortcode, shortcodeType, passkey, environment, callbackUrl } = data;
  if (!companyId) throw AppError.badRequest('companyId is required');
  return mpesaSvc.saveConfig(companyId, branchId || null, {
    consumerKey, consumerSecret, shortcode, shortcodeType, passkey, environment, callbackUrl,
  });
}

async function toggleMpesaConfig(configId) {
  const { rows } = await query(
    `UPDATE mpesa_config SET is_active = NOT is_active, updated_at = now()
     WHERE config_id = $1
     RETURNING config_id, is_active`,
    [configId]
  );
  if (!rows.length) throw AppError.notFound('M-Pesa config');
  return rows[0];
}

async function listAllMpesaTransactions({ search, companyId, mode, page, limit } = {}) {
  const qb    = new QueryBuilder();
  const conds = ['1=1'];

  if (search) {
    const p = qb.add(`%${search}%`);
    conds.push(`(mt.mpesa_receipt_number ILIKE $${p} OR mt.phone_number ILIKE $${p} OR mt.account_reference ILIKE $${p})`);
  }
  if (companyId) conds.push(`mt.company_id = $${qb.add(companyId)}`);
  if (mode)      conds.push(`mt.payment_mode = $${qb.add(mode)}`);

  const { pg, lm, offset } = paginate(page, limit);
  const limIdx = qb.add(lm);
  const offIdx = qb.add(offset);

  const { rows } = await query(`
    SELECT
      mt.mpesa_txn_id, mt.mpesa_receipt_number, mt.phone_number,
      mt.amount::numeric, mt.payment_mode, mt.account_reference,
      mt.status, mt.completed_at,
      b.branch_name, c.company_name,
      COUNT(*) OVER() AS total_count
    FROM mpesa_transactions mt
    JOIN companies c ON c.company_id = mt.company_id
    LEFT JOIN branches b ON b.branch_id = mt.branch_id
    WHERE ${conds.join(' AND ')}
    ORDER BY mt.completed_at DESC NULLS LAST
    LIMIT $${limIdx} OFFSET $${offIdx}
  `, qb.params);
  return shape(rows, pg, lm, 'transactions');
}

// ── Subscriptions ─────────────────────────────────────────────────────────────

async function listSubscriptions({ companyId, page, limit } = {}) {
  const { pg, lm, offset } = paginate(page, limit);
  const qb = new QueryBuilder();
  const conds = ['1=1'];
  if (companyId) conds.push(`cs.company_id = $${qb.add(companyId)}`);
  const limIdx = qb.add(lm);
  const offIdx = qb.add(offset);

  const { rows } = await query(`
    SELECT cs.subscription_id, cs.company_id, cs.period,
           cs.start_date, cs.end_date, cs.amount_paid,
           cs.notes, cs.created_at,
           c.company_name,
           sp.plan_id, sp.plan_name,
           u.first_name || ' ' || u.last_name AS recorded_by,
           COUNT(*) OVER() AS total_count
      FROM company_subscriptions cs
      JOIN companies          c  ON c.company_id  = cs.company_id
      JOIN subscription_plans sp ON sp.plan_id    = cs.plan_id
      LEFT JOIN users         u  ON u.user_id     = cs.recorded_by
     WHERE ${conds.join(' AND ')}
     ORDER BY cs.created_at DESC
     LIMIT $${limIdx} OFFSET $${offIdx}
  `, qb.params);

  return shape(rows, pg, lm, 'subscriptions');
}

async function recordSubscription(companyId, { planId, period, startDate, endDate, amountPaid, notes }, userId) {
  if (!companyId) throw AppError.badRequest('companyId is required');
  if (!planId)    throw AppError.badRequest('planId is required');
  if (!startDate) throw AppError.badRequest('startDate is required');
  if (!endDate)   throw AppError.badRequest('endDate is required');
  if (endDate <= startDate) throw AppError.badRequest('endDate must be after startDate');

  const validPeriods = ['monthly','quarterly','semi_annual','annual','biennial','custom'];
  const resolvedPeriod = validPeriods.includes(period) ? period : 'custom';

  const { rows: [plan] } = await query(
    `SELECT plan_id FROM subscription_plans WHERE plan_id = $1 AND is_active = TRUE`, [planId]
  );
  if (!plan) throw AppError.notFound('Subscription plan');

  const { rows: [sub] } = await query(`
    INSERT INTO company_subscriptions
      (company_id, plan_id, period, start_date, end_date, amount_paid, notes, recorded_by)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING subscription_id, company_id, plan_id, period, start_date, end_date, amount_paid, notes, created_at
  `, [companyId, planId, resolvedPeriod, startDate, endDate,
      amountPaid != null ? parseFloat(amountPaid) : null,
      notes || null, userId || null]);

  // Update the live company row atomically
  await query(`
    UPDATE companies
       SET subscription_plan_id   = $2,
           subscription_start_date = $3,
           subscription_end_date   = $4,
           subscription_status     = 'active',
           updated_at              = now()
     WHERE company_id = $1
  `, [companyId, planId, startDate, endDate]);

  return sub;
}

async function listSubscriptionRequests({ status, companyId, page, limit } = {}) {
  const { pg, lm, offset } = paginate(page, limit);
  const qb = new QueryBuilder();
  const conds = ['1=1'];
  if (status)    conds.push(`sr.status = $${qb.add(status)}`);
  if (companyId) conds.push(`sr.company_id = $${qb.add(companyId)}`);
  const limIdx = qb.add(lm);
  const offIdx = qb.add(offset);

  const { rows } = await query(`
    SELECT sr.request_id, sr.period, sr.message, sr.status,
           sr.rejection_reason, sr.created_at, sr.actioned_at,
           c.company_id, c.company_name,
           sp.plan_id, sp.plan_name, sp.price::numeric AS plan_price,
           sp.annual_price::numeric,
           u.first_name || ' ' || u.last_name AS actioned_by_name,
           COUNT(*) OVER() AS total_count
      FROM subscription_requests sr
      JOIN companies          c  ON c.company_id = sr.company_id
      JOIN subscription_plans sp ON sp.plan_id   = sr.plan_id
      LEFT JOIN users         u  ON u.user_id    = sr.actioned_by
     WHERE ${conds.join(' AND ')}
     ORDER BY CASE WHEN sr.status = 'pending' THEN 0 ELSE 1 END, sr.created_at DESC
     LIMIT $${limIdx} OFFSET $${offIdx}
  `, qb.params);

  return shape(rows, pg, lm, 'requests');
}

async function actionSubscriptionRequest(requestId, { action, rejectionReason, startDate, endDate, amountPaid }, adminUserId) {
  if (!['approved', 'rejected'].includes(action))
    throw AppError.badRequest('action must be "approved" or "rejected"');

  const { rows: [req] } = await query(
    `SELECT * FROM subscription_requests WHERE request_id = $1`, [requestId]
  );
  if (!req) throw AppError.notFound('Subscription request');
  if (req.status !== 'pending') throw AppError.badRequest('This request has already been actioned');

  if (action === 'rejected') {
    await query(`
      UPDATE subscription_requests
         SET status = 'rejected', actioned_by = $2, actioned_at = now(), rejection_reason = $3
       WHERE request_id = $1
    `, [requestId, adminUserId, rejectionReason || null]);
    return { status: 'rejected' };
  }

  // approved — validate then record the subscription
  if (!startDate) throw AppError.badRequest('startDate is required for approval');
  if (!endDate)   throw AppError.badRequest('endDate is required for approval');

  const sub = await recordSubscription(
    req.company_id,
    {
      planId:     req.plan_id,
      period:     req.period,
      startDate,
      endDate,
      amountPaid: amountPaid != null ? parseFloat(amountPaid) : null,
      notes:      `Approved from subscription request ${requestId}`,
    },
    adminUserId
  );

  await query(`
    UPDATE subscription_requests
       SET status = 'approved', actioned_by = $2, actioned_at = now()
     WHERE request_id = $1
  `, [requestId, adminUserId]);

  return { status: 'approved', subscription: sub };
}

async function autoSuspendExpired() {
  const { rows } = await query(`
    UPDATE companies
       SET subscription_status = 'suspended',
           updated_at          = now()
     WHERE subscription_end_date < CURRENT_DATE
       AND subscription_status NOT IN ('suspended', 'cancelled')
     RETURNING company_id, company_name, subscription_end_date
  `);

  if (rows.length) {
    const ids = rows.map((r) => r.company_id);
    // Revoke all active sessions for suspended companies so existing tokens stop working
    await query(
      `UPDATE user_sessions
          SET revoked_at = now(), revoked_reason = 'subscription_suspended'
        WHERE revoked_at IS NULL
          AND user_id IN (SELECT user_id FROM users WHERE company_id = ANY($1::uuid[]))`,
      [ids]
    );
  }

  return rows;
}

async function updateAnyUser(userId, data) {
  const { first_name, last_name, phone, is_active, role_id, branch_id } = data;
  return transaction(async (client) => {
    const { rows } = await client.query(`
      UPDATE users
      SET first_name = COALESCE($2, first_name),
          last_name  = COALESCE($3, last_name),
          phone      = COALESCE($4, phone),
          is_active  = COALESCE($5, is_active),
          updated_at = now()
      WHERE user_id = $1 AND deleted_at IS NULL
      RETURNING user_id, first_name, last_name, email, phone, is_active
    `, [userId, first_name ?? null, last_name ?? null, phone ?? null, is_active ?? null]);

    if (!rows.length) throw AppError.notFound('User');

    if (role_id != null && role_id !== '') {
      await client.query(`DELETE FROM user_roles WHERE user_id = $1`, [userId]);
      await client.query(`
        INSERT INTO user_roles (user_role_id, user_id, role_id)
        VALUES (gen_random_uuid(), $1, $2) ON CONFLICT DO NOTHING
      `, [userId, role_id]);
    }

    if (Object.prototype.hasOwnProperty.call(data, 'branch_id')) {
      await client.query(`DELETE FROM user_branch_assignments WHERE user_id = $1 AND is_default_branch = TRUE`, [userId]);
      if (branch_id) {
        await client.query(`
          INSERT INTO user_branch_assignments (assignment_id, user_id, branch_id, is_default_branch)
          VALUES (gen_random_uuid(), $1, $2, TRUE) ON CONFLICT DO NOTHING
        `, [userId, branch_id]);
      }
    }

    return rows[0];
  });
}

async function platformStockValuation({ companyId } = {}) {
  const conds = ['p.is_active = TRUE', 'pbi.quantity_available > 0'];
  const vals  = [];

  if (companyId) {
    vals.push(companyId);
    conds.push(`p.company_id = $${vals.length}`);
  }

  const { rows } = await query(`
    SELECT
      c.company_name,
      p.product_id, p.product_name, p.sku, p.unit_of_measure,
      COALESCE(pc.category_name, 'Uncategorized') AS category_name,
      b.branch_name, b.branch_id,
      pbi.quantity_available::numeric  AS qty,
      COALESCE(p.cost_price, 0)::numeric AS unit_cost,
      (pbi.quantity_available * COALESCE(p.cost_price, 0))::numeric AS total_value,
      pbi.reorder_level
    FROM product_branch_inventory pbi
    JOIN products  p  ON p.product_id  = pbi.product_id
    JOIN branches  b  ON b.branch_id   = pbi.branch_id
    JOIN companies c  ON c.company_id  = p.company_id
    LEFT JOIN categories pc ON pc.category_id = p.category_id
    WHERE ${conds.join(' AND ')}
    ORDER BY c.company_name, total_value DESC
  `, vals);

  const items = rows.map((r) => ({
    companyName:  r.company_name,
    productId:    r.product_id,
    productName:  r.product_name,
    sku:          r.sku,
    uom:          r.unit_of_measure,
    category:     r.category_name,
    branchName:   r.branch_name,
    branchId:     r.branch_id,
    qty:          parseFloat(r.qty),
    unitCost:     parseFloat(r.unit_cost),
    totalValue:   parseFloat(r.total_value),
    reorderLevel: r.reorder_level,
    belowReorder: parseFloat(r.qty) <= (r.reorder_level || 0),
  }));

  return {
    items,
    totalValue: +items.reduce((s, i) => s + i.totalValue, 0).toFixed(2),
    totalUnits: +items.reduce((s, i) => s + i.qty,        0).toFixed(3),
  };
}

async function createSuperAdmin({ first_name, last_name, email, phone }) {
  if (!first_name || !email) throw AppError.badRequest('first_name and email are required');

  const emailLower = email.toLowerCase().trim();
  const { rows: dup } = await query('SELECT 1 FROM users WHERE email = $1', [emailLower]);
  if (dup.length) throw AppError.conflict('A user with this email already exists');

  const { rows: roleRows } = await query(`SELECT role_id FROM roles WHERE role_name = 'super_admin' LIMIT 1`);
  if (!roleRows.length) throw AppError.internal('super_admin role not found');
  const superAdminRoleId = roleRows[0].role_id;

  const password = generateTempPassword();
  const password_hash = await bcrypt.hash(password, env.bcryptRounds);

  const baseUsername = emailLower.split('@')[0].replace(/[^a-z0-9._-]/gi, '').slice(0, 60) || 'admin';
  const { rows: existing } = await query(
    `SELECT username FROM users WHERE username ILIKE $1 OR username ILIKE $2`,
    [baseUsername, `${baseUsername}\\_%`]
  );
  const taken = new Set(existing.map((r) => r.username.toLowerCase()));
  let resolvedUsername = baseUsername;
  let suffix = 1;
  while (taken.has(resolvedUsername.toLowerCase())) resolvedUsername = `${baseUsername}_${suffix++}`;

  return transaction(async (client) => {
    const { rows } = await client.query(`
      INSERT INTO users (company_id, first_name, last_name, email, username, phone, password_hash)
      VALUES (NULL, $1, $2, $3, $4, $5, $6)
      RETURNING user_id, first_name, last_name, email, username, phone, is_active, created_at
    `, [first_name, last_name, emailLower, resolvedUsername, phone || null, password_hash]);

    const user = rows[0];
    await client.query(`
      INSERT INTO user_roles (user_role_id, user_id, role_id)
      VALUES (gen_random_uuid(), $1, $2) ON CONFLICT DO NOTHING
    `, [user.user_id, superAdminRoleId]);

    return { ...user, temp_password: password };
  });
}

module.exports = {
  listAllCompanies, listAllUsers, listAllBranches, listAllTerminals,
  listAllSessions,  listAllSales,  listAllProducts,  listAllInventory,
  listAllCustomers, listAllPaymentMethods, platformStats,
  listAllSuppliers, listAllPurchases, listAllApPayments,
  listAllAccounts,  listAllBankAccounts,  listAllJournals,
  listAllMpesaConfigs, saveMpesaConfig, toggleMpesaConfig,
  listAllMpesaTransactions,
  listPlans, createPlan, updatePlan, deletePlan,
  changeCompanyPlan, changeCompanyStatus,
  listSubscriptions, recordSubscription, autoSuspendExpired,
  platformStockValuation,
  createSuperAdmin, updateAnyUser,
  listSubscriptionRequests, actionSubscriptionRequest,
};
