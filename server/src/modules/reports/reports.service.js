const { query } = require('../../config/database');
const { isCompanyWide, branchScope } = require('../../shared/roles');

const SALES_DASHBOARD_ROLES = ['super_admin', 'company_admin', 'branch_manager', 'accountant', 'cashier'];
const INVENTORY_DASHBOARD_ROLES = ['super_admin', 'company_admin', 'branch_manager', 'accountant'];

// Platform-level summary when super_admin has no tenant context
async function getPlatformSummary() {
  const [summaryRes, tenantRes] = await Promise.all([
    query(`
      SELECT
        COALESCE(SUM(total_amount) FILTER (WHERE transaction_date::date = CURRENT_DATE), 0)::numeric AS today_sales,
        COUNT(*)                   FILTER (WHERE transaction_date::date = CURRENT_DATE)              AS today_txns,
        COUNT(DISTINCT customer_id) FILTER (WHERE transaction_date::date = CURRENT_DATE AND customer_id IS NOT NULL) AS customers_served
      FROM sales_transactions
      WHERE status = 'completed'
    `),
    query(`
      SELECT COUNT(*) FILTER (WHERE is_active = TRUE) AS active_companies,
             COUNT(*) AS total_companies
      FROM companies
    `),
  ]);

  const s = summaryRes.rows[0];
  const t = tenantRes.rows[0];

  return {
    todaySales:         parseFloat(s.today_sales),
    todayTransactions:  parseInt(s.today_txns),
    customersServed:    parseInt(s.customers_served),
    lowStockCount:      0,
    salesTrend:         [],
    recentTransactions: [],
    topProducts:        [],
    branchComparison:   [],
    platform: {
      activeCompanies: parseInt(t.active_companies),
      totalCompanies:  parseInt(t.total_companies),
    },
  };
}

async function getDashboard(companyId, role, branchIds, { period = '7d', userId, startDate, endDate } = {}) {
  if (!companyId) return getPlatformSummary();

  const isCashier = role === 'cashier';
  const canViewSales = SALES_DASHBOARD_ROLES.includes(role);
  const canViewInventory = INVENTORY_DASHBOARD_ROLES.includes(role);

  // Calendar-aligned date ranges so "Week" = Mon–today, "Month" = 1st–today, "Year" = Jan 1–today
  const _now = new Date();
  const todayStr    = _now.toISOString().slice(0, 10);
  const _dow        = _now.getDay(); // 0=Sun … 6=Sat
  const daysSinceMon  = _dow === 0 ? 6 : _dow - 1;
  const daysSince1st  = _now.getDate() - 1;
  const daysSinceJan1 = Math.floor((_now - new Date(_now.getFullYear(), 0, 1)) / 86400000);

  let trendDays, periodStart, periodEnd;

  if (startDate && endDate) {
    periodStart = startDate;
    periodEnd   = endDate;
    trendDays   = Math.max(0, Math.floor((new Date(endDate) - new Date(startDate)) / 86400000));
  } else {
    periodEnd = todayStr;
    trendDays =
      period === '1d'  ? 0 :
      period === '7d'  ? daysSinceMon :
      period === '30d' ? daysSince1st :
      period === '90d' ? 89 :
      period === '1y'  ? daysSinceJan1 :
      daysSinceMon;
    const pStart = new Date(_now);
    pStart.setDate(pStart.getDate() - trendDays);
    periodStart = pStart.toISOString().slice(0, 10);
  }

  const { clause: bClause, params: bParams } = branchScope(role, companyId, branchIds);
  const allBranches = isCompanyWide(role);

  // Cashier scope: additionally filter by their own user_id
  let cashierClause = '';
  let cParams = [...bParams];
  if (isCashier && userId) {
    cParams.push(userId);
    cashierClause = `AND st.cashier_user_id = $${cParams.length}`;
  }

  // Date range params appended after cParams / bParams
  const pStart = cParams.length + 1;
  const pEnd   = cParams.length + 2;
  const dateParams  = [...cParams,  periodStart, periodEnd];

  const bPStart = bParams.length + 1;
  const bPEnd   = bParams.length + 2;
  const bDateParams = [...bParams, periodStart, periodEnd];

  const [summaryRes, lowStockRes, trendRes, recentRes, topProdsRes, categoryRes, branchRes, payMethodRes] = await Promise.all([

    // 1. Today's summary + yesterday for % change
    query(`
      SELECT
        COALESCE(SUM(total_amount) FILTER (WHERE transaction_date::date = CURRENT_DATE),     0)::numeric AS today_sales,
        COALESCE(SUM(total_amount) FILTER (WHERE transaction_date::date = CURRENT_DATE - 1), 0)::numeric AS yesterday_sales,
        COUNT(*)                   FILTER (WHERE transaction_date::date = CURRENT_DATE)                  AS today_txns,
        COUNT(DISTINCT customer_id) FILTER (
          WHERE transaction_date::date = CURRENT_DATE AND customer_id IS NOT NULL
        )                                                                                                AS customers_served
      FROM sales_transactions st
      WHERE st.company_id = $1 AND st.status = 'completed'
      ${bClause} ${cashierClause}
    `, cParams),

    // 2. Low stock count
    query(`
      SELECT COUNT(DISTINCT pbi.product_id) AS cnt
      FROM product_branch_inventory pbi
      JOIN branches br ON br.branch_id = pbi.branch_id AND br.company_id = $1
        ${allBranches ? '' : 'AND pbi.branch_id = ANY($2)'}
      JOIN products p ON p.product_id = pbi.product_id
        AND p.is_active = TRUE AND p.company_id = $1
      WHERE pbi.reorder_level > 0
        AND pbi.quantity_available <= pbi.reorder_level
    `, bParams),

    // 3. Sales trend — explicit date range so custom dates work correctly
    query(`
      SELECT
        gs.day::date                                AS sale_date,
        COALESCE(SUM(st.total_amount), 0)::numeric  AS total,
        COALESCE(COUNT(st.transaction_id), 0)::int  AS txn_count
      FROM generate_series($${pStart}::date, $${pEnd}::date, INTERVAL '1 day') AS gs(day)
      LEFT JOIN sales_transactions st
        ON st.transaction_date::date = gs.day::date
        AND st.company_id = $1
        AND st.status = 'completed'
        ${bClause} ${cashierClause}
      GROUP BY gs.day
      ORDER BY gs.day
    `, dateParams),

    // 4. Recent transactions — cashier only (removed from non-cashier dashboard)
    isCashier
      ? query(`
          SELECT
            st.transaction_id,
            st.transaction_number,
            st.transaction_date,
            st.total_amount::numeric,
            st.status,
            COALESCE(c.customer_name, 'Walk-in')   AS customer_name,
            u.first_name || ' ' || u.last_name     AS cashier_name,
            b.branch_name,
            (SELECT pm.method_name
               FROM transaction_payments tp
               JOIN payment_methods pm ON pm.payment_method_id = tp.payment_method_id
              WHERE tp.transaction_id = st.transaction_id
              ORDER BY tp.sequence_no LIMIT 1)      AS payment_method
          FROM sales_transactions st
          LEFT JOIN customers c ON c.customer_id = st.customer_id
          JOIN users    u ON u.user_id   = st.cashier_user_id
          JOIN branches b ON b.branch_id = st.branch_id
          WHERE st.company_id = $1 AND st.status = 'completed'
          ${bClause} ${cashierClause}
          ORDER BY st.transaction_date DESC
          LIMIT 10
        `, cParams)
      : Promise.resolve({ rows: [] }),

    // 5. Top 10 products — frontend slices to 5, expands to 10 on "Show More"
    (!isCashier && canViewSales)
      ? query(`
          SELECT p.product_name, p.sku,
                 SUM(sti.quantity)::numeric   AS qty_sold,
                 SUM(sti.line_total)::numeric AS revenue
          FROM sales_transaction_items sti
          JOIN products p ON p.product_id = sti.product_id
          JOIN sales_transactions st ON st.transaction_id = sti.transaction_id
          WHERE st.company_id = $1 AND st.status = 'completed'
            AND st.transaction_date::date BETWEEN $${bPStart}::date AND $${bPEnd}::date
            ${bClause}
          GROUP BY p.product_id, p.product_name, p.sku
          ORDER BY revenue DESC
          LIMIT 10
        `, bDateParams)
      : Promise.resolve({ rows: [] }),

    // 6. Category breakdown
    (!isCashier && canViewSales)
      ? query(`
          SELECT COALESCE(pc.category_name, 'Uncategorised') AS category_name,
                 SUM(sti.quantity)::numeric   AS qty_sold,
                 SUM(sti.line_total)::numeric AS revenue
          FROM sales_transaction_items sti
          JOIN products p ON p.product_id = sti.product_id
          LEFT JOIN categories pc ON pc.category_id = p.category_id
          JOIN sales_transactions st ON st.transaction_id = sti.transaction_id
          WHERE st.company_id = $1 AND st.status = 'completed'
            AND st.transaction_date::date BETWEEN $${bPStart}::date AND $${bPEnd}::date
            ${bClause}
          GROUP BY pc.category_name
          ORDER BY revenue DESC
          LIMIT 8
        `, bDateParams)
      : Promise.resolve({ rows: [] }),

    // 7. Branch comparison
    allBranches
      ? query(`
          SELECT b.branch_id, b.branch_name, b.branch_code,
                 COALESCE(SUM(st.total_amount) FILTER (WHERE st.transaction_date::date = CURRENT_DATE),    0)::numeric AS today_sales,
                 COUNT(st.transaction_id)       FILTER (WHERE st.transaction_date::date = CURRENT_DATE)              AS today_txns,
                 COALESCE(SUM(st.total_amount) FILTER (
                   WHERE st.transaction_date::date BETWEEN $2::date AND $3::date
                 ), 0)::numeric AS period_sales
          FROM branches b
          LEFT JOIN sales_transactions st ON st.branch_id = b.branch_id AND st.status = 'completed'
          WHERE b.company_id = $1 AND b.is_active = TRUE
          GROUP BY b.branch_id, b.branch_name, b.branch_code
          ORDER BY period_sales DESC
        `, [companyId, periodStart, periodEnd])
      : Promise.resolve({ rows: [] }),

    // 8. Payment method breakdown
    (!isCashier && canViewSales)
      ? query(`
          SELECT pm.method_name,
                 COUNT(tp.payment_id)::int                        AS txn_count,
                 COALESCE(SUM(tp.amount_applied), 0)::numeric     AS total
          FROM transaction_payments tp
          JOIN payment_methods pm ON pm.payment_method_id = tp.payment_method_id
          JOIN sales_transactions st ON st.transaction_id = tp.transaction_id
          WHERE st.company_id = $1 AND st.status = 'completed'
            AND st.transaction_date::date BETWEEN $${bPStart}::date AND $${bPEnd}::date
            ${bClause}
          GROUP BY pm.payment_method_id, pm.method_name
          ORDER BY total DESC
        `, bDateParams)
      : Promise.resolve({ rows: [] }),
  ]);

  const s = summaryRes.rows[0];

  return {
    todaySales:        canViewSales ? parseFloat(s.today_sales)      : 0,
    yesterdaySales:    canViewSales ? parseFloat(s.yesterday_sales)  : 0,
    todayTransactions: canViewSales ? parseInt(s.today_txns)         : 0,
    customersServed:   canViewSales ? parseInt(s.customers_served)   : 0,
    lowStockCount:     canViewInventory ? parseInt(lowStockRes.rows[0].cnt) : 0,

    trendDays,
    periodStart,
    periodEnd,

    salesTrend: canViewSales ? trendRes.rows.map((r) => ({
      date:     r.sale_date,
      total:    parseFloat(r.total),
      txnCount: r.txn_count,
    })) : [],

    recentTransactions: isCashier ? recentRes.rows.map((r) => ({
      transactionId:     r.transaction_id,
      transactionNumber: r.transaction_number,
      transactionDate:   r.transaction_date,
      totalAmount:       parseFloat(r.total_amount),
      status:            r.status,
      customerName:      r.customer_name,
      cashierName:       r.cashier_name,
      branchName:        r.branch_name,
      paymentMethod:     r.payment_method || 'Cash',
    })) : [],

    topProducts: canViewSales ? topProdsRes.rows.map((r) => ({
      productName: r.product_name,
      sku:         r.sku,
      qtySold:     parseFloat(r.qty_sold),
      revenue:     parseFloat(r.revenue),
    })) : [],

    categoryBreakdown: canViewSales ? categoryRes.rows.map((r) => ({
      categoryName: r.category_name,
      qtySold:      parseFloat(r.qty_sold),
      revenue:      parseFloat(r.revenue),
    })) : [],

    branchComparison: branchRes.rows.map((r) => ({
      branchId:    r.branch_id,
      branchName:  r.branch_name,
      branchCode:  r.branch_code,
      todaySales:  parseFloat(r.today_sales),
      todayTxns:   parseInt(r.today_txns),
      periodSales: parseFloat(r.period_sales),
    })),

    paymentBreakdown: canViewSales ? payMethodRes.rows.map((r) => ({
      method: r.method_name,
      total:  parseFloat(r.total),
      count:  parseInt(r.txn_count),
    })) : [],

    isCashierView: isCashier,
  };
}

