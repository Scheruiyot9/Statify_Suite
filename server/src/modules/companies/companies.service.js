const { query, transaction } = require('../../config/database');
const bcrypt = require('bcryptjs');
const AppError = require('../../shared/AppError');
const env = require('../../config/env');
const QueryBuilder = require('../../shared/qb');
const { sendMail } = require('../../shared/mailer');

const DEFAULT_ROLE_PERMISSIONS = {
  company_admin: [
    'view_sales', 'create_transaction', 'void_transaction', 'process_refund',
    'apply_discount', 'view_inventory', 'adjust_stock', 'transfer_stock',
    'view_products', 'manage_products', 'view_customers', 'manage_customers',
    'view_reports', 'view_all_branches', 'export_reports', 'manage_users',
    'manage_settings', 'open_pos_session',
  ],
  branch_manager: [
    'view_sales', 'create_transaction', 'void_transaction', 'process_refund',
    'apply_discount', 'view_inventory', 'adjust_stock', 'transfer_stock',
    'view_products', 'view_customers', 'manage_customers', 'view_reports',
    'open_pos_session',
  ],
  cashier: [
    'view_sales', 'create_transaction', 'apply_discount', 'view_products',
    'view_customers', 'view_inventory', 'open_pos_session',
  ],
  accountant: [
    'view_sales', 'view_inventory', 'adjust_stock', 'view_products',
    'manage_products', 'view_customers', 'view_reports', 'view_all_branches',
    'export_reports',
  ],
};

async function ensureCompanyRoles(client, companyId) {
  const roleIds = {};

  for (const [roleName, permissionCodes] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
    const { rows: roleRows } = await client.query(`
      INSERT INTO roles (company_id, role_name, is_system_role)
      VALUES ($1, $2, TRUE)
      ON CONFLICT (company_id, role_name) DO UPDATE SET role_name = EXCLUDED.role_name
      RETURNING role_id
    `, [companyId, roleName]);

    const roleId = roleRows[0].role_id;
    roleIds[roleName] = roleId;

    for (const permissionCode of permissionCodes) {
      await client.query(`
        INSERT INTO role_permissions (role_id, permission_id, can_create, can_read, can_update, can_delete, can_export)
        SELECT $1, permission_id, TRUE, TRUE, TRUE, FALSE, TRUE
        FROM permissions
        WHERE permission_code = $2
        ON CONFLICT (role_id, permission_id) DO NOTHING
      `, [roleId, permissionCode]);
    }
  }

  return roleIds;
}

async function listCompanies({ search, status, page = 1, limit = 25 } = {}) {
  const qb = new QueryBuilder();
  const conditions = [];

  if (search) {
    conditions.push(`c.company_name ILIKE $${qb.add(`%${search}%`)}`);
  }
  if (status) {
    conditions.push(`c.subscription_status = $${qb.add(status)}`);
  }

  const pg = parseInt(page, 10);
  const lm = parseInt(limit, 10);
  const limIdx = qb.add(lm);
  const offIdx = qb.add((pg - 1) * lm);

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await query(`
    SELECT
      c.company_id, c.company_name, c.subscription_plan_id, c.subscription_status,
      COALESCE(c.domain, c.domain_name) AS domain, c.is_active, c.timezone, c.currency, c.created_at,
      c.logo_url,
      sp.plan_name, sp.max_users, sp.max_branches,
      (SELECT COUNT(*) FROM branches b
       WHERE b.company_id = c.company_id AND b.is_active = TRUE) AS branch_count,
      (SELECT COUNT(*) FROM users u
       WHERE u.company_id = c.company_id AND u.is_active = TRUE) AS user_count,
      COUNT(*) OVER() AS total_count
    FROM companies c
    LEFT JOIN subscription_plans sp ON sp.plan_id = c.subscription_plan_id
    ${whereClause}
    ORDER BY c.created_at DESC
    LIMIT $${limIdx} OFFSET $${offIdx}
  `, qb.params);

  const total = rows.length ? parseInt(rows[0].total_count) : 0;
  return {
    companies: rows.map((r) => ({
      company_id: r.company_id,
      company_name: r.company_name,
      domain: r.domain,
      logo_url: r.logo_url ?? null,
      subscription_status: r.subscription_status,
      subscription_plan_id: r.subscription_plan_id,
      is_active: r.is_active,
      timezone: r.timezone,
      currency: r.currency,
      created_at: r.created_at,
      plan_name: r.plan_name,
      max_users: r.max_users,
      max_branches: r.max_branches,
      branch_count: parseInt(r.branch_count),
      user_count: parseInt(r.user_count),
    })),
    total, page: pg, limit: lm, pages: Math.ceil(total / lm),
  };
}