// companyId may be null for super-admin platform-wide view (all companies)
async function getSalesReport(companyId, role, branchIds, { startDate, endDate, branchId, sessionId } = {}) {
  const start = startDate || new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
  const end   = endDate   || new Date().toISOString().slice(0, 10);

  // Nullable companyId: NULL means all companies (platform view)
  const companyFilter = companyId
    ? 'st.company_id = $1'
    : '($1::uuid IS NULL OR st.company_id = $1::uuid)';

  let filterParams = [companyId];
  let filterClause = '';

  if (companyId && isCompanyWide(role)) {
    if (branchId) { filterParams.push(branchId); filterClause = 'AND st.branch_id = $2'; }
  } else if (companyId) {
    const ids = branchIds?.length ? branchIds : ['00000000-0000-0000-0000-000000000000'];
    filterParams.push(ids);
    filterClause = 'AND st.branch_id = ANY($2)';
  }

  const d1 = filterParams.length + 1;
  const d2 = filterParams.length + 2;
  filterParams.push(start, end);
  const dateFilter = `AND st.transaction_date::date BETWEEN $${d1} AND $${d2}`;

  let sessionFilter = '';
  if (sessionId) {
    filterParams.push(sessionId);
    sessionFilter = `AND st.pos_session_id = $${filterParams.length}`;
  }

  const [summaryRes, trendRes, topProdsRes, categoriesRes, cashiersRes] = await Promise.all([
    query(`
      SELECT
        COALESCE(SUM(total_amount), 0)::numeric AS total_sales,
        COUNT(*)::int                            AS total_txns,
        COALESCE(AVG(total_amount), 0)::numeric  AS avg_txn,
        COUNT(DISTINCT customer_id) FILTER (WHERE customer_id IS NOT NULL)::int AS unique_customers
      FROM sales_transactions st
      WHERE ${companyFilter} AND st.status = 'completed' ${filterClause} ${dateFilter} ${sessionFilter}
    `, filterParams),

    query(`
      SELECT gs.day::date AS sale_date,
        COALESCE(SUM(st.total_amount), 0)::numeric AS total,
        COALESCE(COUNT(st.transaction_id), 0)::int AS txn_count
      FROM generate_series($${d1}::date, $${d2}::date, INTERVAL '1 day') gs(day)
      LEFT JOIN sales_transactions st
        ON st.transaction_date::date = gs.day::date
        AND ${companyFilter} AND st.status = 'completed' ${filterClause} ${sessionFilter}
      GROUP BY gs.day ORDER BY gs.day
    `, filterParams),

    query(`
      SELECT p.product_name, p.sku,
        SUM(sti.quantity)::numeric   AS qty_sold,
        SUM(sti.line_total)::numeric AS revenue
      FROM sales_transaction_items sti
      JOIN products p ON p.product_id = sti.product_id
      JOIN sales_transactions st ON st.transaction_id = sti.transaction_id
      WHERE ${companyFilter} AND st.status = 'completed' ${filterClause} ${dateFilter} ${sessionFilter}
      GROUP BY p.product_id, p.product_name, p.sku
      ORDER BY revenue DESC LIMIT 10
    `, filterParams),

    query(`
      SELECT COALESCE(pc.category_name, 'Uncategorized') AS category_name,
        SUM(sti.line_total)::numeric AS revenue,
        SUM(sti.quantity)::numeric   AS qty_sold
      FROM sales_transaction_items sti
      JOIN products p ON p.product_id = sti.product_id
      LEFT JOIN categories pc ON pc.category_id = p.category_id
      JOIN sales_transactions st ON st.transaction_id = sti.transaction_id
      WHERE ${companyFilter} AND st.status = 'completed' ${filterClause} ${dateFilter} ${sessionFilter}
      GROUP BY pc.category_id, pc.category_name
      ORDER BY revenue DESC
    `, filterParams),

    query(`
      SELECT u.first_name || ' ' || u.last_name AS cashier_name,
        COUNT(st.transaction_id)::int AS txn_count,
        SUM(st.total_amount)::numeric AS total_sales,
        AVG(st.total_amount)::numeric AS avg_txn
      FROM sales_transactions st
      JOIN users u ON u.user_id = st.cashier_user_id
      WHERE ${companyFilter} AND st.status = 'completed' ${filterClause} ${dateFilter} ${sessionFilter}
      GROUP BY st.cashier_user_id, u.first_name, u.last_name
      ORDER BY total_sales DESC
    `, filterParams),
  ]);

  const s = summaryRes.rows[0];
  return {
    period:      { startDate: start, endDate: end },
    summary:     {
      totalSales:      parseFloat(s.total_sales),
      totalTxns:       parseInt(s.total_txns),
      avgTxn:          parseFloat(s.avg_txn),
      uniqueCustomers: parseInt(s.unique_customers),
    },
    trend:       trendRes.rows.map((r) => ({ date: r.sale_date, total: parseFloat(r.total), txnCount: r.txn_count })),
    topProducts: topProdsRes.rows.map((r) => ({ productName: r.product_name, sku: r.sku, qtySold: parseFloat(r.qty_sold), revenue: parseFloat(r.revenue) })),
    categories:  categoriesRes.rows.map((r) => ({ categoryName: r.category_name, revenue: parseFloat(r.revenue), qtySold: parseFloat(r.qty_sold) })),
    cashiers:    cashiersRes.rows.map((r) => ({ cashierName: r.cashier_name, txnCount: parseInt(r.txn_count), totalSales: parseFloat(r.total_sales), avgTxn: parseFloat(r.avg_txn) })),
  };
}