async function getCompany(companyId) {
  const { rows } = await query(`
    SELECT
      c.*,
      sp.plan_name, sp.max_users, sp.max_branches, sp.price AS plan_price,
      (SELECT COUNT(*) FROM branches b
       WHERE b.company_id = c.company_id AND b.is_active = TRUE) AS branch_count,
      (SELECT COUNT(*) FROM users u
       WHERE u.company_id = c.company_id AND u.is_active = TRUE) AS user_count
    FROM companies c
    LEFT JOIN subscription_plans sp ON sp.plan_id = c.subscription_plan_id
    WHERE c.company_id = $1
  `, [companyId]);

  if (!rows.length) throw AppError.notFound('Company');
  const r = rows[0];
  return { ...r, domain: r.domain || r.domain_name, branch_count: parseInt(r.branch_count), user_count: parseInt(r.user_count) };
}

// Full tenant onboarding: company + HQ branch + admin user + seed data
async function createCompany(data) {
  const {
    company_name, domain, timezone = 'Africa/Nairobi', currency = 'KES',
    subscription_plan_id,
    branch_name = 'Main Branch', branch_code,
    admin_first_name, admin_last_name, admin_email, admin_password = 'Admin@123',
  } = data;

  if (!company_name) throw AppError.badRequest('company_name is required');
  if (!admin_email) throw AppError.badRequest('admin_email is required');

  const emailLower = admin_email.toLowerCase().trim();
  const { rows: dup } = await query('SELECT 1 FROM users WHERE email = $1', [emailLower]);
  if (dup.length) throw AppError.conflict('A user with that email already exists');

  return transaction(async (client) => {
    // 1. Create company
    const { rows: [company] } = await client.query(`
      INSERT INTO companies (
        company_name, domain_name, domain, contact_email, timezone, currency,
        subscription_plan_id, subscription_status, is_active
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'trial', TRUE)
      RETURNING *
    `, [
      company_name,
      domain || null,   // domain_name
      domain || null,   // domain
      emailLower,
      timezone,
      currency,
      subscription_plan_id || null
    ]);
    // 2. Create headquarters branch
    const bCode = branch_code
      || (company_name.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) + '-HQ');

    const { rows: [branch] } = await client.query(`
      INSERT INTO branches (company_id, branch_name, branch_code, is_headquarters, is_active)
      VALUES ($1, $2, $3, TRUE, TRUE)
      RETURNING branch_id, branch_name, branch_code, is_headquarters
    `, [company.company_id, branch_name, bCode]);

    // 3. Create tenant roles and default role permissions
    const roleIds = await ensureCompanyRoles(client, company.company_id);

    // 4. Create admin user
    const passwordHash = await bcrypt.hash(admin_password, env.bcryptRounds);
    const username = emailLower.split('@')[0].replace(/[^a-z0-9._-]/gi, '').slice(0, 60) || 'admin';
    const { rows: [adminUser] } = await client.query(`
      INSERT INTO users (company_id, username, first_name, last_name, email, password_hash, is_active)
      VALUES ($1, $2, $3, $4, $5, $6, TRUE)
      RETURNING user_id, first_name, last_name, email
    `, [company.company_id,
      username,
    admin_first_name || 'Admin',
    admin_last_name || 'User',
      emailLower,
      passwordHash]);

    // 5. Assign company_admin role
    await client.query(`
      INSERT INTO user_roles (user_role_id, user_id, role_id)
      VALUES (gen_random_uuid(), $1, $2) ON CONFLICT DO NOTHING
    `, [adminUser.user_id, roleIds.company_admin]);

    // 6. Assign admin to HQ branch as default
    await client.query(`
      INSERT INTO user_branch_assignments (assignment_id, user_id, branch_id, is_default_branch)
      VALUES (gen_random_uuid(), $1, $2, TRUE) ON CONFLICT DO NOTHING
    `, [adminUser.user_id, branch.branch_id]);

    // 7. Seed Walk-in customer group (required for walk-in sales)
    await client.query(`
      INSERT INTO customer_groups (company_id, group_name, is_system_group, is_active)
      VALUES ($1, 'Walk-in', TRUE, TRUE) ON CONFLICT DO NOTHING
    `, [company.company_id]);

    // 8. Seed default payment methods
    for (const pm of [
      { name: 'Cash', ref: false },
      { name: 'M-Pesa', ref: true },
      { name: 'Card', ref: false },
    ]) {
      await client.query(`
        INSERT INTO payment_methods (company_id, method_name, is_active, requires_reference)
        VALUES ($1, $2, TRUE, $3) ON CONFLICT DO NOTHING
      `, [company.company_id, pm.name, pm.ref]);
    }

    // 9. Seed default Chart of Accounts (required for double-entry journals)
    const DEFAULT_ACCOUNTS = [
      { code: '1000', name: 'Cash on Hand',            type: 'asset',     subtype: 'current_asset',      system: true  },
      { code: '1010', name: 'Bank - Main Account',      type: 'asset',     subtype: 'current_asset',      system: false },
      { code: '1100', name: 'Accounts Receivable',      type: 'asset',     subtype: 'current_asset',      system: true  },
      { code: '1200', name: 'Inventory',                type: 'asset',     subtype: 'current_asset',      system: true  },
      { code: '1300', name: 'Prepaid Expenses',         type: 'asset',     subtype: 'current_asset',      system: false },
      { code: '1500', name: 'Fixed Assets',             type: 'asset',     subtype: 'fixed_asset',        system: false },
      { code: '1510', name: 'Accumulated Depreciation', type: 'asset',     subtype: 'fixed_asset',        system: false },
      { code: '2000', name: 'Accounts Payable',         type: 'liability', subtype: 'current_liability',  system: true  },
      { code: '2100', name: 'VAT Payable',              type: 'liability', subtype: 'current_liability',  system: false },
      { code: '2200', name: 'PAYE Payable',             type: 'liability', subtype: 'current_liability',  system: false },
      { code: '2300', name: 'Short-term Loans',         type: 'liability', subtype: 'current_liability',  system: false },
      { code: '3000', name: "Owner's Capital",          type: 'equity',    subtype: null,                 system: false },
      { code: '3100', name: 'Retained Earnings',        type: 'equity',    subtype: null,                 system: false },
      { code: '4000', name: 'Sales Revenue',            type: 'revenue',   subtype: null,                 system: true  },
      { code: '4100', name: 'Service Revenue',          type: 'revenue',   subtype: null,                 system: false },
      { code: '4200', name: 'Other Income',             type: 'revenue',   subtype: null,                 system: false },
      { code: '5000', name: 'Cost of Goods Sold',       type: 'expense',   subtype: null,                 system: true  },
      { code: '5100', name: 'Salaries & Wages',         type: 'expense',   subtype: null,                 system: false },
      { code: '5200', name: 'Rent',                     type: 'expense',   subtype: null,                 system: false },
      { code: '5300', name: 'Utilities',                type: 'expense',   subtype: null,                 system: false },
      { code: '5400', name: 'Marketing & Advertising',  type: 'expense',   subtype: null,                 system: false },
      { code: '5500', name: 'Office Supplies',          type: 'expense',   subtype: null,                 system: false },
      { code: '5600', name: 'Depreciation',             type: 'expense',   subtype: null,                 system: false },
      { code: '5700', name: 'Bank Charges',             type: 'expense',   subtype: null,                 system: false },
      { code: '5800', name: 'Other Expenses',           type: 'expense',   subtype: null,                 system: false },
    ];
    for (const a of DEFAULT_ACCOUNTS) {
      await client.query(`
        INSERT INTO accounts (company_id, account_code, account_name, account_type, account_subtype, is_system)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (company_id, account_code) DO NOTHING
      `, [company.company_id, a.code, a.name, a.type, a.subtype, a.system]);
    }

    return { company, branch, admin_user: adminUser };
  });
}

async function updateCompany(companyId, data) {
  const { company_name, domain, timezone, currency, subscription_plan_id, logo_url } = data;

  const { rows } = await query(`
    UPDATE companies
    SET company_name         = COALESCE($2, company_name),
        domain_name          = COALESCE($3, domain_name),
        domain               = COALESCE($3, domain),
        timezone             = COALESCE($4, timezone),
        currency             = COALESCE($5, currency),
        subscription_plan_id = COALESCE($6, subscription_plan_id),
        logo_url             = CASE WHEN $7::TEXT IS NOT NULL THEN $7::TEXT ELSE logo_url END,
        updated_at           = now()
    WHERE company_id = $1
    RETURNING company_id, company_name, COALESCE(domain, domain_name) AS domain,
              timezone, currency, subscription_status, is_active, logo_url
  `, [companyId,
    company_name || null,
    domain || null,
    timezone || null,
    currency || null,
    subscription_plan_id || null,
    logo_url || null]);

  if (!rows.length) throw AppError.notFound('Company');
  return rows[0];
}

async function getMyCompany(companyId) {
  const { rows } = await query(
    `SELECT company_id, company_name, logo_url, tax_id,
            lock_timeout_minutes, session_lifetime_days,
            pos_allow_price_edit, pos_allow_partial_qty
       FROM companies WHERE company_id = $1`,
    [companyId]
  );
  if (!rows.length) throw AppError.notFound('Company');
  return rows[0];
}