// ── P&L Report (journal-based) ────────────────────────────────────────────────

async function getPLReport(companyId, { startDate, endDate } = {}) {
  const start = startDate || new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
  const end   = endDate   || new Date().toISOString().slice(0, 10);

  const [jeRes, txnCountRes, returnsRes, paymentBreakRes] = await Promise.all([
    // Journal P&L: revenue, expense, and VAT Payable accounts for the period
    query(`
      SELECT
        a.account_code,
        a.account_name,
        a.account_type,
        COALESCE(SUM(jel.credit) FILTER (WHERE je.source_type IN ('SALE', 'SESSION_SALE_SUMMARY', 'DAILY_SALE_SUMMARY')), 0)::numeric AS sale_credit,
        COALESCE(SUM(jel.debit)  FILTER (WHERE je.source_type = 'RETURN'), 0)::numeric AS return_debit,
        COALESCE(SUM(jel.debit),  0)::numeric AS total_debit,
        COALESCE(SUM(jel.credit), 0)::numeric AS total_credit
      FROM ledger_entry_lines jel
      JOIN journal_entries je ON je.journal_entry_id = jel.journal_entry_id
      JOIN accounts a         ON a.account_id        = jel.account_id
      WHERE ($1::uuid IS NULL OR je.company_id = $1::uuid) AND je.status = 'posted'
        AND je.entry_date BETWEEN $2 AND $3
        AND (a.account_type IN ('revenue', 'expense') OR a.account_code = '2100')
      GROUP BY a.account_code, a.account_name, a.account_type
    `, [companyId, start, end]),

    // Sales transaction count
    query(`
      SELECT COUNT(*)::int AS txn_count
      FROM sales_transactions
      WHERE ($1::uuid IS NULL OR company_id = $1::uuid) AND status = 'completed'
        AND transaction_date::date BETWEEN $2 AND $3
    `, [companyId, start, end]),

    // Returns count only
    query(`
      SELECT COUNT(*)::int AS return_count
      FROM returns
      WHERE ($1::uuid IS NULL OR company_id = $1::uuid) AND status IN ('approved', 'refunded')
        AND return_date::date BETWEEN $2 AND $3
    `, [companyId, start, end]),

    // Payment method breakdown
    query(`
      SELECT pm.method_name,
             COUNT(DISTINCT st.transaction_id)::int AS txn_count,
             COALESCE(SUM(tp.amount_applied), 0)::numeric   AS amount
      FROM transaction_payments tp
      JOIN payment_methods pm ON pm.payment_method_id = tp.payment_method_id
      JOIN sales_transactions st ON st.transaction_id = tp.transaction_id
      WHERE ($1::uuid IS NULL OR st.company_id = $1::uuid) AND st.status = 'completed'
        AND st.transaction_date::date BETWEEN $2 AND $3
      GROUP BY pm.method_name
      ORDER BY amount DESC
    `, [companyId, start, end]),
  ]);

  // Build map: account_code → journal row
  const jeMap = {};
  for (const r of jeRes.rows) jeMap[r.account_code] = r;

  // Revenue accounts (credit-normal): sale credits = ex-VAT revenue; return debits = ex-VAT returns
  const revenueRows  = jeRes.rows.filter((r) => r.account_type === 'revenue');
  const revenueExVat = revenueRows.reduce((s, r) => s + parseFloat(r.sale_credit),  0);
  const totalReturns = revenueRows.reduce((s, r) => s + parseFloat(r.return_debit), 0);

  // VAT Payable (2100): sale credits = VAT collected on sales
  const vatRow       = jeMap['2100'] || {};
  const taxCollected = parseFloat(vatRow.sale_credit || 0);

  // Gross revenue is VAT-inclusive total billed to customers
  const grossRevenue = revenueExVat + taxCollected;
  const netRevenue   = revenueExVat - totalReturns;

  // COGS (5000): debit-normal expense account
  const cogsRow  = jeMap['5000'] || {};
  const cogs     = Math.max(0, parseFloat(cogsRow.total_debit || 0) - parseFloat(cogsRow.total_credit || 0));

  // Non-COGS expense accounts (debit-normal): wages, rent, utilities, etc.
  const opExpenseRows = jeRes.rows.filter((r) => r.account_type === 'expense' && r.account_code !== '5000');
  const operatingExpenses = opExpenseRows.reduce((s, r) => {
    return s + Math.max(0, parseFloat(r.total_debit) - parseFloat(r.total_credit));
  }, 0);

  const grossProfit     = netRevenue - cogs;
  const grossMargin     = netRevenue > 0 ? (grossProfit / netRevenue) * 100 : 0;
  const operatingProfit = grossProfit - operatingExpenses;
  const operatingMargin = netRevenue > 0 ? (operatingProfit / netRevenue) * 100 : 0;

  return {
    period: { startDate: start, endDate: end },
    income: {
      grossRevenue:  +grossRevenue.toFixed(2),
      taxCollected:  +taxCollected.toFixed(2),
      revenueExVat:  +revenueExVat.toFixed(2),
      totalReturns:  +totalReturns.toFixed(2),
      returnCount:   parseInt(returnsRes.rows[0].return_count),
      netRevenue:    +netRevenue.toFixed(2),
      txnCount:      parseInt(txnCountRes.rows[0].txn_count),
    },
    cogs:             +cogs.toFixed(2),
    grossProfit:      +grossProfit.toFixed(2),
    grossMargin:      +grossMargin.toFixed(2),
    operatingExpenses: +operatingExpenses.toFixed(2),
    operatingProfit:  +operatingProfit.toFixed(2),
    operatingMargin:  +operatingMargin.toFixed(2),
    expenseBreakdown: opExpenseRows
      .map((r) => ({
        accountCode: r.account_code,
        accountName: r.account_name,
        amount:      +Math.max(0, parseFloat(r.total_debit) - parseFloat(r.total_credit)).toFixed(2),
      }))
      .filter((r) => r.amount > 0),
    paymentBreakdown: paymentBreakRes.rows.map((r) => ({
      method:   r.method_name,
      txnCount: r.txn_count,
      amount:   parseFloat(r.amount),
    })),
  };
}

// ── LPO (Purchase Orders) Report ─────────────────────────────────────────────

async function getLPOReport(companyId, { startDate, endDate, supplierId, status, page = 1, limit = 25 } = {}) {
  const start = startDate || new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
  const end   = endDate   || new Date().toISOString().slice(0, 10);
  const pg = parseInt(page, 10);
  const lm = parseInt(limit, 10);

  const conds = ['po.company_id = $1', 'po.order_date BETWEEN $2 AND $3'];
  const vals  = [companyId, start, end];

  if (status)     { vals.push(status);     conds.push(`po.status = $${vals.length}`); }
  if (supplierId) { vals.push(supplierId); conds.push(`po.supplier_id = $${vals.length}`); }

  vals.push(lm, (pg - 1) * lm);

  const { rows: poRows } = await query(`
    SELECT po.po_id, po.po_number, po.order_date, po.expected_date, po.status,
           po.subtotal::numeric, po.tax_amount::numeric, po.total_amount::numeric, po.notes,
           po.created_at, po.approved_at,
           s.supplier_name, s.phone AS supplier_phone, s.email AS supplier_email,
           b.branch_name, b.branch_code,
           u.first_name || ' ' || u.last_name AS created_by,
           a.first_name || ' ' || a.last_name AS approved_by,
           COUNT(*) OVER() AS total_count
    FROM purchase_orders po
    JOIN suppliers s ON s.supplier_id = po.supplier_id
    JOIN branches  b ON b.branch_id   = po.branch_id
    LEFT JOIN users u ON u.user_id = po.created_by_user_id
    LEFT JOIN users a ON a.user_id = po.approved_by_user_id
    WHERE ${conds.join(' AND ')}
    ORDER BY po.order_date DESC, po.po_number DESC
    LIMIT $${vals.length - 1} OFFSET $${vals.length}
  `, vals);

  const total = poRows.length ? parseInt(poRows[0].total_count) : 0;

  let items = [];
  if (poRows.length) {
    const poIds = poRows.map((r) => r.po_id);
    const { rows: itemRows } = await query(`
      SELECT poi.po_id, poi.poi_id,
             poi.quantity_ordered::numeric, poi.quantity_received::numeric,
             poi.unit_cost::numeric, poi.tax_rate::numeric, poi.line_total::numeric,
             poi.description, p.product_name, p.sku
      FROM purchase_order_items poi
      JOIN products p ON p.product_id = poi.product_id
      WHERE poi.po_id = ANY($1)
      ORDER BY poi.poi_id
    `, [poIds]);
    items = itemRows;
  }

  const itemsMap = {};
  for (const i of items) {
    if (!itemsMap[i.po_id]) itemsMap[i.po_id] = [];
    itemsMap[i.po_id].push({
      poiId:            i.poi_id,
      productName:      i.product_name,
      sku:              i.sku,
      description:      i.description,
      quantityOrdered:  parseFloat(i.quantity_ordered),
      quantityReceived: parseFloat(i.quantity_received),
      unitCost:         parseFloat(i.unit_cost),
      taxRate:          parseFloat(i.tax_rate),
      lineTotal:        parseFloat(i.line_total),
    });
  }

  // Summary over whole filtered period (not just current page)
  const { rows: sumRows } = await query(`
    SELECT
      COUNT(*)::int AS total_pos,
      COUNT(*) FILTER (WHERE status = 'draft')::int            AS draft,
      COUNT(*) FILTER (WHERE status = 'pending_approval')::int AS pending,
      COUNT(*) FILTER (WHERE status = 'approved')::int         AS approved,
      COUNT(*) FILTER (WHERE status IN ('partially_received','received'))::int AS received,
      COUNT(*) FILTER (WHERE status = 'cancelled')::int        AS cancelled,
      COALESCE(SUM(total_amount), 0)::numeric                  AS total_value,
      COALESCE(SUM(total_amount) FILTER (WHERE status NOT IN ('cancelled','draft')), 0)::numeric AS active_value
    FROM purchase_orders
    WHERE company_id = $1 AND order_date BETWEEN $2 AND $3
  `, [companyId, start, end]);

  const sum = sumRows[0];
  return {
    period:  { startDate: start, endDate: end },
    summary: {
      totalPos:    sum.total_pos,
      draft:       sum.draft,
      pending:     sum.pending,
      approved:    sum.approved,
      received:    sum.received,
      cancelled:   sum.cancelled,
      totalValue:  parseFloat(sum.total_value),
      activeValue: parseFloat(sum.active_value),
    },
    orders: poRows.map(({ total_count, ...r }) => ({
      poId:          r.po_id,
      poNumber:      r.po_number,
      orderDate:     r.order_date,
      expectedDate:  r.expected_date,
      status:        r.status,
      subtotal:      parseFloat(r.subtotal || 0),
      taxAmount:     parseFloat(r.tax_amount || 0),
      totalAmount:   parseFloat(r.total_amount || 0),
      notes:         r.notes,
      createdAt:     r.created_at,
      approvedAt:    r.approved_at,
      supplierName:  r.supplier_name,
      supplierPhone: r.supplier_phone,
      supplierEmail: r.supplier_email,
      branchName:    r.branch_name,
      branchCode:    r.branch_code,
      createdBy:     r.created_by,
      approvedBy:    r.approved_by,
      items:         itemsMap[r.po_id] ?? [],
    })),
    total, page: pg, limit: lm, pages: Math.ceil(total / lm),
  };
}

// ── GRN Report ────────────────────────────────────────────────────────────────