async function updateMyProfile(companyId, patch) {
  const ALLOWED_DAYS = [1, 3, 7, 14, 30, 90];
  const setParts = [];
  const params   = [companyId];
  const p        = (val) => { params.push(val); return `$${params.length}`; };

  // Only update each field when it was explicitly present in the PATCH body
  if ('tax_id' in patch) {
    setParts.push(`tax_id = COALESCE(${p(patch.tax_id ?? null)}, tax_id)`);
  }
  if ('lock_timeout_minutes' in patch) {
    const raw     = patch.lock_timeout_minutes;
    const timeout = raw != null
      ? Math.min(120, Math.max(1, parseInt(raw, 10))) || null
      : null;
    setParts.push(`lock_timeout_minutes = ${p(timeout)}`);
  }
  if ('session_lifetime_days' in patch) {
    const raw  = patch.session_lifetime_days;
    const days = raw != null
      ? (ALLOWED_DAYS.includes(parseInt(raw, 10)) ? parseInt(raw, 10) : 7)
      : null;
    setParts.push(`session_lifetime_days = COALESCE(${p(days)}, session_lifetime_days)`);
  }
  if ('pos_allow_price_edit' in patch) {
    setParts.push(`pos_allow_price_edit = COALESCE(${p(Boolean(patch.pos_allow_price_edit))}, pos_allow_price_edit)`);
  }
  if ('pos_allow_partial_qty' in patch) {
    setParts.push(`pos_allow_partial_qty = COALESCE(${p(Boolean(patch.pos_allow_partial_qty))}, pos_allow_partial_qty)`);
  }

  if (!setParts.length) throw AppError.badRequest('No fields to update');

  const { rows } = await query(
    `UPDATE companies
        SET ${setParts.join(', ')}, updated_at = now()
      WHERE company_id = $1
      RETURNING company_id, company_name, logo_url, tax_id,
                lock_timeout_minutes, session_lifetime_days,
                pos_allow_price_edit, pos_allow_partial_qty`,
    params
  );
  if (!rows.length) throw AppError.notFound('Company');
  return rows[0];
}

async function getLoyaltySettings(companyId) {
  const { rows } = await query(
    `SELECT points_earn_rate, points_redeem_rate FROM companies WHERE company_id = $1`,
    [companyId]
  );
  if (!rows.length) throw AppError.notFound('Company');
  return {
    points_earn_rate:   parseFloat(rows[0].points_earn_rate),
    points_redeem_rate: parseFloat(rows[0].points_redeem_rate),
  };
}