async function getGRNReport(companyId, { startDate, endDate, supplierId, page = 1, limit = 25 } = {}) {
  const start = startDate || new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
  const end   = endDate   || new Date().toISOString().slice(0, 10);
  const pg = parseInt(page, 10);
  const lm = parseInt(limit, 10);

  const conds = ['g.company_id = $1', 'g.received_date BETWEEN $2 AND $3'];
  const vals  = [companyId, start, end];

  if (supplierId) { vals.push(supplierId); conds.push(`g.supplier_id = $${vals.length}`); }

  vals.push(lm, (pg - 1) * lm);

  const { rows: grnRows } = await query(`
    SELECT g.grn_id, g.grn_number, g.received_date, g.status,
           g.subtotal::numeric, g.total_amount::numeric, g.notes, g.posted_at,
           g.created_at,
           po.po_number,
           s.supplier_name, s.phone AS supplier_phone,
           b.branch_name,
           u.first_name || ' ' || u.last_name AS received_by,
           COUNT(*) OVER() AS total_count
    FROM grns g
    JOIN purchase_orders po ON po.po_id = g.po_id
    JOIN suppliers s  ON s.supplier_id  = g.supplier_id
    JOIN branches  b  ON b.branch_id    = g.branch_id
    LEFT JOIN users u ON u.user_id      = g.received_by_user_id
    WHERE ${conds.join(' AND ')}
    ORDER BY g.received_date DESC, g.grn_number DESC
    LIMIT $${vals.length - 1} OFFSET $${vals.length}
  `, vals);

  const total = grnRows.length ? parseInt(grnRows[0].total_count) : 0;

  let grnItems = [];
  if (grnRows.length) {
    const grnIds = grnRows.map((r) => r.grn_id);
    const { rows: itemRows } = await query(`
      SELECT gi.grn_id, gi.grni_id,
             gi.quantity_received::numeric, gi.unit_cost::numeric, gi.line_total::numeric,
             p.product_name, p.sku
      FROM grn_items gi
      JOIN products p ON p.product_id = gi.product_id
      WHERE gi.grn_id = ANY($1)
      ORDER BY gi.grni_id
    `, [grnIds]);
    grnItems = itemRows;
  }

  const itemsMap = {};
  for (const i of grnItems) {
    if (!itemsMap[i.grn_id]) itemsMap[i.grn_id] = [];
    itemsMap[i.grn_id].push({
      grniId:           i.grni_id,
      productName:      i.product_name,
      sku:              i.sku,
      quantityReceived: parseFloat(i.quantity_received),
      unitCost:         parseFloat(i.unit_cost),
      lineTotal:        parseFloat(i.line_total),
    });
  }

  const { rows: sumRows } = await query(`
    SELECT
      COUNT(*)::int AS total_grns,
      COUNT(*) FILTER (WHERE status = 'posted')::int AS posted,
      COUNT(*) FILTER (WHERE status = 'draft')::int  AS draft,
      COALESCE(SUM(total_amount) FILTER (WHERE status = 'posted'), 0)::numeric AS total_received,
      COALESCE(SUM(total_amount), 0)::numeric AS total_value
    FROM grns
    WHERE company_id = $1 AND received_date BETWEEN $2 AND $3
  `, [companyId, start, end]);

  const sum = sumRows[0];
  return {
    period:  { startDate: start, endDate: end },
    summary: {
      totalGrns:     sum.total_grns,
      posted:        sum.posted,
      draft:         sum.draft,
      totalReceived: parseFloat(sum.total_received),
      totalValue:    parseFloat(sum.total_value),
    },
    grns: grnRows.map(({ total_count, ...r }) => ({
      grnId:        r.grn_id,
      grnNumber:    r.grn_number,
      receivedDate: r.received_date,
      status:       r.status,
      subtotal:     parseFloat(r.subtotal || 0),
      totalAmount:  parseFloat(r.total_amount || 0),
      notes:        r.notes,
      postedAt:     r.posted_at,
      createdAt:    r.created_at,
      poNumber:     r.po_number,
      supplierName: r.supplier_name,
      supplierPhone: r.supplier_phone,
      branchName:   r.branch_name,
      receivedBy:   r.received_by,
      items:        itemsMap[r.grn_id] ?? [],
    })),
    total, page: pg, limit: lm, pages: Math.ceil(total / lm),
  };
}

// ── Trial Balance (from ledger_entry_lines) ────────────────────────────────

async function getTrialBalance(companyId, { asOf } = {}) {
  const asOfDate = asOf || new Date().toISOString().slice(0, 10);

  const [accountsRes, jeLinesRes] = await Promise.all([
    query(
      `SELECT account_id, account_code, account_name, account_type, account_subtype, is_active
       FROM accounts WHERE company_id = $1 ORDER BY account_code`,
      [companyId]
    ),
    query(`
      SELECT jel.account_id,
             COALESCE(SUM(jel.debit),  0)::numeric AS total_debit,
             COALESCE(SUM(jel.credit), 0)::numeric AS total_credit
      FROM ledger_entry_lines jel
      JOIN journal_entries je ON je.journal_entry_id = jel.journal_entry_id
      WHERE je.company_id = $1 AND je.status = 'posted' AND je.source_type != 'VOID' AND je.entry_date <= $2
      GROUP BY jel.account_id
    `, [companyId, asOfDate]),
  ]);

  const balMap = Object.fromEntries(
    jeLinesRes.rows.map((r) => [r.account_id, {
      debit:  parseFloat(r.total_debit),
      credit: parseFloat(r.total_credit),
    }])
  );

  const rows = accountsRes.rows.map((acc) => {
    const bal    = balMap[acc.account_id] || { debit: 0, credit: 0 };
    const net    = bal.debit - bal.credit;
    const debit  = net > 0.005  ? +net.toFixed(2)    : 0;
    const credit = net < -0.005 ? +(-net).toFixed(2) : 0;
    return {
      accountId:   acc.account_id,
      accountCode: acc.account_code,
      accountName: acc.account_name,
      accountType: acc.account_type,
      isActive:    acc.is_active,
      hasData:     (bal.debit > 0 || bal.credit > 0),
      debit,
      credit,
    };
  });

  const totalDebits  = rows.reduce((s, r) => s + r.debit,  0);
  const totalCredits = rows.reduce((s, r) => s + r.credit, 0);

  return {
    asOf:         asOfDate,
    rows,
    totalDebits:  +totalDebits.toFixed(2),
    totalCredits: +totalCredits.toFixed(2),
    difference:   +(totalDebits - totalCredits).toFixed(2),
  };
}
// ── Ledger Entries — enriched with entity name + source reference ─────────────

async function getLedgerEntries(companyId, { accountId, startDate, endDate, page = 1, limit = 50 } = {}) {
  const start = startDate || new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
  const end   = endDate   || new Date().toISOString().slice(0, 10);
  const pg = parseInt(page,  10);
  const lm = parseInt(limit, 10);

  const { rows } = await query(`
    WITH ranked AS (
      SELECT
        je.journal_entry_id,
        je.entry_number,
        je.entry_date,
        je.source_type,
        je.source_id,
        je.status,
        lel.line_id,
        lel.account_id,
        lel.debit::numeric   AS debit,
        lel.credit::numeric  AS credit,
        lel.entity_type,
        lel.entity_id,
        COALESCE(lel.description, je.description) AS description,
        a.account_code,
        a.account_name,
        -- Who is the counterpart on this line
        CASE lel.entity_type
          WHEN 'customer'     THEN c.customer_name
          WHEN 'supplier'     THEN s.supplier_name
          WHEN 'bank_account' THEN ba.account_name
        END AS entity_name,
        -- Human-readable source document reference
        CASE je.source_type
          WHEN 'SALE'          THEN st_sale.transaction_number
          WHEN 'RETURN'        THEN ret.return_number
          WHEN 'GRN'           THEN grn.grn_number
          WHEN 'AR_SETTLEMENT' THEN st_ar.transaction_number
        END AS source_ref
      FROM ledger_entry_lines lel
      JOIN journal_entries je ON je.journal_entry_id = lel.journal_entry_id
      JOIN accounts a         ON a.account_id        = lel.account_id
      LEFT JOIN customers     c  ON lel.entity_type = 'customer'     AND c.customer_id      = lel.entity_id
      LEFT JOIN suppliers     s  ON lel.entity_type = 'supplier'     AND s.supplier_id      = lel.entity_id
      LEFT JOIN bank_accounts ba ON lel.entity_type = 'bank_account' AND ba.bank_account_id = lel.entity_id
      LEFT JOIN sales_transactions st_sale ON je.source_type = 'SALE'          AND st_sale.transaction_id = je.source_id
      LEFT JOIN returns            ret     ON je.source_type = 'RETURN'         AND ret.return_id           = je.source_id
      LEFT JOIN grns               grn     ON je.source_type = 'GRN'            AND grn.grn_id              = je.source_id
      LEFT JOIN sales_transactions st_ar   ON je.source_type = 'AR_SETTLEMENT' AND st_ar.transaction_id    = je.source_id
      WHERE je.company_id = $1
        AND je.status     IN ('posted', 'void')
        AND je.entry_date BETWEEN $2 AND $3
        AND ($4::uuid IS NULL OR lel.account_id = $4::uuid)
    ),
    with_balance AS (
      SELECT *,
        SUM(CASE WHEN status = 'posted' AND source_type != 'VOID' THEN debit - credit ELSE 0 END) OVER (
          PARTITION BY account_id
          ORDER BY entry_date ASC, entry_number ASC
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        )::numeric AS running_balance,
        COUNT(*) OVER () AS total_count
      FROM ranked
    )
    SELECT * FROM with_balance
    ORDER BY entry_date DESC, entry_number DESC
    LIMIT $5 OFFSET $6
  `, [companyId, start, end, accountId || null, lm, (pg - 1) * lm]);

  const total = rows.length ? parseInt(rows[0].total_count) : 0;

  return {
    period:  { startDate: start, endDate: end },
    entries: rows.map(({ total_count, ...r }) => ({
      lineId:      r.line_id,
      entryId:     r.journal_entry_id,
      entryNumber: r.entry_number,
      entryDate:   r.entry_date,
      sourceType:  r.source_type,
      sourceRef:   r.source_ref || r.entry_number,
      status:      r.status,
      accountCode: r.account_code,
      accountName: r.account_name,
      description: r.description,
      entityType:  r.entity_type,
      entityName:  r.entity_name,
      debit:       parseFloat(r.debit),
      credit:      parseFloat(r.credit),
      balance:     parseFloat(r.running_balance),
    })),
    total, page: pg, limit: lm, pages: Math.ceil(total / lm),
  };
}
// ── AP Aging ──────────────────────────────────────────────────────────────────

async function getAPAging(companyId) {
  const { rows } = await query(`
    SELECT
      s.supplier_id, s.supplier_name, s.phone, s.email,
      s.current_balance::numeric                AS balance,
      s.payment_terms,
      MIN(g.received_date)::date                AS oldest_invoice_date,
      MAX(g.received_date)::date                AS latest_invoice_date,
      CURRENT_DATE - MIN(g.received_date)::date AS days_outstanding,
      COUNT(g.grn_id)::int                      AS grn_count,
      COALESCE(SUM(g.total_amount), 0)::numeric AS total_invoiced
    FROM suppliers s
    LEFT JOIN grns g ON g.supplier_id = s.supplier_id
      AND ($1::uuid IS NULL OR g.company_id = $1::uuid) AND g.status = 'posted'
    WHERE ($1::uuid IS NULL OR s.company_id = $1::uuid) AND s.current_balance > 0
    GROUP BY s.supplier_id, s.supplier_name, s.phone, s.email, s.current_balance, s.payment_terms
    ORDER BY days_outstanding DESC NULLS LAST
  `, [companyId]);

  const bucket = (days) => {
    if (days === null || days === undefined) return 'current';
    if (days <= 30)  return 'current';
    if (days <= 60)  return '31_60';
    if (days <= 90)  return '61_90';
    return 'over_90';
  };

  const suppliers = rows.map((r) => ({
    supplierId:       r.supplier_id,
    supplierName:     r.supplier_name,
    phone:            r.phone,
    email:            r.email,
    balance:          parseFloat(r.balance),
    paymentTerms:     r.payment_terms,
    daysOutstanding:  r.days_outstanding !== null ? parseInt(r.days_outstanding) : null,
    oldestInvoice:    r.oldest_invoice_date,
    latestInvoice:    r.latest_invoice_date,
    grnCount:         r.grn_count,
    totalInvoiced:    parseFloat(r.total_invoiced),
    bucket:           bucket(r.days_outstanding !== null ? parseInt(r.days_outstanding) : null),
  }));

  const totals = { current: 0, '31_60': 0, '61_90': 0, over_90: 0, total: 0 };
  for (const s of suppliers) {
    totals[s.bucket] += s.balance;
    totals.total     += s.balance;
  }

  return { suppliers, totals };
}

// ── Balance Sheet (journal-based) ─────────────────────────────────────────────

async function getBalanceSheet(companyId) {
  const [jeBalRes, bankRes, inventoryRes, suppliersRes] = await Promise.all([
    // Journal net balances for key asset/liability accounts (all-time, no date filter)
    query(`
      SELECT
        a.account_code,
        COALESCE(SUM(jel.debit),  0)::numeric AS total_debit,
        COALESCE(SUM(jel.credit), 0)::numeric AS total_credit
      FROM ledger_entry_lines jel
      JOIN journal_entries je ON je.journal_entry_id = jel.journal_entry_id
      JOIN accounts a         ON a.account_id        = jel.account_id
      WHERE ($1::uuid IS NULL OR je.company_id = $1::uuid) AND je.status = 'posted'
        AND a.account_code IN ('1000', '1010', '1100', '1200', '2000', '2100')
      GROUP BY a.account_code
    `, [companyId]),

    // Bank account details for breakdown
    query(`
      SELECT ba.account_name, ba.bank_name, ba.account_number,
             ba.current_balance::numeric AS balance, ba.currency, ba.is_default
      FROM bank_accounts ba
      WHERE ($1::uuid IS NULL OR ba.company_id = $1::uuid) AND ba.is_active = TRUE
      ORDER BY ba.is_default DESC, ba.account_name
    `, [companyId]),

    // Inventory units and product count (operational table)
    query(`
      SELECT
        COALESCE(SUM(pbi.quantity_available * COALESCE(p.cost_price, 0)), 0)::numeric AS inventory_value,
        SUM(pbi.quantity_available)::numeric AS total_units,
        COUNT(DISTINCT p.product_id)::int AS product_count
      FROM product_branch_inventory pbi
      JOIN products p ON p.product_id = pbi.product_id AND ($1::uuid IS NULL OR p.company_id = $1::uuid) AND p.is_active = TRUE
      JOIN branches b ON b.branch_id = pbi.branch_id AND ($1::uuid IS NULL OR b.company_id = $1::uuid)
      WHERE pbi.quantity_available > 0
    `, [companyId]),

    // Supplier balances for AP breakdown
    query(`
      SELECT supplier_name, current_balance::numeric AS balance
      FROM suppliers
      WHERE ($1::uuid IS NULL OR company_id = $1::uuid) AND current_balance > 0
      ORDER BY current_balance DESC
    `, [companyId]),
  ]);

  // Build journal net balance map: account_code → net (debit − credit)
  // Positive = debit-heavy (assets), negative = credit-heavy (liabilities)
  const jeMap = {};
  for (const r of jeBalRes.rows) {
    jeMap[r.account_code] = parseFloat(r.total_debit) - parseFloat(r.total_credit);
  }

  const hasJournalData = jeBalRes.rows.length > 0;

  // Cash & Bank (1000 + 1010): debit-normal; fallback to bank_accounts.current_balance sum
  const bankAccounts  = bankRes.rows.map((r) => ({ ...r, balance: parseFloat(r.balance) }));
  const opCashTotal   = bankAccounts.reduce((s, r) => s + r.balance, 0);
  const jesCash       = (jeMap['1000'] || 0) + (jeMap['1010'] || 0);
  const totalBankCash = hasJournalData ? +jesCash.toFixed(2) : opCashTotal;

  // Accounts Receivable (1100): debit-normal
  const ar = Math.max(0, +(jeMap['1100'] || 0).toFixed(2));

  // Inventory (1200): debit-normal; fallback to qty × cost_price
  const inv            = inventoryRes.rows[0];
  const jesInventory   = jeMap['1200'];
  const inventoryValue = hasJournalData && jesInventory !== undefined
    ? +Math.max(0, jesInventory).toFixed(2)
    : parseFloat(inv.inventory_value);

  // Accounts Payable (2000): credit-normal → net is negative → AP = |net|
  const apSuppliers = suppliersRes.rows.map((r) => ({ supplierName: r.supplier_name, balance: parseFloat(r.balance) }));
  const opAPTotal   = apSuppliers.reduce((s, r) => s + r.balance, 0);
  const jesAP       = jeMap['2000'];
  const totalAP     = hasJournalData && jesAP !== undefined
    ? +Math.max(0, -jesAP).toFixed(2)
    : opAPTotal;

  // VAT Payable (2100): credit-normal
  const vatPayable = +Math.max(0, -(jeMap['2100'] || 0)).toFixed(2);

  const totalAssets      = +(totalBankCash + inventoryValue + ar).toFixed(2);
  const totalLiabilities = +(totalAP + vatPayable).toFixed(2);
  const equity           = +(totalAssets - totalLiabilities).toFixed(2);

  return {
    asOf: new Date().toISOString().slice(0, 10),
    dataSource: hasJournalData ? 'journal' : 'operational',
    assets: {
      cashAndBank: { total: totalBankCash, accounts: bankAccounts },
      inventory:   { total: inventoryValue, totalUnits: parseFloat(inv.total_units || 0), productCount: inv.product_count },
      total:       totalAssets,
    },
    liabilities: {
      accountsPayable: { total: totalAP, suppliers: apSuppliers },
      total:           totalLiabilities,
    },
    equity,
  };
}