async function updateLoyaltySettings(companyId, { points_earn_rate, points_redeem_rate }) {
  if (points_earn_rate   <= 0) throw AppError.badRequest('Earn rate must be greater than 0');
  if (points_redeem_rate <= 0) throw AppError.badRequest('Redeem rate must be greater than 0');
  const { rows } = await query(`
    UPDATE companies
    SET points_earn_rate = $2, points_redeem_rate = $3, updated_at = now()
    WHERE company_id = $1
    RETURNING points_earn_rate, points_redeem_rate
  `, [companyId, points_earn_rate, points_redeem_rate]);
  if (!rows.length) throw AppError.notFound('Company');
  return {
    points_earn_rate:   parseFloat(rows[0].points_earn_rate),
    points_redeem_rate: parseFloat(rows[0].points_redeem_rate),
  };
}

async function updateSubscriptionStatus(companyId, { status }) {
  const allowed = ['trial', 'active', 'suspended', 'cancelled'];
  if (!allowed.includes(status))
    throw AppError.badRequest(`status must be one of: ${allowed.join(', ')}`);

  const isActive = !['suspended', 'cancelled'].includes(status);

  const { rows } = await query(`
    UPDATE companies
    SET subscription_status = $2,
        is_active           = $3,
        updated_at          = now()
    WHERE company_id = $1
    RETURNING company_id, company_name, subscription_status, is_active
  `, [companyId, status, isActive]);

  if (!rows.length) throw AppError.notFound('Company');
  return rows[0];
}

async function listSubscriptionPlans() {
  const { rows } = await query(
    `SELECT plan_id, plan_name, price::numeric, annual_price::numeric,
            max_users, max_branches, trial_days,
            has_finance, has_api_access, sort_order, is_active
     FROM subscription_plans
     WHERE is_active = TRUE
     ORDER BY sort_order, price`,
    []
  );
  return rows;
}

async function getMySubscription(companyId) {
  const { rows } = await query(
    `SELECT
       c.company_id, c.company_name,
       c.subscription_status,
       c.subscription_plan_id,
       c.subscription_start_date,
       c.subscription_end_date,
       sp.plan_name, sp.price::numeric AS plan_price, sp.annual_price::numeric,
       sp.max_users, sp.max_branches, sp.trial_days,
       sp.has_finance, sp.has_api_access,
       (SELECT COUNT(*) FROM users u WHERE u.company_id = c.company_id AND u.is_active = TRUE AND u.deleted_at IS NULL) AS user_count,
       (SELECT COUNT(*) FROM branches b WHERE b.company_id = c.company_id AND b.is_active = TRUE) AS branch_count
     FROM companies c
     LEFT JOIN subscription_plans sp ON sp.plan_id = c.subscription_plan_id
     WHERE c.company_id = $1`,
    [companyId]
  );
  if (!rows.length) throw AppError.notFound('Company');
  const r = rows[0];
  return {
    subscription_status:     r.subscription_status,
    plan_name:               r.plan_name ?? 'None',
    plan_price:              parseFloat(r.plan_price ?? 0),
    annual_price:            parseFloat(r.annual_price ?? 0),
    max_users:               r.max_users,
    max_branches:            r.max_branches,
    trial_days:              r.trial_days,
    has_finance:             r.has_finance ?? false,
    has_api_access:          r.has_api_access ?? false,
    subscription_start_date: r.subscription_start_date ?? null,
    subscription_end_date:   r.subscription_end_date ?? null,
    current_users:           parseInt(r.user_count),
    current_branches:        parseInt(r.branch_count),
  };
}