// ── Cash Flow Statement (from ledger_entry_lines) ────────────────────────────

async function getCashFlowStatement(companyId, { startDate, endDate } = {}) {
  const start = startDate || new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
  const end   = endDate   || new Date().toISOString().slice(0, 10);

  const [movementsRes, openingBalRes] = await Promise.all([
    // Cash movements in period: debit to 1000/1010 = inflow, credit = outflow
    query(`
      SELECT
        je.source_type,
        COALESCE(SUM(jel.debit),  0)::numeric AS cash_in,
        COALESCE(SUM(jel.credit), 0)::numeric AS cash_out
      FROM ledger_entry_lines jel
      JOIN journal_entries je ON je.journal_entry_id = jel.journal_entry_id
      JOIN accounts a         ON a.account_id        = jel.account_id
      WHERE ($1::uuid IS NULL OR je.company_id = $1::uuid) AND je.status = 'posted'
        AND je.entry_date BETWEEN $2 AND $3
        AND a.account_code IN ('1000', '1010')
      GROUP BY je.source_type
    `, [companyId, start, end]),

    // Opening cash balance (all posted entries strictly before start date)
    query(`
      SELECT COALESCE(SUM(jel.debit - jel.credit), 0)::numeric AS opening_balance
      FROM ledger_entry_lines jel
      JOIN journal_entries je ON je.journal_entry_id = jel.journal_entry_id
      JOIN accounts a         ON a.account_id        = jel.account_id
      WHERE ($1::uuid IS NULL OR je.company_id = $1::uuid) AND je.status = 'posted'
        AND je.entry_date < $2
        AND a.account_code IN ('1000', '1010')
    `, [companyId, start]),
  ]);

  // Classify movements into cash flow categories
  const cf = {
    operating: { receiptsFromCustomers: 0, arCollections: 0, refundsToCustomers: 0, paymentsToSuppliers: 0, supplierPaymentVoids: 0 },
    financing: { openingDeposits: 0 },
    other:     { net: 0 },
  };

  for (const r of movementsRes.rows) {
    const inflow  = parseFloat(r.cash_in);
    const outflow = parseFloat(r.cash_out);
    const net     = inflow - outflow;
    switch (r.source_type) {
      case 'SALE':           cf.operating.receiptsFromCustomers += inflow;  break;
      case 'AR_SETTLEMENT':  cf.operating.arCollections        += inflow;  break;
      case 'RETURN':         cf.operating.refundsToCustomers   -= outflow; break;
      case 'PAYMENT':        cf.operating.paymentsToSuppliers  -= outflow; break;
      case 'PAYMENT_VOID':   cf.operating.supplierPaymentVoids += inflow;  break;
      case 'OPENING':        cf.financing.openingDeposits      += net;     break;
      default:               cf.other.net                      += net;     break;
    }
  }

  const netOperating  = cf.operating.receiptsFromCustomers + cf.operating.arCollections
                      + cf.operating.refundsToCustomers + cf.operating.paymentsToSuppliers
                      + cf.operating.supplierPaymentVoids;
  const netFinancing  = cf.financing.openingDeposits;
  const netOther      = cf.other.net;
  const netCashChange = netOperating + netFinancing + netOther;

  const openingBalance = parseFloat(openingBalRes.rows[0].opening_balance);
  const closingBalance = openingBalance + netCashChange;

  const r2 = (n) => +n.toFixed(2);

  return {
    period: { startDate: start, endDate: end },
    operating: {
      receiptsFromCustomers: r2(cf.operating.receiptsFromCustomers),
      arCollections:         r2(cf.operating.arCollections),
      refundsToCustomers:    r2(cf.operating.refundsToCustomers),
      paymentsToSuppliers:   r2(cf.operating.paymentsToSuppliers),
      supplierPaymentVoids:  r2(cf.operating.supplierPaymentVoids),
      net:                   r2(netOperating),
    },
    financing: {
      openingDeposits: r2(cf.financing.openingDeposits),
      net:             r2(netFinancing),
    },
    other: { net: r2(netOther) },
    netCashChange:   r2(netCashChange),
    openingBalance:  r2(openingBalance),
    closingBalance:  r2(closingBalance),
  };
}

// ── Stock Valuation ───────────────────────────────────────────────────────────

async function getStockValuation(companyId, role, branchIds, { branchId } = {}) {
  const { rows: [co] } = await query(
    `SELECT costing_method FROM companies WHERE company_id = $1`, [companyId]
  );
  const costingMethod = co?.costing_method || 'weighted_average';

  const conds = ['p.company_id = $1', 'p.is_active = TRUE', 'b.company_id = $1', 'pbi.quantity_available > 0'];
  const vals  = [companyId];

  if (isCompanyWide(role)) {
    if (branchId) { vals.push(branchId); conds.push(`pbi.branch_id = $${vals.length}`); }
  } else {
    const ids = branchIds && branchIds.length
      ? branchIds
      : ['00000000-0000-0000-0000-000000000000'];
    vals.push(ids);
    conds.push(`pbi.branch_id = ANY($${vals.length})`);
  }

  let rows;
  if (costingMethod === 'fifo') {
    ({ rows } = await query(`
      WITH fifo_costs AS (
        SELECT
          product_id, branch_id,
          SUM(qty_remaining * unit_cost)::numeric AS fifo_total_cost,
          SUM(qty_remaining)::numeric             AS fifo_qty
        FROM inventory_cost_layers
        WHERE company_id = $1 AND qty_remaining > 0
        GROUP BY product_id, branch_id
      )
      SELECT
        p.product_id, p.product_name, p.sku, p.unit_of_measure,
        COALESCE(pc.category_name, 'Uncategorized') AS category_name,
        b.branch_name, b.branch_id,
        pbi.quantity_available::numeric AS qty,
        COALESCE(
          fc.fifo_total_cost / NULLIF(fc.fifo_qty, 0),
          p.cost_price,
          0
        )::numeric AS unit_cost,
        COALESCE(
          fc.fifo_total_cost,
          pbi.quantity_available * COALESCE(p.cost_price, 0)
        )::numeric AS total_value,
        pbi.reorder_level
      FROM product_branch_inventory pbi
      JOIN products p ON p.product_id = pbi.product_id
      JOIN branches b ON b.branch_id  = pbi.branch_id
      LEFT JOIN categories pc ON pc.category_id = p.category_id
      LEFT JOIN fifo_costs fc ON fc.product_id = pbi.product_id AND fc.branch_id = pbi.branch_id
      WHERE ${conds.join(' AND ')}
      ORDER BY total_value DESC
    `, vals));
  } else {
    ({ rows } = await query(`
      SELECT
        p.product_id, p.product_name, p.sku, p.unit_of_measure,
        COALESCE(pc.category_name, 'Uncategorized') AS category_name,
        b.branch_name, b.branch_id,
        pbi.quantity_available::numeric AS qty,
        COALESCE(p.cost_price, 0)::numeric AS unit_cost,
        (pbi.quantity_available * COALESCE(p.cost_price, 0))::numeric AS total_value,
        pbi.reorder_level
      FROM product_branch_inventory pbi
      JOIN products p ON p.product_id = pbi.product_id
      JOIN branches b ON b.branch_id  = pbi.branch_id
      LEFT JOIN categories pc ON pc.category_id = p.category_id
      WHERE ${conds.join(' AND ')}
      ORDER BY total_value DESC
    `, vals));
  }

  const items = rows.map((r) => ({
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

  const totalValue = items.reduce((s, i) => s + i.totalValue, 0);
  const totalUnits = items.reduce((s, i) => s + i.qty, 0);

  return { items, totalValue: +totalValue.toFixed(2), totalUnits: +totalUnits.toFixed(3) };
}

// ── Purchases Summary ─────────────────────────────────────────────────────────

async function getPurchasesSummary(companyId, { startDate, endDate } = {}) {
  const start = startDate || new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
  const end   = endDate   || new Date().toISOString().slice(0, 10);

  const [poRes, grnRes, payRes, supplierRes] = await Promise.all([
    query(`
      SELECT
        COUNT(*)::int AS total_pos,
        COUNT(*) FILTER (WHERE status='draft')::int            AS draft,
        COUNT(*) FILTER (WHERE status='pending_approval')::int AS pending,
        COUNT(*) FILTER (WHERE status='approved')::int         AS approved,
        COUNT(*) FILTER (WHERE status IN ('partially_received','received'))::int AS received,
        COUNT(*) FILTER (WHERE status='cancelled')::int        AS cancelled,
        COALESCE(SUM(total_amount), 0)::numeric                AS total_value
      FROM purchase_orders
      WHERE company_id = $1 AND order_date BETWEEN $2 AND $3
    `, [companyId, start, end]),

    query(`
      SELECT
        COUNT(*)::int AS total_grns,
        COUNT(*) FILTER (WHERE status='posted')::int AS posted,
        COALESCE(SUM(total_amount) FILTER (WHERE status='posted'), 0)::numeric AS total_received
      FROM grns
      WHERE company_id = $1 AND received_date BETWEEN $2 AND $3
    `, [companyId, start, end]),

    query(`
      SELECT COALESCE(SUM(amount), 0)::numeric AS total_paid,
             COUNT(*)::int AS payment_count
      FROM supplier_payments
      WHERE company_id = $1 AND payment_date BETWEEN $2 AND $3 AND is_void = FALSE
    `, [companyId, start, end]),

    query(`
      SELECT s.supplier_name,
             COALESCE(SUM(g.total_amount) FILTER (WHERE g.status='posted'), 0)::numeric AS received_value,
             COALESCE(SUM(sp.amount), 0)::numeric AS paid_value,
             s.current_balance::numeric AS outstanding
      FROM suppliers s
      LEFT JOIN grns g ON g.supplier_id = s.supplier_id AND g.company_id = $1
        AND g.received_date BETWEEN $2 AND $3
      LEFT JOIN supplier_payments sp ON sp.supplier_id = s.supplier_id AND sp.company_id = $1
        AND sp.payment_date BETWEEN $2 AND $3 AND sp.is_void = FALSE
      WHERE s.company_id = $1
      GROUP BY s.supplier_id, s.supplier_name, s.current_balance
      HAVING COALESCE(SUM(g.total_amount), 0) > 0 OR COALESCE(SUM(sp.amount), 0) > 0
      ORDER BY received_value DESC
    `, [companyId, start, end]),
  ]);

  const po  = poRes.rows[0];
  const grn = grnRes.rows[0];
  const pay = payRes.rows[0];

  return {
    period: { startDate: start, endDate: end },
    orders: {
      total: po.total_pos, draft: po.draft, pending: po.pending,
      approved: po.approved, received: po.received, cancelled: po.cancelled,
      totalValue: parseFloat(po.total_value),
    },
    receipts: {
      total: grn.total_grns, posted: grn.posted,
      totalReceived: parseFloat(grn.total_received),
    },
    payments: {
      total: pay.payment_count,
      totalPaid: parseFloat(pay.total_paid),
    },
    bySupplier: supplierRes.rows.map((r) => ({
      supplierName:   r.supplier_name,
      receivedValue:  parseFloat(r.received_value),
      paidValue:      parseFloat(r.paid_value),
      outstanding:    parseFloat(r.outstanding),
    })),
  };
}


// ── Product quantity analysis (dashboard qty card) ────────────────────────────
async function getProductQty(companyId, role, branchIds, { period = '7d' } = {}) {
  const DAYS_MAP = { '7d': 6, '30d': 29, '90d': 89, '1y': 364 };
  const days = DAYS_MAP[period] ?? 6;
  const { clause: bClause, params: bParams } = branchScope(role, companyId, branchIds);
  const dIdx = bParams.length + 1;

  const { rows } = await query(`
    SELECT
      p.product_name,
      p.sku,
      SUM(sti.quantity)::numeric   AS qty_sold,
      SUM(sti.line_total)::numeric AS revenue
    FROM sales_transaction_items sti
    JOIN products p ON p.product_id = sti.product_id
    JOIN sales_transactions st ON st.transaction_id = sti.transaction_id
    WHERE st.company_id = $1 AND st.status = 'completed'
      AND st.transaction_date >= CURRENT_DATE - ($${dIdx}::int * INTERVAL '1 day')
      ${bClause}
    GROUP BY p.product_id, p.product_name, p.sku
    ORDER BY qty_sold DESC
    LIMIT 10
  `, [...bParams, days]);

  return rows.map((r) => ({
    productName: r.product_name,
    sku:         r.sku,
    qtySold:     parseFloat(r.qty_sold),
    revenue:     parseFloat(r.revenue),
  }));
}

module.exports = { getDashboard, getSalesReport, getPLReport, getAPAging, getBalanceSheet, getCashFlowStatement, getStockValuation, getPurchasesSummary, getLPOReport, getGRNReport, getTrialBalance, getLedgerEntries, getProductQty };