async function requestUpgrade(companyId, { planName, message }) {
  const { rows } = await query(
    `SELECT c.company_name, c.contact_email, sp.plan_name AS current_plan
     FROM companies c
     LEFT JOIN subscription_plans sp ON sp.plan_id = c.subscription_plan_id
     WHERE c.company_id = $1`,
    [companyId]
  );
  if (!rows.length) throw AppError.notFound('Company');
  const { company_name, contact_email, current_plan } = rows[0];

  await sendMail({
    to: 'support@statify.co.ke',
    subject: `Upgrade request: ${company_name}`,
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;background:#f9fafb;border-radius:12px">
        <h2 style="color:#024A59">Subscription Upgrade Request</h2>
        <table style="width:100%;border-collapse:collapse;font-size:14px;color:#374151">
          <tr><td style="padding:6px 0;font-weight:600;width:160px">Company</td><td>${company_name}</td></tr>
          <tr><td style="padding:6px 0;font-weight:600">Company ID</td><td style="font-family:monospace">${companyId}</td></tr>
          <tr><td style="padding:6px 0;font-weight:600">Contact Email</td><td>${contact_email ?? '—'}</td></tr>
          <tr><td style="padding:6px 0;font-weight:600">Current Plan</td><td>${current_plan ?? 'None'}</td></tr>
          <tr><td style="padding:6px 0;font-weight:600">Requested Plan</td><td>${planName ?? 'Not specified'}</td></tr>
          <tr><td style="padding:6px 0;font-weight:600;vertical-align:top">Message</td><td>${message || '—'}</td></tr>
        </table>
      </div>
    `,
    text: `Upgrade request from ${company_name} (${companyId})\nContact: ${contact_email}\nCurrent: ${current_plan}\nRequested: ${planName}\nMessage: ${message}`,
  });
}

async function submitSubscriptionRequest(companyId, { planId, period, message }) {
  if (!planId) throw AppError.badRequest('planId is required');
  const validPeriods = ['monthly', 'quarterly', 'semi_annual', 'annual', 'biennial', 'custom'];
  if (!validPeriods.includes(period)) throw AppError.badRequest('Invalid period');

  const { rows: [plan] } = await query(
    `SELECT plan_id FROM subscription_plans WHERE plan_id = $1 AND is_active = TRUE`, [planId]
  );
  if (!plan) throw AppError.notFound('Subscription plan');

  const { rows: [req] } = await query(`
    INSERT INTO subscription_requests (company_id, plan_id, period, message)
    VALUES ($1, $2, $3, $4)
    RETURNING request_id, company_id, plan_id, period, message, status, created_at
  `, [companyId, planId, period, message || null]);

  return req;
}

async function listMySubscriptionRequests(companyId, { page = 1, limit = 20 } = {}) {
  const pg = Math.max(1, parseInt(page, 10));
  const lm = Math.min(100, Math.max(1, parseInt(limit, 10)));

  const { rows } = await query(`
    SELECT sr.request_id, sr.period, sr.message, sr.status,
           sr.rejection_reason, sr.created_at, sr.actioned_at,
           sp.plan_name, sp.price::numeric AS plan_price,
           u.first_name || ' ' || u.last_name AS actioned_by_name,
           COUNT(*) OVER() AS total_count
      FROM subscription_requests sr
      JOIN subscription_plans sp ON sp.plan_id = sr.plan_id
      LEFT JOIN users u ON u.user_id = sr.actioned_by
     WHERE sr.company_id = $1
     ORDER BY sr.created_at DESC
     LIMIT $2 OFFSET $3
  `, [companyId, lm, (pg - 1) * lm]);

  const total = rows.length ? parseInt(rows[0].total_count) : 0;
  return {
    requests: rows.map(({ total_count: _, ...r }) => r),
    total, page: pg, limit: lm, pages: Math.ceil(total / lm),
  };
}

async function deleteCompany(companyId) {
  const { rows: open } = await query(
    `SELECT COUNT(*) AS cnt
     FROM pos_sessions ps
     JOIN pos_terminals pt ON pt.terminal_id = ps.terminal_id
     JOIN branches b ON b.branch_id = pt.branch_id
     WHERE b.company_id = $1 AND ps.status = 'open'`,
    [companyId]
  );
  if (parseInt(open[0].cnt) > 0) {
    throw AppError.badRequest('Close all active POS sessions before deleting this company');
  }

  const { rows } = await query(
    'DELETE FROM companies WHERE company_id = $1 RETURNING company_id, company_name',
    [companyId]
  );
  if (!rows.length) throw AppError.notFound('Company');
  return rows[0];
}

module.exports = {
  listCompanies,
  getCompany,
  createCompany,
  updateCompany,
  updateSubscriptionStatus,
  deleteCompany,
  listSubscriptionPlans,
  getMyCompany,
  updateMyProfile,
  getLoyaltySettings,
  updateLoyaltySettings,
  getMySubscription,
  requestUpgrade,
  submitSubscriptionRequest,
  listMySubscriptionRequests,
};
